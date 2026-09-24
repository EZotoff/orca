// Why: Task 18 (orca-transition design §6) — the per-consumer ownership registry for
// the globally installed OpenCode hook. One durable record per installed-hook
// consumer (per spawned OpenCode PTY): pid + /proc start time + boot id (rejects
// PID reuse), identity token hash, install generation. Stored in Orca's state dir
// — OUTSIDE OpenCode's plugin discovery glob. All mutations happen under the
// installer lock (see global-hook-ownership.ts).
//
// Liveness rule (conservative by design): a record is DEAD only when its pid is
// gone, OR the pid's start time no longer matches (recycled pid), OR the machine
// has rebooted (boot id changed). When procfs is unavailable (non-Linux), every
// record counts as STILL DEPENDENT — unknown is never dead.

import { mkdir, readFile } from 'node:fs/promises'
import {
  durableWriteTempPath,
  renameDurable,
  writeTempFileDurable
} from '../durable-file-write'
import { join } from 'node:path'

export const GLOBAL_HOOK_CONSUMERS_FILE = 'hook-consumers.json'

export type GlobalHookConsumerRecord = {
  readonly schemaVersion: 1
  /** Per-PTY consumer identity (Orca instance UUID + PTY handle), stable across reconciles. */
  readonly consumerId: string
  readonly host: string
  /** The spawned OpenCode process pid. */
  readonly pid: number
  /** /proc/sys/kernel/random/boot_id at registration; null only if unreadable then. */
  readonly bootId: string | null
  /** /proc/<pid>/stat field 22 (starttime) at registration — the PID-reuse guard. */
  readonly pidStartTime: string
  /** SHA256 of the per-PTY identity token (never the token itself). */
  readonly identityTokenSha256: string
  /** GLOBAL_HOOK_INSTALLER_VERSION of the plugin the consumer was registered against. */
  readonly installGeneration: number
  readonly registeredAt: string
}

/**
 * Injectable process-identity seam so tests simulate live/dead/recycled pids
 * without touching real processes. Returns null where /proc cannot answer.
 */
export type ProcessIdentityReader = {
  readonly bootId: () => Promise<string | null>
  readonly pidStartTime: (pid: number) => Promise<string | null>
}

/** /proc/<pid>/stat field layout: comm (field 2) may contain spaces, so index past the last ')'. */
const STAT_STARTTIME_TAIL_INDEX = 19 // field 22 − field 3 (state) = index in the post-comm tail

export function createProcfsProcessIdentityReader(): ProcessIdentityReader {
  return {
    async bootId() {
      try {
        const value = (await readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim()
        return value === '' ? null : value
      } catch {
        return null
      }
    },
    async pidStartTime(pid: number) {
      try {
        const stat = await readFile(`/proc/${pid}/stat`, 'utf8')
        const commEnd = stat.lastIndexOf(')')
        if (commEnd < 0) {
          return null
        }
        const tail = stat.slice(commEnd + 2).split(' ')
        const startTime = tail[STAT_STARTTIME_TAIL_INDEX]
        return startTime !== undefined && /^\d+$/.test(startTime) ? startTime : null
      } catch {
        // ENOENT = no such pid. Other failures are indistinguishable here; the
        // boot-id gate keeps platforms without procfs conservative.
        return null
      }
    }
  }
}

export type GlobalHookConsumerRegistry =
  | { readonly status: 'ok'; readonly records: readonly GlobalHookConsumerRecord[] }
  | { readonly status: 'missing' }
  | { readonly status: 'corrupt' }

export type GlobalHookConsumerLiveness = {
  readonly live: readonly GlobalHookConsumerRecord[]
  readonly pruned: readonly GlobalHookConsumerRecord[]
}

const CONSUMER_ID_PATTERN = /^[A-Za-z0-9._:#-]{1,128}$/
const HEX64_PATTERN = /^[0-9a-f]{64}$/
const START_TIME_PATTERN = /^\d+$/

export function isGlobalHookConsumerRecord(value: unknown): value is GlobalHookConsumerRecord {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const record = value as Record<string, unknown>
  return (
    record['schemaVersion'] === 1 &&
    typeof record['consumerId'] === 'string' &&
    CONSUMER_ID_PATTERN.test(record['consumerId']) &&
    typeof record['host'] === 'string' &&
    record['host'] !== '' &&
    typeof record['pid'] === 'number' &&
    Number.isInteger(record['pid']) &&
    record['pid'] > 0 &&
    (typeof record['bootId'] === 'string' || record['bootId'] === null) &&
    typeof record['pidStartTime'] === 'string' &&
    START_TIME_PATTERN.test(record['pidStartTime']) &&
    typeof record['identityTokenSha256'] === 'string' &&
    HEX64_PATTERN.test(record['identityTokenSha256']) &&
    typeof record['installGeneration'] === 'number' &&
    Number.isInteger(record['installGeneration']) &&
    record['installGeneration'] > 0 &&
    typeof record['registeredAt'] === 'string' &&
    record['registeredAt'] !== ''
  )
}

/**
 * Load the registry. 'corrupt' covers unreadable bytes, non-JSON, wrong schema,
 * and structurally invalid or duplicate records — all conservative: callers treat
 * corrupt as "no owned consumers" for GC but must not auto-uninstall on it.
 */
export async function loadGlobalHookConsumerRegistry(
  stateDir: string
): Promise<GlobalHookConsumerRegistry> {
  let raw: string
  try {
    raw = await readFile(join(stateDir, GLOBAL_HOOK_CONSUMERS_FILE), 'utf8')
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT'
      ? { status: 'missing' }
      : { status: 'corrupt' }
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) {
      return { status: 'corrupt' }
    }
    const envelope = parsed as Record<string, unknown>
    const consumers = envelope['consumers']
    if (envelope['schemaVersion'] !== 1 || !Array.isArray(consumers)) {
      return { status: 'corrupt' }
    }
    if (!consumers.every(isGlobalHookConsumerRecord)) {
      return { status: 'corrupt' }
    }
    const ids = new Set(consumers.map((record) => record.consumerId))
    if (ids.size !== consumers.length) {
      return { status: 'corrupt' }
    }
    return { status: 'ok', records: consumers }
  } catch {
    return { status: 'corrupt' }
  }
}

/** Durable atomic registry write (temp + fsync + rename). Caller holds the installer lock. */
export async function saveGlobalHookConsumerRegistry(
  stateDir: string,
  records: readonly GlobalHookConsumerRecord[]
): Promise<void> {
  await mkdir(stateDir, { recursive: true, mode: 0o700 })
  const finalPath = join(stateDir, GLOBAL_HOOK_CONSUMERS_FILE)
  const tmpPath = durableWriteTempPath(finalPath)
  await writeTempFileDurable(tmpPath, `${JSON.stringify({ schemaVersion: 1, consumers: records }, null, 2)}\n`)
  await renameDurable(tmpPath, finalPath)
}

/**
 * Split records into live vs prunable. PID-reuse rejection: a recycled pid has a
 * different start time, so it never inherits ownership. Boot-id change (reboot)
 * kills every record. procfs unavailable ⇒ everything stays dependent.
 */
export async function assessGlobalHookConsumerLiveness(
  records: readonly GlobalHookConsumerRecord[],
  reader: ProcessIdentityReader
): Promise<GlobalHookConsumerLiveness> {
  const bootId = await reader.bootId()
  if (bootId === null) {
    return { live: records, pruned: [] }
  }
  const live: GlobalHookConsumerRecord[] = []
  const pruned: GlobalHookConsumerRecord[] = []
  for (const record of records) {
    const startTime = await reader.pidStartTime(record.pid)
    const dead =
      startTime === null ||
      startTime !== record.pidStartTime ||
      (record.bootId !== null && record.bootId !== bootId)
    if (dead) {
      pruned.push(record)
    } else {
      live.push(record)
    }
  }
  return { live, pruned }
}

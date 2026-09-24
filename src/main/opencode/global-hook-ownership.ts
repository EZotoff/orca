// Why: Task 18 (orca-transition design §6) — lifetime ownership across live PTYs.
// The installer never reaches into live PTYs: instead, every spawned OpenCode
// consumer is registered (pid + start time + boot id + token hash + generation),
// records are garbage-collected only for VERIFIABLY dead processes, and
// `uninstall` refuses while any live owned consumer exists. After the last
// consumer exits, the checked uninstall removes/restores the plugin under the
// same installer lock. Corrupt or missing registry = conservative refusal
// (treated as zero consumers for GC, never auto-uninstalled) unless the operator
// passes the explicit `force` flag, which is logged loudly and recorded.

import { hostname } from 'node:os'
import { lstat, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { withFileTransactionLock } from '../file-transaction-lock'
import {
  GLOBAL_HOOK_INSTALLER_VERSION,
  GLOBAL_HOOK_PLUGIN_FILE,
  installGlobalOpenCodeHookUnlocked,
  uninstallGlobalOpenCodeHookUnlocked,
  writeOutcomeRecord,
  type GlobalHookPaths,
  type GlobalHookUninstallOutcome
} from './global-hook-installer'
import {
  getGlobalHookPluginBody
} from './global-hook-plugin-source'
import {
  hashGlobalHookBody,
  parseMarkedGlobalHookContent
} from './global-hook-marker'
import {
  assessGlobalHookConsumerLiveness,
  createProcfsProcessIdentityReader,
  loadGlobalHookConsumerRegistry,
  saveGlobalHookConsumerRegistry,
  type GlobalHookConsumerRecord,
  type ProcessIdentityReader
} from './global-hook-consumer-registry'
import {
  hashGlobalHookIdentityToken,
  isValidGlobalHookIdentityToken
} from './global-hook-env'

export type GlobalHookConsumerRegistrationInput = {
  readonly consumerId: string
  readonly pid: number
  readonly identityToken: string
  readonly host?: string
  readonly installGeneration?: number
}

export type GlobalHookConsumerRegistrationOutcome =
  | { readonly status: 'registered'; readonly record: GlobalHookConsumerRecord }
  | { readonly status: 'refused'; readonly reason: 'state-corrupt' | 'identity-unreadable' }

export type GlobalHookConsumerReleaseOutcome =
  | { readonly status: 'released' }
  | { readonly status: 'unknown-consumer' }
  | { readonly status: 'refused'; readonly reason: 'still-live' | 'identity-unknown' | 'state-corrupt' }

export type GlobalHookConsumerReconcileOutcome =
  | { readonly status: 'ok'; readonly live: readonly GlobalHookConsumerRecord[]; readonly pruned: readonly GlobalHookConsumerRecord[] }
  | { readonly status: 'missing' | 'corrupt'; readonly live: readonly []; readonly pruned: readonly [] }

export type OwnershipCheckedUninstallOutcome =
  | GlobalHookUninstallOutcome
  | { readonly status: 'refused'; readonly reason: 'owned-consumers-live'; readonly liveCount: number }
  | { readonly status: 'refused'; readonly reason: 'state-corrupt' | 'state-missing' }

export type GlobalHookOwnershipOptions = {
  readonly paths: GlobalHookPaths
  readonly now?: () => Date
  readonly reader?: ProcessIdentityReader
}

function lockPathOf(paths: GlobalHookPaths): string {
  return join(paths.pluginsDir, GLOBAL_HOOK_PLUGIN_FILE)
}

function parseRegistrationInput(
  input: GlobalHookConsumerRegistrationInput
): { consumerId: string; pid: number; identityTokenSha256: string; host: string; installGeneration: number } {
  if (!/^[A-Za-z0-9._:#-]{1,128}$/.test(input.consumerId)) {
    throw new Error('invalid global-hook consumer id')
  }
  if (!Number.isInteger(input.pid) || input.pid <= 0) {
    throw new Error('invalid global-hook consumer pid')
  }
  if (!isValidGlobalHookIdentityToken(input.identityToken)) {
    throw new Error('invalid global-hook identity token')
  }
  return {
    consumerId: input.consumerId,
    pid: input.pid,
    identityTokenSha256: hashGlobalHookIdentityToken(input.identityToken),
    host: input.host ?? hostname(),
    installGeneration: input.installGeneration ?? GLOBAL_HOOK_INSTALLER_VERSION
  }
}

/**
 * Add (or refresh) a consumer's ownership record under the installer lock, BEFORE
 * the PTY handoff. A second Orca instance JOINS: existing records are untouched.
 * Refuses to overwrite a corrupt registry — clobbering it would let a later
 * uninstall believe no consumers exist.
 */
export async function registerGlobalHookConsumer(
  options: GlobalHookOwnershipOptions & { readonly consumer: GlobalHookConsumerRegistrationInput }
): Promise<GlobalHookConsumerRegistrationOutcome> {
  const parsed = parseRegistrationInput(options.consumer)
  const reader = options.reader ?? createProcfsProcessIdentityReader()
  const now = options.now ?? (() => new Date())
  return withFileTransactionLock(lockPathOf(options.paths), async () => {
    const bootId = await reader.bootId()
    const pidStartTime = await reader.pidStartTime(parsed.pid)
    if (bootId === null || pidStartTime === null) {
      // Cannot capture a reuse-proof identity — never register a weak record.
      return { status: 'refused', reason: 'identity-unreadable' } as const
    }
    const registry = await loadGlobalHookConsumerRegistry(options.paths.stateDir)
    if (registry.status === 'corrupt') {
      return { status: 'refused', reason: 'state-corrupt' } as const
    }
    const record: GlobalHookConsumerRecord = {
      schemaVersion: 1,
      ...parsed,
      bootId,
      pidStartTime,
      registeredAt: now().toISOString()
    }
    const others = registry.status === 'ok' ? registry.records.filter((r) => r.consumerId !== parsed.consumerId) : []
    await saveGlobalHookConsumerRegistry(options.paths.stateDir, [...others, record])
    return { status: 'registered', record } as const
  })
}

/**
 * Release a consumer AFTER its exact process exit was observed. Verifies via the
 * identity seam first: a still-live process, or a platform where liveness cannot
 * be determined, refuses the release. Never removes another consumer's record.
 */
export async function releaseGlobalHookConsumer(
  options: GlobalHookOwnershipOptions & { readonly consumerId: string }
): Promise<GlobalHookConsumerReleaseOutcome> {
  const reader = options.reader ?? createProcfsProcessIdentityReader()
  return withFileTransactionLock(lockPathOf(options.paths), async () => {
    const registry = await loadGlobalHookConsumerRegistry(options.paths.stateDir)
    if (registry.status === 'corrupt') {
      return { status: 'refused', reason: 'state-corrupt' } as const
    }
    if (registry.status === 'missing') {
      return { status: 'unknown-consumer' } as const
    }
    const record = registry.records.find((r) => r.consumerId === options.consumerId)
    if (!record) {
      return { status: 'unknown-consumer' } as const
    }
    const bootId = await reader.bootId()
    if (bootId === null) {
      return { status: 'refused', reason: 'identity-unknown' } as const
    }
    const { live } = await assessGlobalHookConsumerLiveness([record], reader)
    if (live.length > 0) {
      return { status: 'refused', reason: 'still-live' } as const
    }
    await saveGlobalHookConsumerRegistry(
      options.paths.stateDir,
      registry.records.filter((r) => r.consumerId !== options.consumerId)
    )
    return { status: 'released' } as const
  })
}

/**
 * Stale-record GC: prune records whose process is verifiably dead (pid gone,
 * pid recycled, or machine rebooted). Runs on Orca start and on every checked
 * installer/uninstaller run. A corrupt/missing registry is reported, never
 * rewritten — the conservative path requires explicit operator action.
 */
export async function reconcileGlobalHookConsumers(
  options: GlobalHookOwnershipOptions
): Promise<GlobalHookConsumerReconcileOutcome> {
  const reader = options.reader ?? createProcfsProcessIdentityReader()
  return withFileTransactionLock(lockPathOf(options.paths), async () => {
    return reconcileUnlocked(options.paths, reader)
  })
}

async function reconcileUnlocked(
  paths: GlobalHookPaths,
  reader: ProcessIdentityReader
): Promise<GlobalHookConsumerReconcileOutcome> {
  const registry = await loadGlobalHookConsumerRegistry(paths.stateDir)
  if (registry.status !== 'ok') {
    return { status: registry.status, live: [], pruned: [] }
  }
  const { live, pruned } = await assessGlobalHookConsumerLiveness(registry.records, reader)
  if (pruned.length > 0) {
    await saveGlobalHookConsumerRegistry(paths.stateDir, live)
  }
  return { status: 'ok', live, pruned }
}

/**
 * Ownership-checked uninstall (design §6): refuses while ANY live owned consumer
 * exists — uninstall never reaches into live PTYs. Corrupt/missing registry also
 * refuses (explicit operator action required). `force` bypasses both refusals as
 * an operator-explicit act: logged loudly and recorded in the outcome audit.
 */
export async function uninstallGlobalOpenCodeHookOwnershipChecked(
  options: GlobalHookOwnershipOptions & { readonly force?: boolean }
): Promise<OwnershipCheckedUninstallOutcome> {
  const reader = options.reader ?? createProcfsProcessIdentityReader()
  const now = options.now ?? (() => new Date())
  return withFileTransactionLock(lockPathOf(options.paths), async () => {
    // No plugin ⇒ nothing owned to protect; report absent before any state refusal.
    try {
      const stats = await lstat(join(options.paths.pluginsDir, GLOBAL_HOOK_PLUGIN_FILE))
      if (!stats.isFile()) {
        return uninstallGlobalOpenCodeHookUnlocked(options)
      }
    } catch {
      return { status: 'absent' } as const
    }
    const reconciled = await reconcileUnlocked(options.paths, reader)
    if (reconciled.status !== 'ok') {
      const reason = reconciled.status === 'corrupt' ? 'state-corrupt' : 'state-missing'
      if (!options.force) {
        const outcome = { status: 'refused', reason } as const
        await writeOutcomeRecord(options.paths.stateDir, outcome, now())
        return outcome
      }
      console.warn(
        `[opencode-global-hook] FORCED uninstall bypassing unreadable consumer registry (${reason}) — operator-explicit --force`
      )
    } else if (reconciled.live.length > 0 && !options.force) {
      const outcome = { status: 'refused', reason: 'owned-consumers-live', liveCount: reconciled.live.length } as const
      await writeOutcomeRecord(options.paths.stateDir, outcome, now())
      return outcome
    } else if (reconciled.live.length > 0) {
      console.warn(
        `[opencode-global-hook] FORCED uninstall with ${reconciled.live.length} live owned consumer(s) — operator-explicit --force`
      )
    }
    const outcome = await uninstallGlobalOpenCodeHookUnlocked(options)
    if (options.force) {
      await writeOutcomeRecord(options.paths.stateDir, { status: outcome.status, reason: 'forced' }, now())
    }
    return outcome
  })
}

/**
 * Ownership-checked install: same GC-on-run as the uninstaller, plus the §6
 * upgrade rule — never REPLACE the plugin body while live consumers depend on
 * the installed version (noop/first-install/refusals proceed unchanged).
 */
export async function installGlobalOpenCodeHookOwnershipChecked(
  options: GlobalHookOwnershipOptions
): Promise<
  | Awaited<ReturnType<typeof installGlobalOpenCodeHookUnlocked>>
  | { readonly status: 'refused'; readonly reason: 'owned-consumers-live'; readonly liveCount: number }
> {
  const reader = options.reader ?? createProcfsProcessIdentityReader()
  const now = options.now ?? (() => new Date())
  return withFileTransactionLock(lockPathOf(options.paths), async () => {
    const reconciled = await reconcileUnlocked(options.paths, reader)
    if (reconciled.status === 'ok' && reconciled.live.length > 0 && (await wouldReplacePlugin(options.paths))) {
      // Dependents still run the installed body; swapping it now changes the file
      // under live PTYs. Postpone the incompatible update (design §6).
      const outcome = { status: 'refused', reason: 'owned-consumers-live', liveCount: reconciled.live.length } as const
      await writeOutcomeRecord(options.paths.stateDir, outcome, now())
      return outcome
    }
    return installGlobalOpenCodeHookUnlocked(options)
  })
}

/** True when the next install would be a 'replaced' (backup+swap), not noop/first-install/refusal. */
async function wouldReplacePlugin(paths: GlobalHookPaths): Promise<boolean> {
  const pluginPath = join(paths.pluginsDir, GLOBAL_HOOK_PLUGIN_FILE)
  let stats
  try {
    stats = await lstat(pluginPath)
  } catch {
    return false
  }
  if (!stats.isFile()) {
    return false
  }
  const parsed = parseMarkedGlobalHookContent(await readFile(pluginPath, 'utf8'))
  return parsed !== null && parsed.marker.digest !== hashGlobalHookBody(getGlobalHookPluginBody())
}

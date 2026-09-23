// Orca-owned persistence for the session-to-pane identity bridge (Task 13).
//
// The file is a cache of verified identity, not authority: a corrupt or
// schema-invalid image loads as empty rather than poisoning resolution.
import { mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'
import { parseExecutionHostId } from '../../shared/execution-host'
import type { IdentityBridgeRecord } from '../../shared/identity-bridge-types'
import { durableWriteTempPath, writeFileDurable } from '../durable-file-write'

export const IDENTITY_BRIDGE_SCHEMA_VERSION = 1

const hostIdSchema = z.string().refine((value) => parseExecutionHostId(value) !== null)

const recordSchema = z.strictObject({
  executionHostId: hostIdSchema,
  canonicalRoot: z.string().min(1),
  sessionID: z.string().min(1),
  launchToken: z.string().min(1),
  worktreeIdentity: z.string().min(1),
  tabId: z.string().min(1),
  leafId: z.string().min(1),
  terminalHandle: z.string().min(1),
  revision: z.number().int().nonnegative(),
  lastSeenAt: z.number().finite().nonnegative(),
  lifecycle: z.enum(['active', 'stale', 'released'])
})

const fileSchema = z.strictObject({
  schemaVersion: z.literal(IDENTITY_BRIDGE_SCHEMA_VERSION),
  records: z.array(recordSchema)
})

export class IdentityBridgeStore {
  constructor(private readonly path: string) {}

  async load(): Promise<IdentityBridgeRecord[]> {
    let raw: string
    try {
      raw = await readFile(this.path, 'utf8')
    } catch {
      return []
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return []
    }
    const result = fileSchema.safeParse(parsed)
    if (!result.success) {
      return []
    }
    return result.data.records.flatMap((record) => {
      const host = parseExecutionHostId(record.executionHostId)
      return host ? [{ ...record, executionHostId: host.id }] : []
    })
  }

  async save(records: readonly IdentityBridgeRecord[]): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true })
    const payload = JSON.stringify(
      { schemaVersion: IDENTITY_BRIDGE_SCHEMA_VERSION, records },
      null,
      2
    )
    await writeFileDurable(durableWriteTempPath(this.path), this.path, payload)
  }
}

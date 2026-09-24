// Pure reconciliation for the session-to-pane identity bridge (Task 13).
//
// No fs, no Electron: the caller supplies persisted records, live terminal
// inventory, and authenticated hook correlations. Every consumer must run this
// before trusting a mapping — resolve() in the service does exactly that.
import type { ExecutionHostId } from './execution-host'
import {
  identityBridgeKey,
  type HookCorrelation,
  type IdentityBridgeRecord,
  type IdentityBridgeRejectionReason,
  type LiveInventory,
  type LiveTerminalHandle,
  type ReconciliationResult,
  type RejectedRecord
} from './identity-bridge-types'

const SEP = '\u0000'

function leafKey(tabId: string, leafId: string): string {
  return `${tabId}${SEP}${leafId}`
}

function leafTokenKey(
  host: ExecutionHostId,
  tabId: string,
  leafId: string,
  launchToken: string
): string {
  return `${host}${SEP}${tabId}${SEP}${leafId}${SEP}${launchToken}`
}

function sessionKey(host: ExecutionHostId, canonicalRoot: string, sessionID: string): string {
  return `${host}${SEP}${canonicalRoot}${SEP}${sessionID}`
}

function indexBy<T>(items: readonly T[], keyOf: (item: T) => string): Map<string, T[]> {
  const index = new Map<string, T[]>()
  for (const item of items) {
    const key = keyOf(item)
    const bucket = index.get(key)
    if (bucket) {
      bucket.push(item)
    } else {
      index.set(key, [item])
    }
  }
  return index
}

type RecordVerdict = IdentityBridgeRejectionReason | 'stale' | null

function validateRecord(
  record: IdentityBridgeRecord,
  terminalsByLeaf: ReadonlyMap<string, LiveTerminalHandle[]>,
  correlationsByLeafToken: ReadonlyMap<string, HookCorrelation[]>,
  connectedHosts: ReadonlySet<ExecutionHostId>
): RecordVerdict {
  // A disconnected remote host is not evidence of death (SSH boundary): keep the
  // mapping, mark it stale, and never resolve it.
  if (!connectedHosts.has(record.executionHostId)) {
    return 'stale'
  }
  const bucket = terminalsByLeaf.get(leafKey(record.tabId, record.leafId)) ?? []
  const terminals = bucket.filter((terminal) => terminal.executionHostId === record.executionHostId)
  if (terminals.length === 0) {
    return bucket.length > 0 ? 'host-mismatch' : 'stale-handle'
  }
  if (terminals.length > 1) {
    return 'ambiguous-leaf'
  }
  const terminal = terminals[0]
  if (terminal.terminalHandle !== record.terminalHandle) {
    return 'stale-handle'
  }
  if (terminal.launchToken !== undefined && terminal.launchToken !== record.launchToken) {
    return 'reused-terminal'
  }
  const correlations = correlationsByLeafToken.get(
    leafTokenKey(record.executionHostId, record.tabId, record.leafId, record.launchToken)
  )
  if (!correlations || correlations.length === 0) {
    return 'unverified'
  }
  const confirmed = correlations.some(
    (correlation) =>
      correlation.sessionID === record.sessionID &&
      correlation.canonicalRoot === record.canonicalRoot
  )
  return confirmed ? null : 'unverified'
}

function buildCandidate(
  correlation: HookCorrelation,
  terminalsByLeaf: ReadonlyMap<string, LiveTerminalHandle[]>,
  now: number
): IdentityBridgeRecord | null {
  const terminals = (
    terminalsByLeaf.get(leafKey(correlation.tabId, correlation.leafId)) ?? []
  ).filter((terminal) => terminal.executionHostId === correlation.executionHostId)
  if (terminals.length !== 1) {
    return null
  }
  const terminal = terminals[0]
  if (terminal.launchToken !== undefined && terminal.launchToken !== correlation.launchToken) {
    return null
  }
  return {
    executionHostId: terminal.executionHostId,
    canonicalRoot: correlation.canonicalRoot,
    sessionID: correlation.sessionID,
    launchToken: correlation.launchToken,
    worktreeIdentity: terminal.worktreeIdentity,
    tabId: terminal.tabId,
    leafId: terminal.leafId,
    terminalHandle: terminal.terminalHandle,
    revision: 1,
    lastSeenAt: now,
    lifecycle: 'active'
  }
}

function resolveAmbiguity(
  active: IdentityBridgeRecord[],
  stale: IdentityBridgeRecord[],
  released: IdentityBridgeRecord[],
  rejected: RejectedRecord[]
): ReconciliationResult {
  const bySession = indexBy(active, (record) =>
    sessionKey(record.executionHostId, record.canonicalRoot, record.sessionID)
  )
  const kept: IdentityBridgeRecord[] = []
  for (const group of bySession.values()) {
    if (group.length === 1) {
      kept.push(group[0])
      continue
    }
    const leaves = new Set(group.map((record) => leafKey(record.tabId, record.leafId)))
    if (leaves.size > 1) {
      for (const record of group) {
        rejected.push({ record, reason: 'ambiguous-leaf' })
      }
      continue
    }
    for (const record of group) {
      rejected.push({ record, reason: 'duplicate-root' })
    }
  }
  return { verified: [...kept, ...stale, ...released], rejected }
}

export function reconcileIdentityBridge(input: {
  readonly records: readonly IdentityBridgeRecord[]
  readonly inventory: LiveInventory
  readonly correlations: readonly HookCorrelation[]
  readonly now: number
}): ReconciliationResult {
  const terminalsByLeaf = indexBy(input.inventory.terminals, (terminal) =>
    leafKey(terminal.tabId, terminal.leafId)
  )
  const correlationsByLeafToken = indexBy(input.correlations, (correlation) =>
    leafTokenKey(
      correlation.executionHostId,
      correlation.tabId,
      correlation.leafId,
      correlation.launchToken
    )
  )
  const connectedHosts = new Set(input.inventory.connectedHosts)

  const active: IdentityBridgeRecord[] = []
  const stale: IdentityBridgeRecord[] = []
  const released: IdentityBridgeRecord[] = []
  const rejected: RejectedRecord[] = []

  for (const record of input.records) {
    // Released mappings await pruning; never re-activate them from live state.
    if (record.lifecycle === 'released') {
      released.push(record)
      continue
    }
    const verdict = validateRecord(record, terminalsByLeaf, correlationsByLeafToken, connectedHosts)
    if (verdict === 'stale') {
      stale.push({ ...record, lifecycle: 'stale' })
      continue
    }
    if (verdict !== null) {
      rejected.push({ record, reason: verdict })
      continue
    }
    active.push({
      ...record,
      revision: record.revision + 1,
      lastSeenAt: input.now,
      lifecycle: 'active'
    })
  }

  const seen = new Set([
    ...active.map(identityBridgeKey),
    // A released mapping must never re-activate from live state: a
    // correlation replaying a released identity (same launch token) is not a
    // fresh verified launch and must not adopt a new record.
    ...released.map(identityBridgeKey)
  ])
  for (const correlation of input.correlations) {
    const candidate = buildCandidate(correlation, terminalsByLeaf, input.now)
    if (candidate === null) {
      continue
    }
    const key = identityBridgeKey(candidate)
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    active.push(candidate)
  }

  return resolveAmbiguity(active, stale, released, rejected)
}

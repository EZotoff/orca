// Session-to-pane identity bridge service (orca-transition plan Task 13).
//
// Owns the Orca-side cache of verified session→leaf mappings. Every consumer
// must reconcile before trusting a mapping: resolve() reconciles first and
// returns only entries that survived. The hook correlation seam is injectable
// so Task 16 can plug in the authenticated hook without touching this module.
import type { ExecutionHostId } from '../../shared/execution-host'
import { reconcileIdentityBridge } from '../../shared/identity-bridge-reconcile'
import {
  identityBridgeKey,
  type HookCorrelation,
  type HookCorrelationSource,
  type IdentityBridgeRecord,
  type LiveInventorySource,
  type ReconciliationResult,
  type ResolvedLeaf
} from '../../shared/identity-bridge-types'
import type { IdentityBridgeStore } from './identity-bridge-store'

export type IdentityBridgeOptions = {
  readonly store: IdentityBridgeStore
  readonly inventory: LiveInventorySource
  readonly correlations: HookCorrelationSource
  readonly now?: () => number
}

export type SessionQuery = {
  readonly executionHostId: ExecutionHostId
  readonly canonicalRoot: string
  readonly sessionID: string
}

export class IdentityBridge {
  private readonly store: IdentityBridgeStore
  private readonly inventory: LiveInventorySource
  private readonly correlations: HookCorrelationSource
  private readonly now: () => number
  private records: IdentityBridgeRecord[] = []
  private loaded = false

  constructor(options: IdentityBridgeOptions) {
    this.store = options.store
    this.inventory = options.inventory
    this.correlations = options.correlations
    this.now = options.now ?? Date.now
  }

  async load(): Promise<void> {
    this.records = await this.store.load()
    this.loaded = true
  }

  /** Reconcile persisted mappings against live inventory + hook correlations, then persist. */
  async reconcile(): Promise<ReconciliationResult> {
    if (!this.loaded) {
      await this.load()
    }
    const [inventory, correlations] = await Promise.all([
      this.inventory.listInventory(),
      this.correlations.listCorrelations()
    ])
    const result = reconcileIdentityBridge({
      records: this.records,
      inventory,
      correlations,
      now: this.now()
    })
    this.records = [...result.verified]
    await this.store.save(this.records)
    return result
  }

  /** Persist one hook-verified mapping immediately, before the next reconcile. */
  async recordCorrelation(correlation: HookCorrelation): Promise<IdentityBridgeRecord | null> {
    if (!this.loaded) {
      await this.load()
    }
    const inventory = await this.inventory.listInventory()
    const terminals = inventory.terminals.filter(
      (candidate) =>
        candidate.executionHostId === correlation.executionHostId &&
        candidate.tabId === correlation.tabId &&
        candidate.leafId === correlation.leafId
    )
    if (terminals.length !== 1 || !inventory.connectedHosts.includes(correlation.executionHostId)) {
      return null
    }
    const terminal = terminals[0]
    if (terminal.launchToken !== undefined && terminal.launchToken !== correlation.launchToken) {
      return null
    }
    const key = identityBridgeKey({
      executionHostId: terminal.executionHostId,
      canonicalRoot: correlation.canonicalRoot,
      sessionID: correlation.sessionID,
      launchToken: correlation.launchToken
    })
    const existing = this.records.find((candidate) => identityBridgeKey(candidate) === key)
    if (existing?.lifecycle === 'released') {
      return null
    }
    const record: IdentityBridgeRecord = {
      executionHostId: terminal.executionHostId,
      canonicalRoot: correlation.canonicalRoot,
      sessionID: correlation.sessionID,
      launchToken: correlation.launchToken,
      worktreeIdentity: terminal.worktreeIdentity,
      tabId: terminal.tabId,
      leafId: terminal.leafId,
      terminalHandle: terminal.terminalHandle,
      revision: existing ? existing.revision + 1 : 1,
      lastSeenAt: this.now(),
      lifecycle: 'active'
    }
    this.records = [
      ...this.records
        .filter((candidate) => identityBridgeKey(candidate) !== key)
        .map((candidate) =>
          candidate.lifecycle === 'active' &&
          candidate.executionHostId === terminal.executionHostId &&
          candidate.canonicalRoot === correlation.canonicalRoot &&
          candidate.sessionID === correlation.sessionID
            ? { ...candidate, lifecycle: 'released' as const, lastSeenAt: this.now() }
            : candidate
        ),
      record
    ]
    await this.store.save(this.records)
    return record
  }

  /** Reconcile, then return the verified leaf for a session — or null when unverified. */
  async resolve(query: SessionQuery): Promise<ResolvedLeaf | null> {
    const result = await this.reconcile()
    const matches = result.verified.filter(
      (record) =>
        record.lifecycle === 'active' &&
        record.executionHostId === query.executionHostId &&
        record.canonicalRoot === query.canonicalRoot &&
        record.sessionID === query.sessionID
    )
    if (matches.length !== 1) {
      return null
    }
    const match = matches[0]
    return {
      executionHostId: match.executionHostId,
      canonicalRoot: match.canonicalRoot,
      sessionID: match.sessionID,
      launchToken: match.launchToken,
      worktreeIdentity: match.worktreeIdentity,
      tabId: match.tabId,
      leafId: match.leafId,
      terminalHandle: match.terminalHandle,
      revision: match.revision
    }
  }

  /** PTY exit: mark every mapping for this terminal released. */
  async releaseByTerminal(terminalHandle: string): Promise<void> {
    await this.markReleased((record) => record.terminalHandle === terminalHandle)
  }

  /** Tab close: mark every mapping for this tab released. */
  async releaseByTab(tabId: string): Promise<void> {
    await this.markReleased((record) => record.tabId === tabId)
  }

  /** Project/worktree removal: mark every mapping for this worktree released. */
  async releaseByWorktree(worktreeIdentity: string): Promise<void> {
    await this.markReleased((record) => record.worktreeIdentity === worktreeIdentity)
  }

  /** Drop released mappings past retention. Returns how many were pruned. */
  async pruneReleased(olderThanMs: number): Promise<number> {
    if (!this.loaded) {
      await this.load()
    }
    const cutoff = this.now() - olderThanMs
    const kept = this.records.filter(
      (record) => record.lifecycle !== 'released' || record.lastSeenAt > cutoff
    )
    const pruned = this.records.length - kept.length
    if (pruned > 0) {
      this.records = kept
      await this.store.save(this.records)
    }
    return pruned
  }

  private async markReleased(predicate: (record: IdentityBridgeRecord) => boolean): Promise<void> {
    if (!this.loaded) {
      await this.load()
    }
    let changed = false
    this.records = this.records.map((record) => {
      if (record.lifecycle === 'released' || !predicate(record)) {
        return record
      }
      changed = true
      return { ...record, lifecycle: 'released', lastSeenAt: this.now() }
    })
    if (changed) {
      await this.store.save(this.records)
    }
  }
}

// Session-to-pane identity bridge types (orca-transition plan Task 13).
//
// The bridge is a CACHE of verified identity, never authority: a mapping is
// trusted only after reconciliation against live terminal inventory and an
// authenticated hook correlation. Binding spec: design 40-oracle-design.md §5
// "Session-to-pane identity contract".
import type { ExecutionHostId } from './execution-host'

/** `active` = verified now; `stale` = host unreachable, kept but not resolvable; `released` = PTY/tab/worktree gone. */
export type IdentityBridgeLifecycle = 'active' | 'stale' | 'released'

/** Why a persisted mapping was rejected during reconciliation. */
export type IdentityBridgeRejectionReason =
  | 'stale-handle'
  | 'host-mismatch'
  | 'reused-terminal'
  | 'unverified'
  | 'duplicate-root'
  | 'ambiguous-leaf'

/** Orca-side launch identity for one hosted OpenCode PTY. */
export type OrcaLaunchIdentity = {
  readonly executionHostId: ExecutionHostId
  /** Canonical worktree identity key (`wt2:<host>:<instanceId>`), not the mutable worktreeId. */
  readonly worktreeIdentity: string
  readonly tabId: string
  readonly leafId: string
  /** Runtime terminal handle (`RuntimeTerminalSummary.handle`). */
  readonly terminalHandle: string
  readonly launchToken: string
}

/** OpenCode-side identity from the authenticated hook (Task 16). */
export type OpenCodeSessionIdentity = {
  readonly sessionID: string
  /** Canonical project root reported by the hook. */
  readonly canonicalRoot: string
}

/** A persisted session→leaf mapping, keyed by (host, canonicalRoot, sessionID, launchToken). */
export type IdentityBridgeRecord = OrcaLaunchIdentity &
  OpenCodeSessionIdentity & {
    readonly revision: number
    readonly lastSeenAt: number
    readonly lifecycle: IdentityBridgeLifecycle
  }

/** The four-tuple that identifies a mapping. */
export type IdentityBridgeKey = {
  readonly executionHostId: ExecutionHostId
  readonly canonicalRoot: string
  readonly sessionID: string
  readonly launchToken: string
}

/** A live terminal as reported by `terminal.list`, reduced to bridge fields. */
export type LiveTerminalHandle = {
  readonly executionHostId: ExecutionHostId
  readonly worktreeIdentity: string
  readonly tabId: string
  readonly leafId: string
  readonly terminalHandle: string
  /** Present when the host can report the launch token for this PTY. */
  readonly launchToken?: string
}

/** Live terminal inventory plus host reachability. */
export type LiveInventory = {
  readonly terminals: readonly LiveTerminalHandle[]
  /** Hosts currently reachable. A remote host absent here is disconnected, not empty. */
  readonly connectedHosts: readonly ExecutionHostId[]
}

/** What the authenticated hook reports for one live PTY (Task 16). */
export type HookCorrelation = {
  readonly tabId: string
  readonly leafId: string
  readonly launchToken: string
  readonly sessionID: string
  readonly canonicalRoot: string
}

/** Injectable correlation seam. Task 16 supplies the real hook-backed source. */
export type HookCorrelationSource = {
  listCorrelations(): Promise<readonly HookCorrelation[]>
}

/** Injectable live-inventory seam (`session.tabs.list` / `terminal.list`). */
export type LiveInventorySource = {
  listInventory(): Promise<LiveInventory>
}

/** A verified mapping returned by resolve(). */
export type ResolvedLeaf = OrcaLaunchIdentity &
  OpenCodeSessionIdentity & {
    readonly revision: number
  }

export type RejectedRecord = {
  readonly record: IdentityBridgeRecord
  readonly reason: IdentityBridgeRejectionReason
}

export type ReconciliationResult = {
  readonly verified: readonly IdentityBridgeRecord[]
  readonly rejected: readonly RejectedRecord[]
}

/** Stable string key for a mapping. NUL-separated so no field can forge a boundary. */
export function identityBridgeKey(key: IdentityBridgeKey): string {
  return [key.executionHostId, key.canonicalRoot, key.sessionID, key.launchToken]
    .map((part) => encodeURIComponent(part))
    .join('\u0000')
}

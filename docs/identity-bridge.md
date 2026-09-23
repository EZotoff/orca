# Identity bridge — session-to-pane mapping

Orca-owned, host-qualified mapping from an OpenCode session to the Orca terminal
leaf that hosts it. Implemented in `src/shared/identity-bridge-*.ts` (pure model +
reconciliation) and `src/main/identity-bridge/` (persistence + service), per the
orca-transition plan Task 13 and design `40-oracle-design.md` §5.

## The mapping is a cache, not authority

A mapping is trusted only after reconciliation against live terminal inventory
and an authenticated hook correlation. `IdentityBridge.resolve()` reconciles
first and returns only entries that survived; there is no API that hands out an
unverified mapping. A session created outside Orca is never mapped — the bridge
only records correlations the hook actually reports.

## Identity model

Orca-side launch identity (actual fork field names):

| Concept | Field | Source |
|---|---|---|
| Execution host | `executionHostId` | `ExecutionHostId` (`local` / `ssh:<target>` / `runtime:<env>`) |
| Worktree | `worktreeIdentity` | canonical `wt2:<host>:<instanceId>` key, not the mutable `worktreeId` |
| Tab | `tabId` | `TerminalTab.id` |
| Leaf | `leafId` | `TerminalPaneLayoutNode` leaf UUID |
| Terminal | `terminalHandle` | `RuntimeTerminalSummary.handle` |
| Launch | `launchToken` | ephemeral token stamped into the PTY env, echoed by the hook |

OpenCode-side identity comes from the authenticated hook (Task 16): `sessionID`
and `canonicalRoot`.

## Persistence

- Location: `<userData>/identity-bridge.json` (`defaultIdentityBridgePath()`;
  `ORCA_IDENTITY_BRIDGE_PATH` overrides for tests). This is new Orca-owned state,
  not a change to any existing persistence schema.
- Key: `(executionHostId, canonicalRoot, sessionID, launchToken)`.
- Fields per record: the identity above plus `revision`, `lastSeenAt`, `lifecycle`.
- Writes are durable and atomic (temp file + fsync + rename via
  `writeFileDurable`). A missing, corrupt, or schema-invalid image loads as empty
  rather than poisoning resolution.

## Reconciliation

Runs on restart and on every focus request (`resolve()` calls it). It joins
persisted records with live `terminal.list` inventory and hook correlations, and
rejects a record for exactly one reason:

| Reason | Meaning |
|---|---|
| `stale-handle` | the leaf's terminal is gone or was remounted with a new handle |
| `host-mismatch` | the live terminal is on a different execution host |
| `reused-terminal` | the live terminal's launch token differs (the PTY was reused) |
| `unverified` | no authenticated hook correlation confirms this session/root |
| `duplicate-root` | the same session maps to the same leaf more than once (newest revision wins) |
| `ambiguous-leaf` | the same session correlates to more than one live leaf (all rejected) |

A disconnected remote host is **not** evidence of death (SSH boundary): its
records are kept with `lifecycle: 'stale'` and are never resolved, rather than
rejected. A session that moves after reattach rebinds only when the hook reports
the new leaf; the old record then fails `unverified`/`stale-handle` and the new
correlation creates a fresh record.

## Retention and cleanup

- **PTY exit** → `releaseByTerminal(handle)` marks the mapping `released`.
- **Tab close** → `releaseByTab(tabId)`.
- **Project/worktree removal** → `releaseByWorktree(worktreeIdentity)`.
- Released mappings are preserved (never re-activated by reconciliation) and
  dropped by `pruneReleased(olderThanMs)` once past the retention window.

## Sequence note

The authenticated hook lands in Task 16. This task ships the persistence and
reconciliation skeleton plus the injectable `HookCorrelationSource` seam; the
end-to-end correlation tests are deferred (`identity-bridge-e2e-correlation.test.ts`)
and run after Task 16. Task 14's focus action consumes `resolve()`.

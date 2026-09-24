import {
  DASHBOARD_BUCKET_ORDER,
  type DashboardBucket,
  type DashboardCard,
  type DashboardSnapshot
} from '../../../../shared/dashboard-snapshot'
import type { ExecutionHostId } from '../../../../shared/execution-host'

/**
 * Persistent-rail derivation (orca-transition Task 10): one row per project,
 * including projects whose sessions are all idle or unknown (no card at all).
 * Status buckets come straight from the snapshot's cards — the same
 * AgentKanbanBoard status derivation the G2 decision retains.
 */

export type OverviewRailEntry = {
  /** Project label (repoName, falling back to the worktree name). */
  name: string
  /** Needs You count, shown on the rail row when the panel is collapsed. */
  attention: number
  /** Every bucket this project currently has a card in. */
  statuses: DashboardBucket[]
  /** Highest-priority hosted card — the row's jump target when one exists. */
  jumpCard: DashboardCard | null
  /** Workspace identity so cardless projects stay activatable. */
  workspace: {
    worktreeId: string
    repoId: string
    executionHostId?: ExecutionHostId
  } | null
}

function projectNameOf(card: DashboardCard): string {
  return card.repoName || card.worktreeName
}

/** Bucket order first (Needs You beats Working…), then most-recently-moved. */
function compareJumpPriority(a: DashboardCard, b: DashboardCard): number {
  const bucketDelta =
    DASHBOARD_BUCKET_ORDER.indexOf(a.bucket) - DASHBOARD_BUCKET_ORDER.indexOf(b.bucket)
  return bucketDelta !== 0 ? bucketDelta : b.stateChangedAt - a.stateChangedAt
}

export function buildOverviewRailEntries(snapshot: DashboardSnapshot): OverviewRailEntry[] {
  const byName = new Map<string, OverviewRailEntry>()
  for (const card of snapshot.cards) {
    const name = projectNameOf(card)
    let entry = byName.get(name)
    if (!entry) {
      entry = { name, attention: 0, statuses: [], jumpCard: null, workspace: null }
      byName.set(name, entry)
    }
    if (card.bucket === 'attention') {
      entry.attention += 1
    }
    if (!entry.statuses.includes(card.bucket)) {
      entry.statuses.push(card.bucket)
    }
    if (entry.jumpCard === null || compareJumpPriority(card, entry.jumpCard) < 0) {
      entry.jumpCard = card
    }
    entry.workspace ??= {
      worktreeId: card.worktreeId,
      repoId: card.repoId,
      ...(card.executionHostId ? { executionHostId: card.executionHostId } : {})
    }
  }
  // Projects with no agent card (idle/unknown sessions) still get a rail row.
  for (const workspace of snapshot.workspaces ?? []) {
    const name = workspace.repoName || workspace.worktreeName
    if (!byName.has(name)) {
      byName.set(name, {
        name,
        attention: 0,
        statuses: [],
        jumpCard: null,
        workspace: {
          worktreeId: workspace.worktreeId,
          repoId: workspace.repoId,
          ...(workspace.executionHostId ? { executionHostId: workspace.executionHostId } : {})
        }
      })
    }
  }
  // Scan order: projects needing input first, then alphabetical for stability.
  return [...byName.values()].sort(
    (a, b) => b.attention - a.attention || a.name.localeCompare(b.name)
  )
}

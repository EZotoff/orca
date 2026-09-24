import {
  DASHBOARD_BUCKET_ORDER,
  type DashboardBucket,
  type DashboardCard,
  type DashboardSnapshot
} from '../../../../shared/dashboard-snapshot'

/**
 * Widget-set counts derivation (orca-transition Task 11, design §7 widgets
 * 1–2): Needs You / Working / Done / Idle totals grounded in the same bucket
 * derivation as AgentKanbanBoard. "Done" stays an Orca agent-status bucket —
 * it is never folded into Supervisor escalations, and unseen (unread) cards
 * stay distinct from errored/attention via their own bucket.
 */
export type OverviewBucketCounts = Readonly<Record<DashboardBucket, number>>

export function countBuckets(cards: readonly DashboardCard[]): OverviewBucketCounts {
  const counts: Record<DashboardBucket, number> = { attention: 0, working: 0, done: 0, idle: 0 }
  for (const card of cards) {
    counts[card.bucket] += 1
  }
  return counts
}

/** Widget 1: total Needs You across all projects (rail keeps per-project counts). */
export function needsYouCount(cards: readonly DashboardCard[]): number {
  return cards.filter((card) => card.bucket === 'attention').length
}

export type OverviewCountChip = {
  bucket: DashboardBucket
  count: number
}

/** Chips in bucket order; a chip with count 0 still renders (fixed widget set). */
export function buildOverviewCountChips(snapshot: DashboardSnapshot): OverviewCountChip[] {
  const counts = countBuckets(snapshot.cards)
  return DASHBOARD_BUCKET_ORDER.map((bucket) => ({ bucket, count: counts[bucket] }))
}

/**
 * Widget 2 label: the card's agent identity plus live subagent names. The
 * conversation name stays the primary label; subagents ride along so the
 * operator can see WHICH agents a project is running at a glance.
 */
export type OverviewCardLabels = {
  project: string
  title: string
  subagentNames: readonly string[]
}

export function cardLabelsOf(card: DashboardCard): OverviewCardLabels {
  return {
    project: card.repoName || card.worktreeName,
    title: card.conversationName ?? card.task,
    subagentNames: (card.subagents ?? []).map((subagent) => subagent.name)
  }
}

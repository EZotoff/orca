import {
  DASHBOARD_BUCKET_ORDER,
  type DashboardBucket,
  type DashboardCard,
  type DashboardSnapshot
} from '../../../../shared/dashboard-snapshot'

/**
 * Dense-vertical-list derivation (orca-transition Task 10, G2 decision):
 * priority bands in bucket order instead of the board's four columns, which
 * cannot fit unscrolled at the favored panel width. Grouping and the
 * most-recently-moved-first sort mirror AgentKanbanBoard exactly — only the
 * geometry changed, not the status derivation.
 */

export type OverviewBand = {
  bucket: DashboardBucket
  cards: DashboardCard[]
}

export function buildOverviewBands(snapshot: DashboardSnapshot): OverviewBand[] {
  const visibleBuckets = DASHBOARD_BUCKET_ORDER.filter(
    (bucket) => bucket !== 'idle' || snapshot.showIdle === true
  )
  return visibleBuckets.map((bucket) => ({
    bucket,
    cards: snapshot.cards
      .filter((card) => card.bucket === bucket)
      .sort((a, b) => b.stateChangedAt - a.stateChangedAt)
  }))
}

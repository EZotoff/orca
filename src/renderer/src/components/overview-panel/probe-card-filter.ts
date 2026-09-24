import type { DashboardCard, DashboardSnapshot } from '../../../../shared/dashboard-snapshot'

/**
 * Probe/throwaway classification for the overview panel — mirrors the
 * Supervisor read-model contract clause (f): sessions classified as
 * autonomous probe/throwaway traffic (the omo-focus "PROBE-OK" class) are
 * excluded BEFORE card derivation, so a probe burst neither surfaces a
 * Needs You row nor displaces a real one, and never becomes a jump target.
 */

const PROBE_TITLE_PATTERNS: readonly RegExp[] = [
  /^(?:GLM-SJ-|GLM-JUDGE-|OPENAI-|K3-)?PROBE-OK(?: probe| reply test)?$/i,
  /^(?:LB_OK|PROBE_OK|SMOKE_OK|COMPLIANCE_OK)$/,
  /^(?:Model probe test|GLM-5\.3 probe (?:reply )?test(?: message)?|Probe request handling|OAuth probe request|Probe echo test|Probe message title|Probe reply test)$/
]

export function isProbeCard(card: DashboardCard): boolean {
  const title = card.conversationName
  return title !== undefined && PROBE_TITLE_PATTERNS.some((p) => p.test(title))
}

/** Applies the contract filter: probe cards are dropped from the snapshot. */
export function applyProbeFilter(snapshot: DashboardSnapshot): DashboardSnapshot {
  const cards = snapshot.cards.filter((card) => !isProbeCard(card))
  return { ...snapshot, cards }
}

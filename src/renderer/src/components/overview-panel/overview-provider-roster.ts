import type { ProviderRateLimits, RateLimitState } from '../../../../shared/rate-limit-types'
import type { TuiAgent } from '../../../../shared/tui-agent'
import type { StatusBarItem } from '../../../../shared/ui-chrome-types'
import {
  getVisibleUsageProvider,
  type UsageProviderSettings
} from '../status-bar/status-bar-provider-visibility'
import { isStatusBarItemAvailable } from '../status-bar/status-bar-agent-gating'

/**
 * Widget 5 (orca-transition Task 11, design §7): the existing provider
 * rate-limit/usage meter mounted in the overview panel. Pure roster
 * derivation mirroring the status bar controller exactly — same
 * getVisibleUsageProvider visibility rules, same PATH-detection gating, same
 * operator statusBarItems checks — so the panel adds NO new quota source and
 * never shows a provider the status bar would hide.
 */
export type OverviewProviderRosterInputs = {
  rateLimits: RateLimitState
  statusBarItems: readonly StatusBarItem[]
  detectedAgentIds: TuiAgent[] | null
  settings: Partial<UsageProviderSettings> | null | undefined
}

export function deriveOverviewProviderRoster(
  inputs: OverviewProviderRosterInputs
): ProviderRateLimits[] {
  const { rateLimits, statusBarItems, detectedAgentIds, settings } = inputs
  const items = new Set(statusBarItems)
  // Antigravity has no persisted credential: a checked status item + detected
  // CLI is the durable "show its slot" signal (same rationale as the bar).
  const antigravityUsageConfigured =
    items.has('antigravity') && isStatusBarItemAvailable('antigravity', detectedAgentIds)
  const usageSettings: Partial<UsageProviderSettings> = {
    ...settings,
    antigravityUsageConfigured,
    minimaxCookieConfigured: rateLimits.minimaxCookieConfigured,
    minimaxApiKeyConfigured: rateLimits.minimaxApiKeyConfigured,
    grokAuthConfigured: rateLimits.grokAuthConfigured
  }
  const candidates: readonly {
    item: ProviderRateLimits['provider']
    snapshot: ProviderRateLimits | null | undefined
    gateOnDetection: boolean
  }[] = [
    { item: 'claude', snapshot: rateLimits.claude, gateOnDetection: true },
    { item: 'codex', snapshot: rateLimits.codex, gateOnDetection: true },
    { item: 'gemini', snapshot: rateLimits.gemini, gateOnDetection: true },
    // Web/cookie-auth providers are not CLIs on PATH, so detection-gating doesn't apply.
    { item: 'opencode-go', snapshot: rateLimits.opencodeGo, gateOnDetection: false },
    { item: 'kimi', snapshot: rateLimits.kimi, gateOnDetection: true },
    { item: 'antigravity', snapshot: rateLimits.antigravity, gateOnDetection: true },
    { item: 'minimax', snapshot: rateLimits.minimax, gateOnDetection: false },
    { item: 'grok', snapshot: rateLimits.grok, gateOnDetection: true }
  ]
  const roster: ProviderRateLimits[] = []
  for (const candidate of candidates) {
    if (!items.has(candidate.item)) {
      continue
    }
    if (candidate.gateOnDetection && !isStatusBarItemAvailable(candidate.item, detectedAgentIds)) {
      continue
    }
    const visible = getVisibleUsageProvider(
      candidate.item,
      candidate.snapshot,
      usageSettings
    )
    if (visible !== null) {
      roster.push(visible)
    }
  }
  return roster
}

import { describe, expect, it } from 'vitest'
import type { ProviderRateLimits, RateLimitState } from '../../../../shared/rate-limit-types'
import {
  deriveOverviewProviderRoster,
  type OverviewProviderRosterInputs
} from './overview-provider-roster'

function snapshot(provider: ProviderRateLimits['provider']): ProviderRateLimits {
  return {
    provider,
    session: { usedPercent: 42, windowMinutes: 300, resetsAt: null, resetDescription: null },
    weekly: null,
    updatedAt: 1,
    error: null,
    status: 'ok'
  }
}

const baseSettings = {
  codexManagedAccounts: [],
  claudeManagedAccounts: [],
  opencodeSessionCookie: undefined,
  geminiCliOAuthEnabled: false,
  antigravityUsageConfigured: false,
  minimaxCookieConfigured: false,
  minimaxApiKeyConfigured: false,
  grokAuthConfigured: false
}

function rateLimitsWith(
  overrides: Partial<RateLimitState>
): OverviewProviderRosterInputs['rateLimits'] {
  return {
    claude: null,
    codex: null,
    gemini: null,
    opencodeGo: null,
    kimi: null,
    antigravity: null,
    minimax: null,
    grok: null,
    minimaxCookieConfigured: false,
    minimaxApiKeyConfigured: false,
    grokAuthConfigured: false,
    claudeTarget: 'local' as never,
    codexTarget: 'local' as never,
    inactiveClaudeAccounts: [],
    ...overrides
  }
}

describe('deriveOverviewProviderRoster', () => {
  it('includes a live configured snapshot the operator left visible', () => {
    const roster = deriveOverviewProviderRoster({
      rateLimits: rateLimitsWith({ claude: snapshot('claude') }),
      statusBarItems: ['claude', 'ports'],
      detectedAgentIds: ['claude'],
      settings: baseSettings
    })
    expect(roster.map((p) => p.provider)).toEqual(['claude'])
  })

  it('drops providers the operator unchecked in status-bar items', () => {
    const roster = deriveOverviewProviderRoster({
      rateLimits: rateLimitsWith({ claude: snapshot('claude') }),
      statusBarItems: ['ports'],
      detectedAgentIds: ['claude'],
      settings: baseSettings
    })
    expect(roster).toEqual([])
  })

  it('drops CLI-gated providers PATH detection reports missing', () => {
    const roster = deriveOverviewProviderRoster({
      rateLimits: rateLimitsWith({ claude: snapshot('claude'), opencodeGo: snapshot('opencode-go') }),
      statusBarItems: ['claude', 'opencode-go'],
      detectedAgentIds: [],
      settings: baseSettings
    })
    // opencode-go is web/cookie-auth: no CLI gating applies.
    expect(roster.map((p) => p.provider)).toEqual(['opencode-go'])
  })

  it('never invents a provider the status bar would hide', () => {
    const roster = deriveOverviewProviderRoster({
      rateLimits: rateLimitsWith({ gemini: snapshot('gemini') }),
      // Gemini snapshot present but the operator never enabled the item.
      statusBarItems: ['claude'],
      detectedAgentIds: null,
      settings: baseSettings
    })
    expect(roster).toEqual([])
  })
})

import { useMemo } from 'react'
import { useAppStore } from '@/store'
import { normalizeStatusBarUsageMode } from '../../../../shared/status-bar-usage-mode'
import { normalizeUsagePercentageDisplay } from '../../../../shared/usage-percentage-display'
import { ProviderSegment } from '../status-bar/StatusBarProviderSegment'
import { deriveOverviewProviderRoster } from './overview-provider-roster'

/**
 * Widget 5: the existing provider rate-limit/usage meter as a panel footer.
 * Renders the SAME ProviderSegment the status bar renders, fed by the SAME
 * store slice and visibility derivation — no new quota source, no details
 * chrome (quota details stay an on-demand status-bar view).
 */
export function OverviewProviderMeter(): React.JSX.Element | null {
  const rateLimits = useAppStore((s) => s.rateLimits)
  const statusBarItems = useAppStore((s) => s.statusBarItems)
  const detectedAgentIds = useAppStore((s) => s.detectedAgentIds)
  const settings = useAppStore((s) => s.settings)
  const display = normalizeUsagePercentageDisplay(useAppStore((s) => s.usagePercentageDisplay))
  const mode = normalizeStatusBarUsageMode(useAppStore((s) => s.statusBarUsageMode))

  const roster = useMemo(
    () =>
      deriveOverviewProviderRoster({
        rateLimits,
        statusBarItems,
        detectedAgentIds,
        settings
      }),
    [rateLimits, statusBarItems, detectedAgentIds, settings]
  )

  if (roster.length === 0) {
    return null
  }
  return (
    <footer
      data-overview-provider-meter=""
      className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border px-3 py-1.5"
    >
      {roster.map((p) => (
        <ProviderSegment key={p.provider} p={p} compact display={display} mode={mode} />
      ))}
    </footer>
  )
}

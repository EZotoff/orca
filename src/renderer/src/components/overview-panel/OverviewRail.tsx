import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { bucketLabel } from '../dashboard-popout/AgentKanbanBoard'
import type { OverviewRailEntry } from './overview-rail-entries'

/**
 * The persistent project rail: always visible, one row per project (including
 * idle/unknown), per-project Needs You counts, and the panel collapse toggle.
 * This is the surface that replaces zellij's tab-bar/pane-title inventory.
 */

function railEntryLabel(entry: OverviewRailEntry): string {
  return entry.attention > 0
    ? translate('overviewPanel.rail.entryAttention', '{{name}} — {{count}} need you', {
        name: entry.name,
        count: entry.attention
      })
    : entry.name
}

export function OverviewRail({
  entries,
  collapsed,
  onToggle,
  onActivateEntry
}: {
  entries: OverviewRailEntry[]
  collapsed: boolean
  onToggle: () => void
  onActivateEntry: (entry: OverviewRailEntry) => void
}): React.JSX.Element {
  return (
    <nav
      aria-label={translate('overviewPanel.rail', 'Projects overview rail')}
      className="flex w-11 shrink-0 flex-col border-l border-border"
    >
      <button
        type="button"
        aria-label={
          collapsed
            ? translate('overviewPanel.expand', 'Expand overview panel')
            : translate('overviewPanel.collapse', 'Collapse overview panel')
        }
        data-overview-toggle=""
        onClick={onToggle}
        className="flex h-9 items-center justify-center border-b border-border text-muted-foreground hover:text-foreground"
      >
        {collapsed ? (
          <ChevronLeftIcon className="size-4" />
        ) : (
          <ChevronRightIcon className="size-4" />
        )}
      </button>
      <div className="scrollbar-sleek flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto py-1">
        {entries.map((entry) => (
          <button
            key={entry.name}
            type="button"
            data-overview-rail-project={entry.name}
            title={`${entry.name} — ${
              entry.statuses.length > 0
                ? entry.statuses.map(bucketLabel).join(', ')
                : translate('overviewPanel.rail.unknown', 'no live agent status')
            }`}
            aria-label={railEntryLabel(entry)}
            onClick={() => onActivateEntry(entry)}
            className="relative flex h-8 items-center justify-center rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <span
              className={`max-w-full truncate rounded bg-muted px-1 text-[10px] tabular-nums ${
                entry.attention > 0 ? 'font-bold text-agent-question-text' : 'text-muted-foreground'
              }`}
            >
              {entry.name.slice(0, 2)}
            </span>
            {entry.attention > 0 ? (
              <span
                data-overview-attention-count={entry.name}
                className="absolute -right-0.5 top-0.5 rounded-full bg-agent-question px-1 text-[9px] font-semibold leading-tight text-white"
              >
                {entry.attention}
              </span>
            ) : null}
          </button>
        ))}
      </div>
    </nav>
  )
}

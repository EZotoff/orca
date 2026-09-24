import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { useWorktreeById } from '@/store/selectors'
import { bucketLabel } from '../dashboard-popout/AgentKanbanBoard'
import { deriveRailGitIndicator } from './overview-rail-git'
import type { OverviewRailEntry } from './overview-rail-entries'

/**
 * The persistent project rail: always visible, one row per project (including
 * idle/unknown), per-project Needs You counts, the panel collapse toggle, and
 * the widget-4 git indicator (branch label + dirty dot, reusing the sidebar's
 * worktree.branch / gitStatusByWorktree data — never its own git reads).
 * This is the surface that replaces zellij's tab-bar/pane-title inventory.
 */

/**
 * Widget 4: compact branch/dirty indicator riding the rail row. Reads the
 * same cached git data the sidebar indicators use; renders nothing when the
 * workspace has no git identity (folder workspaces, not-yet-loaded worktrees).
 */
function OverviewRailGitBadge({ entry }: { entry: OverviewRailEntry }): React.JSX.Element | null {
  const worktree = useWorktreeById(entry.workspace?.worktreeId ?? null)
  const dirtyCount = useAppStore((s) =>
    entry.workspace ? (s.gitStatusByWorktree[entry.workspace.worktreeId]?.length ?? 0) : 0
  )
  if (!worktree) {
    return null
  }
  const indicator = deriveRailGitIndicator({
    branch: worktree.branch,
    head: worktree.head,
    dirtyCount
  })
  if (indicator === null) {
    return null
  }
  return (
    <span
      data-overview-rail-git={entry.name}
      title={`${indicator.label}${indicator.dirty ? ` · ${indicator.dirtyCount} uncommitted` : ''}`}
      className="flex max-w-full items-center gap-0.5 text-[9px] leading-none text-muted-foreground"
    >
      <span className="truncate">{indicator.label}</span>
      {indicator.dirty && (
        <span
          data-overview-rail-dirty={entry.name}
          className="size-1 shrink-0 rounded-full bg-amber-500"
          aria-label={`${indicator.dirtyCount} uncommitted changes`}
        />
      )}
    </span>
  )
}

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
            className="relative flex h-10 flex-col items-center justify-center gap-0.5 rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <span
              className={`max-w-full truncate rounded bg-muted px-1 text-[10px] tabular-nums ${
                entry.attention > 0 ? 'font-bold text-agent-question-text' : 'text-muted-foreground'
              }`}
            >
              {entry.name.slice(0, 2)}
            </span>
            <OverviewRailGitBadge entry={entry} />
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

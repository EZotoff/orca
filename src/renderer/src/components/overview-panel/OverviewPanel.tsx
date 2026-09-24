import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { GripVerticalIcon } from 'lucide-react'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { AgentStateDot } from '@/components/AgentStateDot'
import { activateAndRevealWorkspace } from '@/lib/worktree-activation'
import { installWindowVisibilityInterval } from '@/lib/window-visibility-interval'
import {
  dashboardCardDisplayState,
  type DashboardCard
} from '../../../../shared/dashboard-snapshot'
import { useLiveDashboardSnapshot } from '../dashboard/useLiveDashboardSnapshot'
import { revealDashboardAgent } from '../dashboard/reveal-dashboard-agent'
import { bucketLabel } from '../dashboard-popout/AgentKanbanBoard'
import { formatDashboardCardTime } from '../dashboard-popout/AgentKanbanCard'
import { applyProbeFilter } from './probe-card-filter'
import { buildOverviewBands } from './overview-bands'
import { buildOverviewCountChips, cardLabelsOf } from './overview-counts'
import { buildOverviewRailEntries, type OverviewRailEntry } from './overview-rail-entries'
import { OverviewRail } from './OverviewRail'
import { SupervisorRelayView } from '../supervisor-relay/SupervisorRelayView'

/**
 * First-party overview panel + persistent project rail (orca-transition Task 10,
 * G2 geometry decision: dense vertical list with priority bands, retaining the
 * AgentKanbanBoard status derivation). The rail stays visible when the panel is
 * collapsed so per-project Needs You counts never leave the screen. Widget 3
 * layers the Task-12 Supervisor relay (validated scalar card shape only) on
 * top; Orca agent-status buckets stay independent of Supervisor decisions.
 */

const OVERVIEW_PANEL_MIN_WIDTH = 200
const OVERVIEW_PANEL_MAX_WIDTH = 1600
const OVERVIEW_PANEL_DEFAULT_WIDTH = 480

/** Dense row: dot + project · label + relative time; click/Enter jumps to the pane. */
function OverviewCardRow({
  card,
  now,
  onJump
}: {
  card: DashboardCard
  now: number
  onJump: (card: DashboardCard) => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      data-overview-card={card.paneKey}
      title={card.askSummary ?? card.conversationName ?? card.task}
      onClick={() => onJump(card)}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <AgentStateDot state={dashboardCardDisplayState(card)} title={null} />
      <span className="min-w-0 flex-1 truncate text-[12px]">
        <span className="text-muted-foreground">{card.repoName || card.worktreeName}</span>
        {' · '}
        <span className={card.unseen ? 'font-semibold' : undefined}>
          {cardLabelsOf(card).title}
        </span>
        {card.subagents && card.subagents.length > 0 && (
          <span
            data-overview-subagents={card.paneKey}
            className="shrink-0 truncate text-[10px] text-muted-foreground/80"
            title={card.subagents.map((subagent) => subagent.name).join(', ')}
          >
            {`+${card.subagents.length}`}
          </span>
        )}
      </span>
      <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
        {formatDashboardCardTime(card, now)}
      </span>
    </button>
  )
}

export function OverviewPanel(): React.JSX.Element {
  const snapshot = useLiveDashboardSnapshot()
  // Contract clause (f): probe-class sessions never reach the rail, the list,
  // or a jump target.
  const filtered = useMemo(() => applyProbeFilter(snapshot), [snapshot])
  const entries = useMemo(() => buildOverviewRailEntries(filtered), [filtered])
  const bands = useMemo(() => buildOverviewBands(filtered), [filtered])
  const collapsed = useAppStore((s) => s.overviewPanelCollapsed)
  const setCollapsed = useAppStore((s) => s.setOverviewPanelCollapsed)
  const [width, setWidth] = useState(OVERVIEW_PANEL_DEFAULT_WIDTH)

  const hasRelativeTimestamps = useMemo(
    () => filtered.cards.some((card) => (card.finishedAt ?? card.startedAt) > 0),
    [filtered.cards]
  )
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!hasRelativeTimestamps) {
      return
    }
    return installWindowVisibilityInterval({
      run: () => setNow(Date.now()),
      intervalMs: 30_000
    })
  }, [hasRelativeTimestamps])

  const handleJumpCard = useCallback((card: DashboardCard) => {
    revealDashboardAgent({
      repoId: card.repoId,
      worktreeId: card.worktreeId,
      ...(card.executionHostId ? { executionHostId: card.executionHostId } : {}),
      tabId: card.tabId,
      leafId: card.leafId
    })
  }, [])
  const handleActivateEntry = useCallback(
    (entry: OverviewRailEntry) => {
      if (entry.jumpCard) {
        handleJumpCard(entry.jumpCard)
        return
      }
      // Cardless project (idle/unknown sessions): activate the workspace so the
      // operator lands on its terminal surface rather than nothing happening.
      if (entry.workspace) {
        activateAndRevealWorkspace(
          entry.workspace.worktreeId,
          entry.workspace.executionHostId
            ? { executionHostId: entry.workspace.executionHostId }
            : undefined
        )
      }
    },
    [handleJumpCard]
  )

  const draggingRef = useRef(false)
  const handleResizeStart = useCallback(
    (event: React.PointerEvent) => {
      event.preventDefault()
      const startX = event.clientX
      const startWidth = width
      draggingRef.current = true
      const move = (e: PointerEvent): void => {
        const next = Math.min(
          OVERVIEW_PANEL_MAX_WIDTH,
          Math.max(OVERVIEW_PANEL_MIN_WIDTH, startWidth + (startX - e.clientX))
        )
        setWidth(next)
      }
      const up = (): void => {
        draggingRef.current = false
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    },
    [width]
  )

  return (
    <aside
      data-overview-panel=""
      data-overview-collapsed={collapsed ? 'true' : 'false'}
      aria-label={translate('overviewPanel.title', 'Overview panel')}
      className="flex shrink-0 border-l border-border bg-background"
    >
      {collapsed ? null : (
        <section
          className="relative flex min-h-0 flex-col"
          style={{ width }}
          aria-label={translate('overviewPanel.list', 'Agent overview')}
        >
          <div
            onPointerDown={handleResizeStart}
            role="separator"
            aria-orientation="vertical"
            aria-label={translate('overviewPanel.resize', 'Resize overview panel')}
            data-overview-resize-handle=""
            className="absolute top-0 left-0 z-10 flex h-full w-1.5 cursor-col-resize items-center justify-center text-muted-foreground/50 hover:text-muted-foreground"
            // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: React.CSSProperties lacks the Electron-only WebkitAppRegion key; same pattern as TabGroupPanel.
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            <GripVerticalIcon className="size-3" />
          </div>
          <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
            <h2 className="text-[13px] font-semibold">
              {translate('dashboardPopout.title', 'Agents')}
            </h2>
            <span className="text-[11px] text-muted-foreground">
              {translate('dashboardPopout.total', '{{count}} total', {
                count: filtered.cards.length
              })}
            </span>
            <span
              data-overview-counts=""
              className="ml-auto flex items-center gap-1.5 pr-1 text-[11px] tabular-nums text-muted-foreground"
            >
              {buildOverviewCountChips(filtered).map((chip) => (
                <span
                  key={chip.bucket}
                  data-overview-count={chip.bucket}
                  title={bucketLabel(chip.bucket)}
                  className={chip.bucket === 'attention' && chip.count > 0 ? 'font-semibold text-agent-question-text' : undefined}
                >
                  {chip.count}
                </span>
              ))}
            </span>
          </header>
          <div data-overview-supervisor="" className="shrink-0 border-b border-border">
            <SupervisorRelayView />
          </div>
          <div className="scrollbar-sleek flex min-h-0 flex-1 flex-col overflow-y-auto pb-2">
            {filtered.cards.length === 0 ? (
              <p className="px-3 py-2 text-[11px] text-muted-foreground">
                {translate('overviewPanel.empty', 'No agents yet')}
              </p>
            ) : (
              bands.map((band) =>
                band.cards.length === 0 ? null : (
                  <section key={band.bucket} data-overview-band={band.bucket}>
                    <header className="flex items-center gap-2 px-3 pt-2 pb-1">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
                        {bucketLabel(band.bucket)}
                      </span>
                      <span className="rounded-full bg-muted px-1.5 text-[11px] tabular-nums text-muted-foreground">
                        {band.cards.length}
                      </span>
                    </header>
                    {band.cards.map((card) => (
                      <OverviewCardRow
                        key={card.paneKey}
                        card={card}
                        now={now}
                        onJump={handleJumpCard}
                      />
                    ))}
                  </section>
                )
              )
            )}
          </div>
        </section>
      )}
      <OverviewRail
        entries={entries}
        collapsed={collapsed}
        onToggle={() => setCollapsed(!collapsed)}
        onActivateEntry={handleActivateEntry}
      />
    </aside>
  )
}

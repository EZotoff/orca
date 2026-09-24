import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRightIcon, ChevronLeftIcon, GripVerticalIcon } from 'lucide-react'
import { AgentKanbanBoard } from '../dashboard-popout/AgentKanbanBoard'
import type { DashboardSnapshot } from '../../../../shared/dashboard-snapshot'
import { activateTabAndFocusPane } from '@/lib/activate-tab-and-focus-pane'
import { useAppStore } from '@/store'

/**
 * G2 density prototype (orca-transition plan Task 9). A resizable right-side
 * panel mounting the EXISTING AgentKanbanBoard beside the terminal workbench,
 * plus a collapsed project rail. Spike-only: enabled exclusively when
 * localStorage 'g2proto' === '1'; inert in normal use.
 *
 * CDP drives it through `window.__g2`:
 *   __g2.setSnapshot(snapshot)  — replace the board's snapshot (real density)
 *   __g2.jump(tabId, leafId)    — real focus jump through the store seam,
 *                                 returns timing + focus-verification facts
 *   __g2.state()                — width/collapsed/counts for the measurement log
 */

type G2JumpResult = {
  tabId: string
  leafId: string | null
  startedAt: number
  focusedAt: number | null
  elapsedMs: number | null
  activeTabMatches: boolean
  activePaneIndex: number | null
  verified: boolean
}

type G2Target = {
  tabId: string
  worktreeId: string
  leafIds: string[]
  activeLeafId: string | null
}

type G2Api = {
  setSnapshot: (snapshot: unknown) => void
  clearSnapshot: () => void
  jump: (tabId: string, leafId: string | null) => Promise<G2JumpResult>
  listTargets: () => G2Target[]
  state: () => Record<string, unknown>
}

declare global {
  interface Window {
    __g2?: G2Api
  }
}

const G2_STORAGE_FLAG = 'g2proto'
const G2_MIN_WIDTH = 200
const G2_MAX_WIDTH = 1600
const G2_DEFAULT_WIDTH = 480
const G2_RAIL_WIDTH = 44

function isTerminalPaneFocused(): boolean {
  const el = document.activeElement
  return el instanceof Element && el.closest('.pane') !== null
}

function activePaneIndex(): number | null {
  const el = document.activeElement
  if (!(el instanceof Element)) {
    return null
  }
  const panes = [...document.querySelectorAll('.pane')]
  return panes.findIndex((p) => p.contains(el))
}

export function g2PrototypeEnabled(): boolean {
  try {
    return window.localStorage.getItem(G2_STORAGE_FLAG) === '1'
  } catch {
    return false
  }
}

/** One rail row per project: status dot + Needs You count when collapsed. */
function railEntries(snapshot: DashboardSnapshot): {
  name: string
  attention: number
  statuses: string[]
}[] {
  const byName = new Map<string, { attention: number; statuses: Set<string> }>()
  for (const card of snapshot.cards) {
    const name = card.repoName || card.worktreeName
    const entry = byName.get(name) ?? { attention: 0, statuses: new Set<string>() }
    if (card.bucket === 'attention') {
      entry.attention += 1
    }
    entry.statuses.add(card.bucket)
    byName.set(name, entry)
  }
  return [...byName.entries()].map(([name, e]) => ({
    name,
    attention: e.attention,
    statuses: [...e.statuses]
  }))
}

export function G2DensityPrototype(): React.JSX.Element | null {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null)
  const [width, setWidth] = useState(G2_DEFAULT_WIDTH)
  const [collapsed, setCollapsed] = useState(false)
  const draggingRef = useRef(false)
  const snapshotRef = useRef<DashboardSnapshot | null>(null)
  snapshotRef.current = snapshot

  // CDP control surface. Installed once; closures read the ref so the API
  // never goes stale across re-renders.
  useEffect(() => {
    const api: G2Api = {
      setSnapshot: (raw) => {
        const next = raw as DashboardSnapshot
        if (next && Array.isArray(next.cards)) {
          snapshotRef.current = next
          setSnapshot(next)
        }
      },
      listTargets: () => {
        const s = useAppStore.getState()
        const targets: G2Target[] = []
        for (const tabs of Object.values(s.tabsByWorktree)) {
          for (const tab of tabs) {
            const layout = s.terminalLayoutsByTabId[tab.id]
            const leafIds: string[] = []
            const walk = (node: unknown): void => {
              if (!(node instanceof Object) || node === null) {
                return
              }
              const n = node as { type?: string; leafId?: string; first?: unknown; second?: unknown }
              if (n.type === 'leaf' && typeof n.leafId === 'string') {
                leafIds.push(n.leafId)
              } else {
                walk(n.first)
                walk(n.second)
              }
            }
            walk(layout?.root ?? null)
            targets.push({
              tabId: tab.id,
              worktreeId: tab.worktreeId,
              leafIds,
              activeLeafId: layout?.activeLeafId ?? null
            })
          }
        }
        return targets
      },
      clearSnapshot: () => {
        snapshotRef.current = null
        setSnapshot(null)
      },
      jump: async (tabId, leafId) => {
        const startedAt = performance.now()
        activateTabAndFocusPane(tabId, leafId, { flashFocusedPane: false })
        // Focus verification: poll rAF until the terminal pane owns focus
        // (or 2 s budget expires — recorded as a miss, never fabricated).
        const deadline = startedAt + 2000
        const focusedAt = await new Promise<number | null>((resolve) => {
          const check = (): void => {
            if (isTerminalPaneFocused()) {
              resolve(performance.now())
            } else if (performance.now() >= deadline) {
              resolve(null)
            } else {
              requestAnimationFrame(check)
            }
          }
          requestAnimationFrame(check)
        })
        const activeTabMatches = useAppStore.getState().activeTabId === tabId
        const paneIndex = activePaneIndex()
        return {
          tabId,
          leafId,
          startedAt,
          focusedAt,
          elapsedMs: focusedAt === null ? null : Math.round(focusedAt - startedAt),
          activeTabMatches,
          activePaneIndex: paneIndex,
          verified: focusedAt !== null && activeTabMatches
        }
      },
      state: () => ({
        width,
        collapsed,
        cards: snapshot?.cards.length ?? 0,
        projects: snapshot ? railEntries(snapshot).length : 0
      })
    }
    window.__g2 = api
    return () => {
      delete window.__g2
    }
  }, [width, collapsed])

  // Drag-to-resize on the panel's left edge.
  const handleResizeStart = useCallback(
    (event: React.PointerEvent) => {
      event.preventDefault()
      const startX = event.clientX
      const startWidth = width
      draggingRef.current = true
      const move = (e: PointerEvent): void => {
        const next = Math.min(
          G2_MAX_WIDTH,
          Math.max(G2_MIN_WIDTH, startWidth + (startX - e.clientX))
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

  const entries = useMemo(() => (snapshot ? railEntries(snapshot) : []), [snapshot])

  if (!g2PrototypeEnabled()) {
    return null
  }

  if (collapsed) {
    return (
      <aside
        data-g2-panel=""
        data-g2-collapsed="true"
        className="flex shrink-0 flex-col border-l border-border bg-background"
        style={{ width: G2_RAIL_WIDTH }}
      >
        <button
          type="button"
          aria-label="Expand overview panel"
          onClick={() => setCollapsed(false)}
          className="flex h-9 items-center justify-center border-b border-border text-muted-foreground hover:text-foreground"
        >
          <ChevronLeftIcon className="size-4" />
        </button>
        <div className="scrollbar-sleek flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto py-1">
          {entries.map((entry) => (
            <div
              key={entry.name}
              data-g2-rail-project={entry.name}
              title={`${entry.name} — ${entry.statuses.join(', ')}`}
              className="relative flex h-8 items-center justify-center"
            >
              <span
                className={`max-w-full truncate rounded bg-muted px-1 text-[10px] tabular-nums ${
                  entry.attention > 0 ? 'font-bold text-amber-600' : 'text-muted-foreground'
                }`}
              >
                {entry.name.slice(0, 2)}
              </span>
              {entry.attention > 0 ? (
                <span
                  data-g2-attention-count={entry.name}
                  className="absolute -right-0.5 top-0.5 rounded-full bg-amber-500 px-1 text-[9px] font-semibold leading-tight text-white"
                >
                  {entry.attention}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      </aside>
    )
  }

  return (
    <aside
      data-g2-panel=""
      data-g2-collapsed="false"
      className="relative flex shrink-0 flex-col border-l border-border bg-background"
      style={{ width }}
    >
      <div
        onPointerDown={handleResizeStart}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize overview panel"
        data-g2-resize-handle=""
        className="absolute top-0 left-0 z-10 flex h-full w-1.5 cursor-col-resize items-center justify-center text-muted-foreground/50 hover:text-muted-foreground"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <GripVerticalIcon className="size-3" />
      </div>
      <button
        type="button"
        aria-label="Collapse overview panel"
        onClick={() => setCollapsed(true)}
        className="absolute top-1 right-1 z-10 rounded p-1 text-muted-foreground opacity-70 hover:opacity-100"
      >
        <ChevronRightIcon className="size-4" />
      </button>
      {snapshot ? (
        <AgentKanbanBoard
          snapshot={snapshot}
          containerClassName="h-full w-full"
          onAckAgent={() => {}}
          onClose={() => setCollapsed(true)}
        />
      ) : (
        <div className="flex flex-1 items-center justify-center p-4 text-[11px] text-muted-foreground">
          G2 prototype armed — inject a snapshot via window.__g2.setSnapshot(...)
        </div>
      )}
    </aside>
  )
}

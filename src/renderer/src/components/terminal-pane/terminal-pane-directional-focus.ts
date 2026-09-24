import type { ManagedPane } from '@/lib/pane-manager/pane-manager'

export type PaneFocusDirection = 'left' | 'right' | 'up' | 'down'

export type PaneRect = {
  left: number
  right: number
  top: number
  bottom: number
}

// Why: split dividers are a few px wide; a candidate whose edge lands inside
// this slack of the active pane's edge still counts as adjacent.
const ADJACENCY_EPSILON_PX = 8

function axisOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart))
}

/**
 * Nearest visible pane in `direction` by split geometry (rendered DOM rects).
 * Candidates must lie strictly past the active pane's edge in the direction and
 * overlap the active pane on the orthogonal axis; the widest overlap wins, with
 * the smallest edge gap as tie-break. Returns null at the outer split edge so
 * callers can apply their own fall-through (e.g. tab switching for left/right).
 */
export function findDirectionalPaneCandidate(
  panes: readonly ManagedPane[],
  activePaneId: number,
  direction: PaneFocusDirection,
  getRect: (pane: ManagedPane) => PaneRect = (pane) => pane.container.getBoundingClientRect()
): ManagedPane | null {
  const active = panes.find((pane) => pane.id === activePaneId)
  if (!active) {
    return null
  }
  const current = getRect(active)
  let best: ManagedPane | null = null
  let bestOverlap = 0
  let bestGap = Number.POSITIVE_INFINITY
  for (const pane of panes) {
    if (pane.id === activePaneId) {
      continue
    }
    const rect = getRect(pane)
    let gap: number
    let overlap: number
    if (direction === 'left') {
      gap = current.left - rect.right
      overlap = axisOverlap(current.top, current.bottom, rect.top, rect.bottom)
    } else if (direction === 'right') {
      gap = rect.left - current.right
      overlap = axisOverlap(current.top, current.bottom, rect.top, rect.bottom)
    } else if (direction === 'up') {
      gap = current.top - rect.bottom
      overlap = axisOverlap(current.left, current.right, rect.left, rect.right)
    } else {
      gap = rect.top - current.bottom
      overlap = axisOverlap(current.left, current.right, rect.left, rect.right)
    }
    if (gap < -ADJACENCY_EPSILON_PX || overlap <= 0) {
      continue
    }
    if (
      overlap > bestOverlap ||
      (overlap === bestOverlap && gap < bestGap)
    ) {
      best = pane
      bestOverlap = overlap
      bestGap = gap
    }
  }
  return best
}

// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import type { ManagedPane } from '@/lib/pane-manager/pane-manager'
import {
  findDirectionalPaneCandidate,
  type PaneRect
} from './terminal-pane-directional-focus'
import { dispatchTerminalShortcutAction } from './terminal-keyboard-action-dispatch'

const switchTabCommand = vi.hoisted(() => vi.fn())
const lockedPtyIds = vi.hoisted(() => new Set<string>())

vi.mock('@/lib/workspace-tab-commands', () => ({
  dispatchWorkspaceTabCommand: switchTabCommand
}))
vi.mock('@/lib/pane-manager/mobile-driver-state', () => ({
  isPtyLocked: (ptyId: string) => lockedPtyIds.has(ptyId)
}))

function paneWithRect(id: number, rect: PaneRect): ManagedPane {
  const container = document.createElement('div')
  container.getBoundingClientRect = () =>
    ({ ...rect, width: rect.right - rect.left, height: rect.bottom - rect.top }) as DOMRect
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: geometry test fixture; only id/container are read.
  return { id, leafId: `leaf-${id}`, container } as unknown as ManagedPane
}

describe('findDirectionalPaneCandidate', () => {
  // Two-column vertical split: pane 1 left half, pane 2 right half.
  const left = paneWithRect(1, { left: 0, right: 100, top: 0, bottom: 100 })
  const right = paneWithRect(2, { left: 104, right: 204, top: 0, bottom: 100 })
  // Right column split horizontally: pane 3 bottom-right.
  const bottomRight = paneWithRect(3, { left: 104, right: 204, top: 104, bottom: 204 })

  it('moves left/right across a vertical split', () => {
    const panes = [left, right]
    expect(findDirectionalPaneCandidate(panes, 2, 'left')?.id).toBe(1)
    expect(findDirectionalPaneCandidate(panes, 1, 'right')?.id).toBe(2)
  })

  it('moves up/down within a column and never across the full split edge', () => {
    const panes = [left, right, bottomRight]
    expect(findDirectionalPaneCandidate(panes, 3, 'up')?.id).toBe(2)
    expect(findDirectionalPaneCandidate(panes, 2, 'down')?.id).toBe(3)
    // Pane 1 spans no horizontal overlap with pane 3's up direction? It does overlap;
    // but from pane 1 there is no pane above.
    expect(findDirectionalPaneCandidate(panes, 1, 'up')).toBeNull()
    expect(findDirectionalPaneCandidate(panes, 1, 'down')).toBeNull()
  })

  it('returns null at the outer split edge so callers can fall through', () => {
    const panes = [left, right, bottomRight]
    expect(findDirectionalPaneCandidate(panes, 1, 'left')).toBeNull()
    expect(findDirectionalPaneCandidate(panes, 2, 'right')).toBeNull()
    expect(findDirectionalPaneCandidate(panes, 3, 'right')).toBeNull()
  })

  it('prefers the candidate with the widest orthogonal overlap', () => {
    // From bottomRight moving left: `left` overlaps fully on Y? `left` spans
    // 0-100 while bottomRight spans 104-204 — zero overlap, so no candidate.
    const panes = [left, right, bottomRight]
    expect(findDirectionalPaneCandidate(panes, 3, 'left')).toBeNull()
    const bottomFull = paneWithRect(4, { left: 0, right: 204, top: 104, bottom: 204 })
    const upperLeft = paneWithRect(5, { left: 0, right: 100, top: 0, bottom: 100 })
    const upperRight = paneWithRect(6, { left: 104, right: 204, top: 0, bottom: 100 })
    // From bottomFull up: both overlap 100px each; tie-break is the smaller gap (equal) → first best kept.
    expect(
      findDirectionalPaneCandidate([bottomFull, upperLeft, upperRight], 4, 'up')?.id
    ).toBe(5)
  })
})

describe('dispatchTerminalShortcutAction focusPaneDirection', () => {
  function createHarness(paneRects: { id: number; rect: PaneRect }[]) {
    const panes = paneRects.map(({ id, rect }) => paneWithRect(id, rect))
    let active = panes[0]
    const setActivePane = vi.fn((paneId: number) => {
      active = panes.find((pane) => pane.id === paneId) ?? active
    })
    const manager = {
      getPanes: () => panes,
      getActivePane: () => active,
      setActivePane
    }
    const transports = new Map(
      panes.map((pane) => [pane.id, { getPtyId: () => `pty-${pane.id}` }])
    )
    const context = {
      tabId: 'tab-1',
      worktreeId: 'worktree-1',
      fallbackCwd: '',
      expandedPaneIdRef: { current: null },
      setExpandedPane: vi.fn(),
      restoreExpandedLayout: vi.fn(),
      refreshPaneSizes: vi.fn(),
      persistLayoutSnapshot: vi.fn(),
      toggleExpandPane: vi.fn(),
      setSearchOpen: vi.fn(),
      focusSearchInput: vi.fn(),
      searchOpenRef: { current: false },
      onRequestClosePane: vi.fn(),
      onClearPaneScrollback: vi.fn(),
      onSetTitle: vi.fn(),
      onClearPaneTitle: vi.fn(),
      paneTransportsRef: { current: transports },
      paneCwdRef: { current: new Map() },
      managerRef: { current: manager },
      getKeyboardSplitTelemetrySource: () => 'keyboard' as const,
      armNativeOnlyShortcut: vi.fn()
    }
    return { manager, context, setActivePane }
  }

  function keyEvent(): KeyboardEvent {
    return new KeyboardEvent('keydown', { cancelable: true })
  }

  it('consumes the chord and focuses the directional neighbor', () => {
    const { manager, context, setActivePane } = createHarness([
      { id: 1, rect: { left: 0, right: 100, top: 0, bottom: 100 } },
      { id: 2, rect: { left: 104, right: 204, top: 0, bottom: 100 } }
    ])
    const event = keyEvent()
    dispatchTerminalShortcutAction(
      { type: 'focusPaneDirection', direction: 'right', tabFallback: true },
      event,
      manager as never,
      context as never
    )
    expect(event.defaultPrevented).toBe(true)
    expect(setActivePane).toHaveBeenCalledWith(2, { focus: true })
    expect(switchTabCommand).not.toHaveBeenCalled()
  })

  it('falls through to the adjacent terminal tab at the outer edge (left/right only)', () => {
    const { manager, context } = createHarness([
      { id: 1, rect: { left: 0, right: 100, top: 0, bottom: 100 } },
      { id: 2, rect: { left: 104, right: 204, top: 0, bottom: 100 } }
    ])
    switchTabCommand.mockClear()
    const event = keyEvent()
    dispatchTerminalShortcutAction(
      { type: 'focusPaneDirection', direction: 'left', tabFallback: true },
      event,
      manager as never,
      context as never
    )
    expect(event.defaultPrevented).toBe(true)
    expect(switchTabCommand).toHaveBeenCalledWith({
      type: 'switch',
      direction: -1,
      scope: 'terminal'
    })
  })

  it('never switches tabs for up/down, but still consumes the chord', () => {
    const { manager, context } = createHarness([
      { id: 1, rect: { left: 0, right: 100, top: 0, bottom: 100 } }
    ])
    switchTabCommand.mockClear()
    const event = keyEvent()
    dispatchTerminalShortcutAction(
      { type: 'focusPaneDirection', direction: 'up', tabFallback: false },
      event,
      manager as never,
      context as never
    )
    expect(event.defaultPrevented).toBe(true)
    expect(switchTabCommand).not.toHaveBeenCalled()
  })

  it('hands the chord to a locked/pass-through PTY without consuming', () => {
    const { manager, context } = createHarness([
      { id: 1, rect: { left: 0, right: 100, top: 0, bottom: 100 } },
      { id: 2, rect: { left: 104, right: 204, top: 0, bottom: 100 } }
    ])
    lockedPtyIds.add('pty-1')
    switchTabCommand.mockClear()
    const event = keyEvent()
    dispatchTerminalShortcutAction(
      { type: 'focusPaneDirection', direction: 'right', tabFallback: true },
      event,
      manager as never,
      context as never
    )
    expect(event.defaultPrevented).toBe(false)
    expect(switchTabCommand).not.toHaveBeenCalled()
    lockedPtyIds.clear()
  })
})

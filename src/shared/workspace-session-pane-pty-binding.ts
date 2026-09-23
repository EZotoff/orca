import { makePaneKey } from './stable-pane-id'
import type {
  TerminalLayoutSnapshot,
  TerminalPaneLayoutNode,
  TerminalTab
} from './terminal-tab-types'
import type { WorkspaceSessionState } from './workspace-session-state-types'

export type PersistedPanePtyBinding = {
  ptyId: string
  /** `tab`: only the tab row names the PTY, which binds to the tab's sole pane at mount. */
  source: 'leaf' | 'tab'
}

function collectLayoutLeafIds(node: TerminalPaneLayoutNode | null | undefined): string[] {
  if (!node) {
    return []
  }
  return node.type === 'leaf'
    ? [node.leafId]
    : [...collectLayoutLeafIds(node.first), ...collectLayoutLeafIds(node.second)]
}

function tabLevelPtyId(session: WorkspaceSessionState, tab: TerminalTab): string | null {
  return tab.ptyId || session.remoteSessionIdsByTabId?.[tab.id] || null
}

function rowClaimsPty(session: WorkspaceSessionState, row: TerminalTab, ptyId: string): boolean {
  if (tabLevelPtyId(session, row) === ptyId) {
    return true
  }
  const layout = session.terminalLayoutsByTabId?.[row.id]
  const mountedLeafIds = layout?.root ? new Set(collectLayoutLeafIds(layout.root)) : null
  return Object.entries(layout?.ptyIdsByLeafId ?? {}).some(
    ([leafId, boundPtyId]) =>
      boundPtyId === ptyId && (!mountedLeafIds || mountedLeafIds.has(leafId))
  )
}

// Why: hydration strips a PTY a canonical row owns off its retained legacy duplicate (#10486), so
// that duplicate must never name it as its own.
function isReleasedToCanonicalRow(
  session: WorkspaceSessionState,
  worktreeId: string,
  tab: TerminalTab,
  ptyId: string
): boolean {
  const canonicalTabIds = new Set(
    (session.unifiedTabs?.[worktreeId] ?? [])
      .filter((candidate) => candidate.contentType === 'terminal')
      .map((candidate) => candidate.entityId)
  )
  if (canonicalTabIds.has(tab.id)) {
    return false
  }
  return (session.tabsByWorktree?.[worktreeId] ?? []).some(
    (other) =>
      other.id !== tab.id && canonicalTabIds.has(other.id) && rowClaimsPty(session, other, ptyId)
  )
}

function resolveTabLevelBinding(
  session: WorkspaceSessionState,
  tab: TerminalTab,
  layout: TerminalLayoutSnapshot | undefined,
  leafId: string
): PersistedPanePtyBinding | null {
  const ptyId = tabLevelPtyId(session, tab)
  if (!ptyId || session.terminalSurfaceTombstonesByPaneKey?.[makePaneKey(tab.id, leafId)]) {
    return null
  }
  // Why: sleep keeps tab.ptyId as a wake hint for a killed PTY; its pane resumes, never reattaches.
  const slept = Object.values(session.sleepingAgentSessionsByPaneKey ?? {}).some(
    (record) => record.tabId === tab.id
  )
  if (slept) {
    return null
  }
  const leafIds = collectLayoutLeafIds(layout?.root)
  const isSolePane = !layout || (leafIds.length === 1 && leafIds[0] === leafId)
  const hasLeafBinding = Object.values(layout?.ptyIdsByLeafId ?? {}).some(Boolean)
  return isSolePane && !hasLeafBinding ? { ptyId, source: 'tab' } : null
}

/**
 * The PTY a persisted pane still owns: its leaf binding, or its tab row's id when that row names a
 * PTY for the tab's sole pane. Covers the rows the renderer's reconnect plan republishes.
 */
export function resolvePersistedPanePtyBinding(
  session: WorkspaceSessionState,
  worktreeId: string,
  tabId: string,
  leafId: string
): PersistedPanePtyBinding | null {
  const tab = session.tabsByWorktree?.[worktreeId]?.find(
    (candidate) => candidate.id === tabId && candidate.worktreeId === worktreeId
  )
  if (!tab) {
    return null
  }
  const layout = session.terminalLayoutsByTabId?.[tabId]
  const leafPtyId = layout?.ptyIdsByLeafId?.[leafId]
  const binding: PersistedPanePtyBinding | null =
    typeof leafPtyId === 'string' && leafPtyId.length > 0
      ? { ptyId: leafPtyId, source: 'leaf' }
      : resolveTabLevelBinding(session, tab, layout, leafId)
  if (!binding || isReleasedToCanonicalRow(session, worktreeId, tab, binding.ptyId)) {
    return null
  }
  return binding
}

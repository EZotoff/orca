import { describe, expect, it } from 'vitest'
import { getDefaultWorkspaceSession } from './constants'
import type { Tab } from './tab-types'
import type { TerminalLayoutSnapshot, TerminalTab } from './terminal-tab-types'
import type { WorkspaceSessionState } from './workspace-session-state-types'
import { resolvePersistedPanePtyBinding } from './workspace-session-pane-pty-binding'

const WT = 'repo-1::/tmp/pane-binding'
const LEAF_A = '1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a'
const LEAF_B = '2b2b2b2b-2b2b-4b2b-8b2b-2b2b2b2b2b2b'

function tab(id: string, ptyId: string | null): TerminalTab {
  return {
    id,
    ptyId,
    worktreeId: WT,
    title: 'Terminal',
    customTitle: null,
    color: null,
    sortOrder: 0,
    createdAt: 0
  }
}

function soleLeaf(leafId: string, ptyIdsByLeafId?: Record<string, string>): TerminalLayoutSnapshot {
  return {
    root: { type: 'leaf', leafId },
    activeLeafId: leafId,
    expandedLeafId: null,
    ...(ptyIdsByLeafId ? { ptyIdsByLeafId } : {})
  }
}

function split(ptyIdsByLeafId: Record<string, string>): TerminalLayoutSnapshot {
  return {
    root: {
      type: 'split',
      direction: 'vertical',
      first: { type: 'leaf', leafId: LEAF_A },
      second: { type: 'leaf', leafId: LEAF_B }
    },
    activeLeafId: LEAF_A,
    expandedLeafId: null,
    ptyIdsByLeafId
  }
}

function canonical(entityId: string): Tab {
  return {
    id: entityId,
    entityId,
    groupId: 'group-1',
    worktreeId: WT,
    contentType: 'terminal',
    label: 'Terminal',
    customLabel: null,
    color: null,
    sortOrder: 0,
    createdAt: 0
  }
}

function session(patch: Partial<WorkspaceSessionState>): WorkspaceSessionState {
  return { ...getDefaultWorkspaceSession(), ...patch }
}

describe('resolvePersistedPanePtyBinding', () => {
  it('prefers the leaf binding', () => {
    const state = session({
      tabsByWorktree: { [WT]: [tab('t1', 'pty-tab')] },
      terminalLayoutsByTabId: { t1: soleLeaf(LEAF_A, { [LEAF_A]: 'pty-leaf' }) }
    })

    expect(resolvePersistedPanePtyBinding(state, WT, 't1', LEAF_A)).toEqual({
      ptyId: 'pty-leaf',
      source: 'leaf'
    })
  })

  it('names a tab-level-only row for the sole pane of a layoutless tab', () => {
    const state = session({ tabsByWorktree: { [WT]: [tab('t1', 'pty-tab')] } })

    expect(resolvePersistedPanePtyBinding(state, WT, 't1', LEAF_A)).toEqual({
      ptyId: 'pty-tab',
      source: 'tab'
    })
  })

  it('names a tab-level-only row for the sole leaf of an unbound layout', () => {
    const state = session({
      tabsByWorktree: { [WT]: [tab('t1', 'pty-tab')] },
      terminalLayoutsByTabId: { t1: soleLeaf(LEAF_A) }
    })

    expect(resolvePersistedPanePtyBinding(state, WT, 't1', LEAF_A)?.ptyId).toBe('pty-tab')
    expect(resolvePersistedPanePtyBinding(state, WT, 't1', LEAF_B)).toBeNull()
  })

  it('names a relay-backed tab from remoteSessionIdsByTabId', () => {
    const state = session({
      tabsByWorktree: { [WT]: [tab('t1', null)] },
      remoteSessionIdsByTabId: { t1: 'ssh:conn@@pty-7' }
    })

    expect(resolvePersistedPanePtyBinding(state, WT, 't1', LEAF_A)).toEqual({
      ptyId: 'ssh:conn@@pty-7',
      source: 'tab'
    })
  })

  it('does not hand a tab-level id to one pane of a split', () => {
    const state = session({
      tabsByWorktree: { [WT]: [tab('t1', 'pty-tab')] },
      terminalLayoutsByTabId: { t1: split({ [LEAF_B]: 'pty-b' }) }
    })

    expect(resolvePersistedPanePtyBinding(state, WT, 't1', LEAF_A)).toBeNull()
    expect(resolvePersistedPanePtyBinding(state, WT, 't1', LEAF_B)?.ptyId).toBe('pty-b')
  })

  it('does not reattach a slept tab through its wake hint', () => {
    const state = session({
      tabsByWorktree: { [WT]: [tab('t1', 'pty-slept')] },
      sleepingAgentSessionsByPaneKey: {
        [`t1:${LEAF_A}`]: {
          paneKey: `t1:${LEAF_A}`,
          tabId: 't1',
          worktreeId: WT,
          agent: 'claude',
          providerSession: { key: 'session_id', id: 'provider-session' },
          prompt: '',
          state: 'done',
          capturedAt: 1,
          updatedAt: 1
        }
      }
    })

    expect(resolvePersistedPanePtyBinding(state, WT, 't1', LEAF_A)).toBeNull()
  })

  it('releases a retained split row PTY that its canonical row owns', () => {
    const state = session({
      tabsByWorktree: { [WT]: [tab('canonical', 'pty-shared'), tab('retained', null)] },
      terminalLayoutsByTabId: {
        canonical: soleLeaf(LEAF_A, { [LEAF_A]: 'pty-shared' }),
        retained: split({ [LEAF_A]: 'pty-shared', [LEAF_B]: 'pty-own' })
      },
      unifiedTabs: { [WT]: [canonical('canonical')] }
    })

    expect(resolvePersistedPanePtyBinding(state, WT, 'retained', LEAF_A)).toBeNull()
    expect(resolvePersistedPanePtyBinding(state, WT, 'retained', LEAF_B)?.ptyId).toBe('pty-own')
    expect(resolvePersistedPanePtyBinding(state, WT, 'canonical', LEAF_A)?.ptyId).toBe('pty-shared')
  })

  it('never resolves a tab from another workspace', () => {
    const state = session({ tabsByWorktree: { [WT]: [tab('t1', 'pty-tab')] } })

    expect(resolvePersistedPanePtyBinding(state, 'repo-1::/tmp/other', 't1', LEAF_A)).toBeNull()
  })
})

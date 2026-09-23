import { describe, expect, it } from 'vitest'
import { getDefaultWorkspaceSession } from '../../../shared/constants'
import type { WorkspaceSessionState } from '../../../shared/workspace-session-state-types'
import { ptyBindingIsRefused } from './pty-binding-refusals'

const WT = 'repo-1::/tmp/binding-fence'
const TAB = 'tab-1'
const LEAF = '5e5e5e5e-5e5e-4e5e-8e5e-5e5e5e5e5e5e'
const PANE_KEY = `${TAB}:${LEAF}`

function tabLevelOnlySession(): WorkspaceSessionState {
  return {
    ...getDefaultWorkspaceSession(),
    tabsByWorktree: {
      [WT]: [
        {
          id: TAB,
          ptyId: 'pty-tab',
          worktreeId: WT,
          title: 'Terminal',
          customTitle: null,
          color: null,
          sortOrder: 0,
          createdAt: 0
        }
      ]
    }
  }
}

describe('the stable-owner binding fence', () => {
  // Why: the host resolves this pane's owner from the tab row, so its commit fence must agree.
  it('admits a commit fenced on a tab-level-only binding', () => {
    expect(
      ptyBindingIsRefused(
        { tabId: TAB, leafId: LEAF, expectedBinding: { ptyId: 'pty-tab' } },
        tabLevelOnlySession(),
        WT,
        PANE_KEY
      )
    ).toBe(false)
  })

  it('refuses a commit fenced on a PTY the pane no longer names', () => {
    expect(
      ptyBindingIsRefused(
        { tabId: TAB, leafId: LEAF, expectedBinding: { ptyId: 'pty-other' } },
        tabLevelOnlySession(),
        WT,
        PANE_KEY
      )
    ).toBe(true)
  })
})

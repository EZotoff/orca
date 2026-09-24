import { beforeEach, describe, expect, it, vi } from 'vitest'
import { keybindingMatchesAction } from '../../../shared/keybindings'
import type { AppShortcutState, ShortcutDispatchInput } from './app-command-handlers'

const mocks = vi.hoisted(() => {
  // Partial store double — the overviewPanel.toggle handler reads only these two fields.
  const store = {
    overviewPanelCollapsed: false,
    setOverviewPanelCollapsed: vi.fn()
  }
  return { store, setCollapsed: store.setOverviewPanelCollapsed }
})

vi.mock('../store', () => ({
  useAppStore: Object.assign(vi.fn(), { getState: () => mocks.store })
}))

vi.mock('@/lib/floating-workspace-terminal-actions', () => ({
  isFloatingWorkspacePanelFocused: () => false
}))

vi.mock('@/lib/terminal-shortcut-capture-notification', () => ({
  showTerminalShortcutCaptureNotification: vi.fn()
}))

import { createAppCommandHandlers } from './app-command-handlers'

function shortcutState(): AppShortcutState {
  return {
    activeView: 'terminal',
    activeWorktreeId: null,
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the overviewPanel.toggle handler never touches actions.
    actions: {} as AppShortcutState['actions'],
    creationLayoutActive: false,
    floatingTerminalEnabled: false,
    floatingTerminalOpen: false,
    floatingVisibleTabCount: 0,
    keybindings: {},
    openFloatingWorkspaceMaximized: vi.fn(),
    pluginCommands: [],
    setFloatingTerminalOpen: vi.fn(),
    terminalShortcutPolicy: 'orca-first',
    workspaceChromeActive: true
  }
}

function shortcutInput(): ShortcutDispatchInput {
  return { target: null, defaultPrevented: false, preventDefault: vi.fn() }
}

function storeWithCollapsed(collapsed: boolean): typeof mocks.store {
  return { overviewPanelCollapsed: collapsed, setOverviewPanelCollapsed: mocks.setCollapsed }
}

function runToggle(state: AppShortcutState = shortcutState()): boolean | undefined {
  return createAppCommandHandlers(state, shortcutInput(), 'terminal').get('overviewPanel.toggle')?.()
}

describe('overviewPanel.toggle shortcut', () => {
  beforeEach(() => vi.clearAllMocks())

  it('collapses the expanded panel and expands the collapsed one', () => {
    mocks.store = storeWithCollapsed(false)
    expect(runToggle()).toBe(true)
    expect(mocks.setCollapsed).toHaveBeenCalledWith(true)

    mocks.store = storeWithCollapsed(true)
    expect(runToggle()).toBe(true)
    expect(mocks.setCollapsed).toHaveBeenCalledWith(false)
  })

  it('binds Alt+O by default on Linux and leaves macOS unbound', () => {
    expect(
      keybindingMatchesAction('overviewPanel.toggle', { key: 'o', altKey: true }, 'linux')
    ).toBe(true)
    expect(
      keybindingMatchesAction('overviewPanel.toggle', { key: 'o', altKey: true }, 'darwin')
    ).toBe(false)
  })

  it('stays active while a terminal is focused under the orca-first policy', () => {
    expect(
      keybindingMatchesAction(
        'overviewPanel.toggle',
        { key: 'o', altKey: true },
        'linux',
        undefined,
        { context: 'terminal', terminalShortcutPolicy: 'orca-first' }
      )
    ).toBe(true)
  })
})

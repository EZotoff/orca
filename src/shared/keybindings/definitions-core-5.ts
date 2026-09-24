import type { KeybindingDefinition } from './types'

export const KEYBINDING_DEFINITION_CORE_5: readonly KeybindingDefinition[] = [
  {
    id: 'terminal.focusPaneOrTabLeft',
    title: 'Focus pane left (or previous tab at edge)',
    group: 'Terminal Panes',
    scope: 'terminal',
    // Why: zellij MoveFocusOrTab parity — pane focus by split geometry, falling
    // through to the adjacent terminal tab only at the outer split edge.
    // Linux/Windows only: on macOS Option+letter is text composition
    // (macOptionAsAlt) and Option+Arrow is readline word-nav, so darwin stays unbound.
    searchKeywords: ['shortcut', 'pane', 'focus', 'left', 'tab', 'previous', 'move'],
    defaultBindings: {
      darwin: [],
      linux: ['Alt+ArrowLeft', 'Alt+H'],
      win32: ['Alt+ArrowLeft', 'Alt+H']
    }
  },
  {
    id: 'terminal.focusPaneOrTabRight',
    title: 'Focus pane right (or next tab at edge)',
    group: 'Terminal Panes',
    scope: 'terminal',
    searchKeywords: ['shortcut', 'pane', 'focus', 'right', 'tab', 'next', 'move'],
    defaultBindings: {
      darwin: [],
      linux: ['Alt+ArrowRight', 'Alt+L'],
      win32: ['Alt+ArrowRight', 'Alt+L']
    }
  },
  {
    id: 'terminal.focusPaneUp',
    title: 'Focus pane up',
    group: 'Terminal Panes',
    scope: 'terminal',
    // Why: up/down never switch tabs (zellij MoveFocus semantics).
    searchKeywords: ['shortcut', 'pane', 'focus', 'up', 'move'],
    defaultBindings: {
      darwin: [],
      linux: ['Alt+ArrowUp', 'Alt+K'],
      win32: ['Alt+ArrowUp', 'Alt+K']
    }
  },
  {
    id: 'terminal.focusPaneDown',
    title: 'Focus pane down',
    group: 'Terminal Panes',
    scope: 'terminal',
    searchKeywords: ['shortcut', 'pane', 'focus', 'down', 'move'],
    defaultBindings: {
      darwin: [],
      linux: ['Alt+ArrowDown', 'Alt+J'],
      win32: ['Alt+ArrowDown', 'Alt+J']
    }
  }
]

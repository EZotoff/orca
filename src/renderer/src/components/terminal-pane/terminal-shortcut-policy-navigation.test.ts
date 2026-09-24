import { describe, expect, it } from 'vitest'
import {
  resolveTerminalShortcutAction,
  type TerminalShortcutEvent
} from './terminal-shortcut-policy'

function event(overrides: Partial<TerminalShortcutEvent>): TerminalShortcutEvent {
  return {
    key: '',
    code: '',
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
    ...overrides
  }
}

describe('resolveTerminalShortcutAction — directional pane navigation (zellij parity)', () => {
  it('binds alt+arrow to directional pane navigation by default', () => {
    // G1 leak fix: Alt+arrows are owned by Orca navigation on Linux/Windows and
    // must never reach the PTY as \eb/\ef word-nav escapes.
    expect(
      resolveTerminalShortcutAction(
        event({ key: 'ArrowLeft', code: 'ArrowLeft', altKey: true }),
        false
      )
    ).toEqual({ type: 'focusPaneDirection', direction: 'left', tabFallback: true })
    expect(
      resolveTerminalShortcutAction(
        event({ key: 'ArrowRight', code: 'ArrowRight', altKey: true }),
        false
      )
    ).toEqual({ type: 'focusPaneDirection', direction: 'right', tabFallback: true })
    expect(
      resolveTerminalShortcutAction(
        event({ key: 'ArrowUp', code: 'ArrowUp', altKey: true }),
        false
      )
    ).toEqual({ type: 'focusPaneDirection', direction: 'up', tabFallback: false })
    expect(
      resolveTerminalShortcutAction(
        event({ key: 'ArrowDown', code: 'ArrowDown', altKey: true }),
        false
      )
    ).toEqual({ type: 'focusPaneDirection', direction: 'down', tabFallback: false })

    // Alt+hjkl aliases (vim-style) resolve to the same directional navigation.
    expect(
      resolveTerminalShortcutAction(event({ key: 'h', code: 'KeyH', altKey: true }), false)
    ).toEqual({ type: 'focusPaneDirection', direction: 'left', tabFallback: true })
    expect(
      resolveTerminalShortcutAction(event({ key: 'l', code: 'KeyL', altKey: true }), false)
    ).toEqual({ type: 'focusPaneDirection', direction: 'right', tabFallback: true })
    expect(
      resolveTerminalShortcutAction(event({ key: 'k', code: 'KeyK', altKey: true }), false)
    ).toEqual({ type: 'focusPaneDirection', direction: 'up', tabFallback: false })
    expect(
      resolveTerminalShortcutAction(event({ key: 'j', code: 'KeyJ', altKey: true }), false)
    ).toEqual({ type: 'focusPaneDirection', direction: 'down', tabFallback: false })

    // IME composition owns the key: no navigation while a composition is pending.
    expect(
      resolveTerminalShortcutAction(
        event({ key: 'ArrowLeft', code: 'ArrowLeft', altKey: true, isComposing: true }),
        false
      )
    ).toEqual({ type: 'sendInput', data: '\x1bb' })

    // macOS defaults stay unbound: Option+Arrow keeps its readline word-nav translation.
    expect(
      resolveTerminalShortcutAction(
        event({ key: 'ArrowLeft', code: 'ArrowLeft', altKey: true }),
        true
      )
    ).toEqual({ type: 'sendInput', data: '\x1bb' })
  })

  it('translates alt+arrow to readline word-nav escapes when navigation is unbound', () => {
    // User override that unbinds the navigation actions restores the legacy
    // readline translation on both platforms.
    const unbound = {
      'terminal.focusPaneOrTabLeft': [] as string[],
      'terminal.focusPaneOrTabRight': [] as string[]
    }
    expect(
      resolveTerminalShortcutAction(
        event({ key: 'ArrowLeft', code: 'ArrowLeft', altKey: true }),
        true,
        'false',
        0,
        false,
        unbound
      )
    ).toEqual({ type: 'sendInput', data: '\x1bb' })
    expect(
      resolveTerminalShortcutAction(
        event({ key: 'ArrowRight', code: 'ArrowRight', altKey: true }),
        false,
        'false',
        0,
        false,
        unbound
      )
    ).toEqual({ type: 'sendInput', data: '\x1bf' })

    // alt+shift+arrow is a different chord (select-word in some shells) — don't
    // intercept, let xterm.js / the shell handle it.
    expect(
      resolveTerminalShortcutAction(
        event({ key: 'ArrowLeft', code: 'ArrowLeft', altKey: true, shiftKey: true }),
        true
      )
    ).toBeNull()

    // alt+ctrl+arrow is a different chord entirely — passthrough.
    expect(
      resolveTerminalShortcutAction(
        event({ key: 'ArrowLeft', code: 'ArrowLeft', altKey: true, ctrlKey: true }),
        true
      )
    ).toBeNull()

    // Ctrl+Alt+Arrow (Linux workspace switching on some desktops) must pass through on non-Mac.
    expect(
      resolveTerminalShortcutAction(
        event({ key: 'ArrowLeft', code: 'ArrowLeft', ctrlKey: true, altKey: true }),
        false
      )
    ).toBeNull()

    // Regression guard: plain ArrowLeft must still pass through untouched.
    expect(
      resolveTerminalShortcutAction(event({ key: 'ArrowLeft', code: 'ArrowLeft' }), true)
    ).toBeNull()
  })
})

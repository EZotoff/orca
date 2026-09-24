// Navigation-latency probe (orca-transition Task 25, design §8).
//
// Primary metric: click-to-focus latency — click a pane other than the active
// one and measure wall-clock time until the active pane index changes. This is
// a real navigation action and is reliably drivable from CDP.
//
// Secondary metric: the app's focus-next-pane chord (Ctrl+], action
// terminal.focusNextPane). Synthetic CDP/xdotool key events are consumed by
// the terminal-scoped shortcut layer without moving focus in this build, so
// the chord result is recorded honestly (verified true/false) and the
// operator's real keyboard is the authority for keyboard-nav latency.
//
// Emits one JSON row on stdout. Skips (labeled) when fewer than two panes are
// open, so the harness can run before the operator's full session shape.
import { connect, sleep, ACTIVE_PANE_EXPR, PANE_COUNT_EXPR, press } from './orca-cdp.mjs'

const port = process.env.CDP_PORT ?? '18260'
const ts = new Date().toISOString()
let out
try {
  const { send, evaluate, close } = await connect(port)
  const paneCount = await evaluate(PANE_COUNT_EXPR)
  if (paneCount < 2) {
    out = { ts, skipped: 'insufficient-panes', paneCount }
  } else {
    const before = await evaluate(ACTIVE_PANE_EXPR)
    const target = (before + 1) % paneCount
    const rect = await evaluate(
      `(()=>{const p=document.querySelectorAll(".pane")[${target}];if(!p)return null;const r=p.getBoundingClientRect();return [Math.round(r.x+r.width/2),Math.round(r.y+r.height/2)]})()`
    )
    const t0 = Date.now()
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect[0], y: rect[1], button: 'left', clickCount: 1 })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect[0], y: rect[1], button: 'left', clickCount: 1 })
    let after = before
    for (let i = 0; i < 200; i++) {
      await sleep(5)
      after = await evaluate(ACTIVE_PANE_EXPR)
      if (after !== before) break
    }
    const clickMs = Date.now() - t0

    // secondary: keyboard chord
    const kbBefore = await evaluate(ACTIVE_PANE_EXPR)
    const t1 = Date.now()
    await press(send, { key: ']', code: 'BracketRight', vk: 221, modifiers: 2 })
    let kbAfter = kbBefore
    for (let i = 0; i < 100; i++) {
      await sleep(5)
      kbAfter = await evaluate(ACTIVE_PANE_EXPR)
      if (kbAfter !== kbBefore) break
    }
    const kbMs = Date.now() - t1

    out = {
      ts,
      paneCount,
      clickFocus: { before, target, after, elapsedMs: clickMs, verified: after !== before },
      keyboardFocus: { chord: 'Ctrl+]', before: kbBefore, after: kbAfter, elapsedMs: kbMs, verified: kbAfter !== kbBefore },
    }
  }
  close()
} catch (err) {
  out = { ts, error: String(err && err.message ? err.message : err) }
}
console.log(JSON.stringify(out))

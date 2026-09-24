// Lost/duplicated-event probe (orca-transition Task 25, design §8).
// Types `printf 'SOAK-EVT-%s\n' <n>` into the focused pane and counts the
// resolved marker in the rendered terminal buffer. The command line carries
// the literal `%s`, so the resolved marker can only come from the shell's
// output: exactly one occurrence means the input event reached the PTY once
// and its output was rendered once. Zero = lost; >1 = duplicated.
import { connect, sleep, ACTIVE_PANE_EXPR, PANE_COUNT_EXPR, typeText, pressEnter } from './orca-cdp.mjs'

const port = process.env.CDP_PORT ?? '18260'
const ts = new Date().toISOString()
let out
try {
  const { send, evaluate, close } = await connect(port)
  const paneCount = await evaluate(PANE_COUNT_EXPR)
  if (paneCount < 1) {
    out = { ts, skipped: 'no-panes', paneCount }
  } else {
    const n = Date.now()
    const marker = `SOAK-EVT-${n}`
    await typeText(send, `printf 'SOAK-EVT-%s\\n' ${n}`)
    await pressEnter(send)
    await sleep(800)
    const text = await evaluate(
      `(()=>{const ps=[...document.querySelectorAll(".pane")];const i=ps.findIndex(p=>p.contains(document.activeElement));const rows=ps[i]?ps[i].querySelector(".xterm-rows"):null;return rows?rows.innerText:""})()`
    )
    const count = (text.match(new RegExp(marker, 'g')) || []).length
    out = {
      ts,
      marker,
      count,
      lost: count === 0,
      duplicated: count > 1,
      ok: count === 1,
      paneCount,
    }
  }
  close()
} catch (err) {
  out = { ts, error: String(err && err.message ? err.message : err) }
}
console.log(JSON.stringify(out))

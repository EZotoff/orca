// Pane/session snapshot for restart verification (orca-transition Task 25).
// Emits a JSON snapshot of the live workspace: pane count, per-pane visible
// buffer tail (carries the shell prompt + cwd), active pane, and the sidebar
// project list. The harness diffs before/after a restart to verify every
// hosted session/worktree/tab mapping survived.
import { connect, ACTIVE_PANE_EXPR, PANE_COUNT_EXPR } from './orca-cdp.mjs'

const port = process.env.CDP_PORT ?? '18260'
const ts = new Date().toISOString()
let out
try {
  const { evaluate, close } = await connect(port)
  const paneCount = await evaluate(PANE_COUNT_EXPR)
  const panes = await evaluate(
    `(()=>{const ps=[...document.querySelectorAll(".pane")];return ps.map((p,i)=>{const rows=p.querySelector(".xterm-rows");const t=rows?rows.innerText:"";const lines=t.split("\\n").filter(Boolean);return {i, tail: lines.slice(-2).join(" | ").slice(0,200)}})})()`
  )
  const projects = await evaluate(
    `(()=>{const els=[...document.querySelectorAll("[class*=worktree],[class*=project]")];const names=new Set();for(const e of els){const t=(e.innerText||"").trim();if(t&&t.length<60)names.add(t.split("\\n")[0])}return [...names].slice(0,40)})()`
  )
  const active = await evaluate(ACTIVE_PANE_EXPR)
  out = { ts, paneCount, active, panes, projects }
  close()
} catch (err) {
  out = { ts, error: String(err && err.message ? err.message : err) }
}
console.log(JSON.stringify(out))

// Scrollback sentinel record/verify (orca-transition Task 25, design §8).
// record: writes START/MIDDLE/END sentinels into every open pane and stores
//         the sentinel strings + a visible-buffer snapshot.
// verify: after a restart, checks the persisted terminal history (byte-exact
//         PTY stream) still contains every sentinel, and captures the visible
//         buffer + a screenshot as the visible equivalent.
// Usage: node sentinels.mjs record <record.json> [runId]
//        node sentinels.mjs verify <record.json> <outdir>
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { connect, sleep, PANE_COUNT_EXPR, typeText, pressEnter } from './orca-cdp.mjs'

const port = process.env.CDP_PORT ?? '18260'
const HISTORY_DIR =
  process.env.ORCA_TERMINAL_HISTORY ??
  '/home/ezotoff/src/orca/builds/rc-2026-09-24-802aadd7/scratch-userdata/terminal-history'

const mode = process.argv[2]
const recordPath = process.argv[3]

function allOutputLogs(dir) {
  const out = []
  const walk = (d) => {
    let entries
    try {
      entries = readdirSync(d)
    } catch {
      return
    }
    for (const e of entries) {
      const p = join(d, e)
      let st
      try {
        st = statSync(p)
      } catch {
        continue
      }
      if (st.isDirectory()) walk(p)
      else if (e === 'output.log') out.push(p)
    }
  }
  walk(dir)
  return out
}

function visibleBuffer(evaluate) {
  return evaluate(
    `(()=>{const ps=[...document.querySelectorAll(".pane")];return ps.map((p,i)=>{const rows=p.querySelector(".xterm-rows");return {i, text: rows?rows.innerText.slice(-2000):""}})})()`
  )
}

async function record() {
  const runId = process.argv[4] ?? String(Date.now())
  const { send, evaluate, close } = await connect(port)
  const paneCount = await evaluate(PANE_COUNT_EXPR)
  const sentinels = []
  for (let i = 0; i < paneCount; i++) {
    // focus pane i by clicking its centre
    const rect = await evaluate(
      `(()=>{const p=document.querySelectorAll(".pane")[${i}];if(!p)return null;const r=p.getBoundingClientRect();return [Math.round(r.x+r.width/2),Math.round(r.y+r.height/2)]})()`
    )
    if (rect) {
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect[0], y: rect[1], button: 'left', clickCount: 1 })
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect[0], y: rect[1], button: 'left', clickCount: 1 })
      await sleep(200)
    }
    for (const phase of ['START', 'MIDDLE', 'END']) {
      const s = `SOAK-SENTINEL-${runId}-P${i}-${phase}`
      await typeText(send, `echo ${s}`)
      await pressEnter(send)
      await sleep(150)
      sentinels.push(s)
    }
  }
  await sleep(1500)
  const record = {
    ts: new Date().toISOString(),
    runId,
    paneCount,
    sentinels,
    historyDir: HISTORY_DIR,
    visible: await visibleBuffer(evaluate),
  }
  writeFileSync(recordPath, JSON.stringify(record, null, 2) + '\n')
  close()
  console.log(JSON.stringify({ ts: record.ts, mode: 'record', paneCount, sentinels: sentinels.length }))
}

async function verify() {
  const outdir = process.argv[4] ?? '.'
  const record = JSON.parse(readFileSync(recordPath, 'utf8'))
  const logs = allOutputLogs(record.historyDir)
  // The persisted PTY stream is flushed asynchronously; poll briefly so a
  // verify immediately after record does not race the flush.
  let blob = ''
  let missing = record.sentinels.slice()
  for (let attempt = 0; attempt < 20; attempt++) {
    blob = logs.map((p) => readFileSync(p, 'latin1')).join('\n')
    missing = record.sentinels.filter((s) => !blob.includes(s))
    if (missing.length === 0) break
    await new Promise((r) => setTimeout(r, 500))
  }
  const results = record.sentinels.map((s) => ({ sentinel: s, present: blob.includes(s) }))
  const { evaluate, close } = await connect(port)
  const visible = await visibleBuffer(evaluate)
  close()
  const out = {
    ts: new Date().toISOString(),
    mode: 'verify',
    runId: record.runId,
    recordedAt: record.ts,
    historyLogs: logs.length,
    sentinels: results.length,
    present: results.length - missing.length,
    missing,
    byteExactPreserved: missing.length === 0,
    visible,
  }
  writeFileSync(join(outdir, `sentinels-verify-${record.runId}.json`), JSON.stringify(out, null, 2) + '\n')
  console.log(JSON.stringify({ ts: out.ts, mode: 'verify', sentinels: out.sentinels, present: out.present, missing: out.missing }))
}

if (mode === 'record') await record()
else if (mode === 'verify') await verify()
else {
  console.error('usage: sentinels.mjs record <record.json> [runId] | verify <record.json> <outdir>')
  process.exit(2)
}

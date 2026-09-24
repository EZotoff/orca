#!/usr/bin/env bash
# G4 composer -> OpenCode PTY live probe (attempt 3, breakpoint watcher).
set -uo pipefail
cd "$(dirname "$0")"

PORT=18244
APP="$PWD/throwaway-g4/app/orca-ide"
UD="$PWD/throwaway-g4/scratch-userdata"
OUT="$PWD/g4-results.txt"
PTYLOG="$PWD/g4-ptywatch.log"
NODE_PROBE="/tmp/opencode/g4-probe-node.mjs"
: > "$OUT"; : > "$PTYLOG"

log() { echo "$@" | tee -a "$OUT"; }

pkill -f "throwaway-g4/app/orca-ide" 2>/dev/null || true
sleep 1

"$APP" --remote-debugging-port="$PORT" --user-data-dir="$UD" --no-sandbox --disable-gpu \
  >/tmp/opencode/g4-app.log 2>&1 &
APP_PID=$!
log "APP_PID=$APP_PID"

ok=0
for i in $(seq 1 60); do
  if curl -s --max-time 1 "http://127.0.0.1:$PORT/json" >/dev/null 2>&1; then ok=1; break; fi
  sleep 1
done
log "CDP_READY=$ok after ${i}s"
if [ "$ok" != 1 ]; then log "FATAL: no CDP endpoint"; exit 1; fi

node cdp-ptywatch.mjs "$PTYLOG" >/tmp/opencode/g4-ptywatch.out 2>&1 &
WATCH_PID=$!
sleep 3
log "WATCH_PID=$WATCH_PID"

cat > "$NODE_PROBE" <<'NODEEOF'
const port = process.env.CDP_PORT ?? '18244'
const ptylog = process.argv[2]
const { readFileSync, writeFileSync } = await import('node:fs')
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const page = list.find((t) => t.type === 'page')
if (!page) { console.log('NO_PAGE'); process.exit(1) }
const ws = new WebSocket(page.webSocketDebuggerUrl)
let seq = 0
const pending = new Map()
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
}
await new Promise((r) => (ws.onopen = r))
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq
    pending.set(id, (m) => (m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)))
    ws.send(JSON.stringify({ id, method, params }))
  })
}
async function evaluate(expression) {
  const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (res.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails).slice(0, 1000))
  return res.result.value
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
await send('Runtime.enable')

let editable = null
for (let i = 0; i < 30; i++) {
  editable = await evaluate(`(()=>{const e=document.querySelector('[contenteditable="true"]');if(!e)return null;const r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),w:Math.round(r.width),h:Math.round(r.height),aria:e.getAttribute('aria-label')||''}})()`)
  if (editable && editable.w > 100) break
  await sleep(1000)
}
console.log('COMPOSER ' + JSON.stringify(editable))
if (!editable) { console.log('NO_COMPOSER'); process.exit(0) }

async function key(k, modifiers = 0) {
  const code = k === 'Enter' ? 13 : k === 'Escape' ? 27 : 0
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: k, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, modifiers })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, modifiers })
}
async function typeText(text) {
  for (const ch of text) {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, unmodifiedText: ch, key: ch })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch })
  }
}

// focus the TipTap editor programmatically (click did not focus it)
await evaluate(`document.querySelector('[contenteditable="true"]').focus()`)
await sleep(300)
console.log('FOCUSED ' + await evaluate(`document.activeElement?.getAttribute('contenteditable') ?? 'none'`))

// build a multiline draft
await evaluate(`(()=>{const e=document.querySelector('[contenteditable="true"]');e.focus();document.execCommand('insertText',false,'G4PROBE_L1')})()`)
await sleep(200)
await key('Enter', 8) // shift+enter -> newline
await sleep(200)
await typeText('G4PROBE_L2')
await sleep(300)
console.log('DRAFT ' + JSON.stringify(await evaluate(`document.querySelector('[contenteditable="true"]')?.innerText ?? ''`)))

// clear watcher log, then send
writeFileSync(ptylog, '')
await key('Enter')
await sleep(2500)
console.log('PTY_AFTER_SEND ' + JSON.stringify(readFileSync(ptylog, 'utf8')))

// Escape interrupt
writeFileSync(ptylog, '')
await evaluate(`document.querySelector('[contenteditable="true"]').focus()`)
await sleep(200)
await key('Escape')
await sleep(1500)
console.log('PTY_AFTER_ESC ' + JSON.stringify(readFileSync(ptylog, 'utf8')))

console.log('DONE')
process.exit(0)
NODEEOF

node "$NODE_PROBE" "$PTYLOG" >> "$OUT" 2>&1
log "NODE_EXIT=$?"

kill "$WATCH_PID" 2>/dev/null || true
kill "$APP_PID" 2>/dev/null || true
sleep 1
pkill -f "throwaway-g4/app/orca-ide" 2>/dev/null || true
sleep 1
REMAIN=$(pgrep -fc "throwaway-g4/app/orca-ide" 2>/dev/null || echo 0)
log "REMAINING_ORCA=$REMAIN"
log "PROBE_COMPLETE"

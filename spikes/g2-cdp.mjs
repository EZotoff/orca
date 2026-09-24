// Generic CDP helper for the g2 spike. Usage: node g2-cdp.mjs <js-file-with-expr> or echo expr | ...
import { readFileSync } from 'node:fs'
const port = process.env.CDP_PORT ?? '18250'
const expr = readFileSync(process.argv[2], 'utf8')

const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const page = list.find((t) => t.type === 'page')
if (!page) { console.error('no page target'); process.exit(1) }
const ws = new WebSocket(page.webSocketDebuggerUrl)
let seq = 0
const pending = new Map()
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
}
await new Promise((resolve) => (ws.onopen = resolve))
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq
    pending.set(id, (msg) => (msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)))
    ws.send(JSON.stringify({ id, method, params }))
  })
}
async function click(x, y) {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
}
const pageEval = (expression) => send('Runtime.evaluate', { expression, returnByValue: true }).then((r) => r.result.value)
const fn = new Function('send', 'click', 'page', 'sleep', 'return (async () => {' + expr + '})()')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = await fn(send, click, pageEval, sleep)
if (out !== undefined) console.log(typeof out === 'string' ? out : JSON.stringify(out))
ws.close()

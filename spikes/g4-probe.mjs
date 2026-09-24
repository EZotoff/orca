// CDP DOM probe for the G4 composer matrix.
// Usage: node g4-probe.mjs <expr-file>   (reads a JS expression from the file)
//        node g4-probe.mjs -e '<expr>'   (inline expression)
const port = process.env.CDP_PORT ?? '18244'
const { readFileSync } = await import('node:fs')
const args = process.argv.slice(2)
let expr
if (args[0] === '-e') expr = args[1]
else if (args[0]) expr = readFileSync(args[0], 'utf8')
else {
  console.error('usage: g4-probe.mjs <expr-file> | -e <expr>')
  process.exit(2)
}

const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const page = list.find((t) => t.type === 'page')
if (!page) {
  console.error('no page target')
  process.exit(1)
}
const ws = new WebSocket(page.webSocketDebuggerUrl)
let seq = 0
const pending = new Map()
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m)
    pending.delete(m.id)
  }
}
await new Promise((r) => (ws.onopen = r))
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const id = ++seq
    pending.set(id, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)))
    ws.send(JSON.stringify({ id, method, params }))
  })
await send('Runtime.enable')
const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
if (r.exceptionDetails) {
  console.error('EXC', JSON.stringify(r.exceptionDetails).slice(0, 1500))
  process.exit(1)
}
console.log(JSON.stringify(r.result?.value ?? null, null, 1))
ws.close()

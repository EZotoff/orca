// CDP PTY-write watcher for the G4 composer spike.
// Sets a breakpoint on window.api.pty.write and logs every call's string args,
// then resumes. Run durably while exercising the composer.
// Usage: node cdp-ptywatch.mjs <outfile>
const port = process.env.CDP_PORT ?? '18244'
const outfile = process.argv[2] ?? '/tmp/opencode/g4-ptywatch.log'
const { appendFileSync } = await import('node:fs')

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
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg)
    pending.delete(msg.id)
  }
}
await new Promise((resolve) => (ws.onopen = resolve))
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq
    pending.set(id, (msg) => (msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)))
    ws.send(JSON.stringify({ id, method, params }))
  })
}
function log(line) {
  appendFileSync(outfile, line + '\n')
}

await send('Runtime.enable')
await send('Debugger.enable')
const fn = await send('Runtime.evaluate', { expression: 'window.api.pty.write', returnByValue: false })
const objectId = fn.result.objectId
if (!objectId) {
  log('ERROR: no objectId for window.api.pty.write')
  process.exit(1)
}
await send('Debugger.setBreakpointOnFunctionCall', { objectId })
log(`# watching window.api.pty.write at ${new Date().toISOString()}`)

let paused = false
ws.addEventListener('message', async (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.method !== 'Debugger.paused' || paused) return
  paused = true
  try {
    const frame = msg.params.callFrames[0]
    const local = frame.scopeChain.find((s) => s.type === 'local')
    let args = []
    if (local && local.object && local.object.objectId) {
      const props = await send('Runtime.getProperties', {
        objectId: local.object.objectId,
        ownProperties: true
      })
      args = (props.result || [])
        .filter((p) => p.value && p.value.type === 'string')
        .map((p) => p.value.value)
    }
    log(`${Date.now()} ${JSON.stringify(args)}`)
  } catch (e) {
    log(`ERR ${e}`)
  } finally {
    await send('Debugger.resume')
    paused = false
  }
})

// keep alive
setInterval(() => {}, 1 << 30)

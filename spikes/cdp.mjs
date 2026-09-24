// Minimal CDP client for orca-nav live verification (node >= 22, global WebSocket).
// Usage: node cdp.mjs <command> [args...]
//   targets                          list page targets
//   eval <expression>                Runtime.evaluate (returnByValue)
//   inject-logger                    install window-capture keydown/keyup recorder
//   dump-log                         read + clear recorded key events (JSON lines)
//   shot <outfile>                   Page.captureScreenshot
//   active-element                   report document.activeElement description
const port = process.env.CDP_PORT ?? '18241'
const [, , cmd, ...args] = process.argv

const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const page = list.find((t) => t.type === 'page')
if (!page) {
  console.error('no page target')
  process.exit(1)
}
if (cmd === 'targets') {
  console.log(JSON.stringify(list.map((t) => ({ type: t.type, title: t.title, url: t.url })), null, 1))
  process.exit(0)
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

async function evaluate(expression) {
  const res = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true
  })
  if (res.exceptionDetails) {
    throw new Error(JSON.stringify(res.exceptionDetails).slice(0, 2000))
  }
  return res.result.value
}

await send('Runtime.enable')
await send('Page.enable')

if (cmd === 'eval') {
  console.log(JSON.stringify(await evaluate(args.join(' '))))
} else if (cmd === 'inject-logger') {
  await evaluate(`(() => {
    if (window.__navKeyLog) return 'already'
    window.__navKeyLog = []
    const rec = (e) => {
      const t = e.target
      window.__navKeyLog.push({
        t: Date.now(), type: e.type, key: e.key, code: e.code,
        alt: e.altKey, ctrl: e.ctrlKey, shift: e.shiftKey, meta: e.metaKey,
        defPrev: e.defaultPrevented,
        target: t && t.tagName ? t.tagName + (t.className && t.className.slice ? '.' + String(t.className).slice(0, 40) : '') : String(t)
      })
      if (window.__navKeyLog.length > 4000) window.__navKeyLog.splice(0, 2000)
    }
    window.addEventListener('keydown', rec, true)
    window.addEventListener('keyup', rec, true)
    return 'installed'
  })()`).then((v) => console.log(v))
} else if (cmd === 'dump-log') {
  const log = await evaluate('window.__navKeyLog ?? []')
  for (const e of log) console.log(JSON.stringify(e))
  await evaluate('window.__navKeyLog = []')
} else if (cmd === 'shot') {
  const res = await send('Page.captureScreenshot', { format: 'png' })
  const { writeFileSync } = await import('node:fs')
  writeFileSync(args[0], Buffer.from(res.data, 'base64'))
  console.log('wrote', args[0])
} else if (cmd === 'active-element') {
  console.log(
    JSON.stringify(
      await evaluate(`(() => { const e = document.activeElement
        return e ? { tag: e.tagName, cls: String(e.className).slice(0,80), id: e.id, role: e.getAttribute('role') } : null })()`)
    )
  )
} else {
  console.error('unknown command', cmd)
  process.exit(1)
}
ws.close()

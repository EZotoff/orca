// CDP input helper for the G4 composer spike (node >= 22, global WebSocket).
// Usage:
//   node cdp-input.mjs click <x> <y>
//   node cdp-input.mjs click-selector <css>
//   node cdp-input.mjs type <text>
//   node cdp-input.mjs key <key> [modifiers]   modifiers: ctrl,shift,alt,meta (comma)
//   node cdp-input.mjs paste <text>            (insertText via Input.insertText)
//   node cdp-input.mjs ime <text>              (composition start/update/end)
//   node cdp-input.mjs rect <css>
const port = process.env.CDP_PORT ?? '18244'
const [, , cmd, ...args] = process.argv

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
async function evaluate(expression) {
  const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (res.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails).slice(0, 2000))
  return res.result.value
}
await send('Runtime.enable')
await send('Page.enable')

const MOD = { alt: 1, ctrl: 2, meta: 4, shift: 8 }
function modMask(s) {
  if (!s) return 0
  return s.split(',').reduce((m, k) => m | (MOD[k.trim()] ?? 0), 0)
}
async function mouseClick(x, y, button = 'left') {
  const base = { x, y, button, clickCount: 1 }
  const buttons = button === 'right' ? 2 : 1
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...base })
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...base, buttons })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...base, buttons })
}
async function rectOf(sel) {
  return evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if(!e) return null; const r=e.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height}; })()`)
}

if (cmd === 'click') {
  await mouseClick(Number(args[0]), Number(args[1]))
  console.log('clicked', args[0], args[1])
} else if (cmd === 'rightclick') {
  await mouseClick(Number(args[0]), Number(args[1]), 'right')
  console.log('rightclicked', args[0], args[1])
} else if (cmd === 'click-selector') {
  const r = await rectOf(args[0])
  if (!r) { console.error('not found', args[0]); process.exit(1) }
  await mouseClick(r.x, r.y)
  console.log('clicked', args[0], JSON.stringify(r))
} else if (cmd === 'rect') {
  console.log(JSON.stringify(await rectOf(args[0])))
} else if (cmd === 'type') {
  for (const ch of args.join(' ')) {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, unmodifiedText: ch, key: ch })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch })
  }
  console.log('typed', args.join(' ').length, 'chars')
} else if (cmd === 'key') {
  const key = args[0]
  const modifiers = modMask(args[1])
  const keyCodeMap = { Enter: 13, Tab: 9, Escape: 27, Backspace: 8, ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, ' ': 32 }
  const code = keyCodeMap[key] ?? (key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0)
  const text = key.length === 1 && !modifiers ? key : undefined
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, modifiers, text, unmodifiedText: text })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, modifiers })
  console.log('key', key, args[1] ?? '')
} else if (cmd === 'paste') {
  await send('Input.insertText', { text: args.join(' ') })
  console.log('inserted', args.join(' ').length, 'chars')
} else if (cmd === 'ime') {
  const text = args.join(' ')
  await send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length })
  await send('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length })
  await send('Input.insertText', { text })
  console.log('ime', text)
} else {
  console.error('unknown command', cmd)
  process.exit(1)
}
ws.close()

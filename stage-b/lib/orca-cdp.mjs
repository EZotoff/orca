// Shared CDP helper for the Stage B soak harness (orca-transition Task 25).
// Connects to the Orca renderer's remote-debugging port and exposes a tiny
// evaluate/send surface. No app hooks are required: everything is read from
// the live DOM and driven with real input events.
export async function connect(port = process.env.CDP_PORT ?? '18260') {
  const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
  const page = list.find((t) => t.type === 'page')
  if (!page) throw new Error('no page target on CDP port ' + port)
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
  const evaluate = (expression) =>
    send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }).then((r) => {
      if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 500))
      return r.result.value
    })
  await send('Runtime.enable')
  return { send, evaluate, close: () => ws.close() }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Active pane index (DOM order) or -1 when focus is outside every pane.
export const ACTIVE_PANE_EXPR =
  '(()=>{const ps=[...document.querySelectorAll(".pane")];return ps.findIndex(p=>p.contains(document.activeElement))})()'

export const PANE_COUNT_EXPR = 'document.querySelectorAll(".pane").length'

// Press a chord via CDP. modifiers: Alt=1, Ctrl=2, Meta=4, Shift=8.
export async function press(send, { key, code, vk, modifiers = 0 }) {
  const base = { key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers }
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
}

export async function typeText(send, text) {
  await send('Input.insertText', { text })
}

export async function pressEnter(send) {
  await press(send, { key: 'Enter', code: 'Enter', vk: 13 })
}

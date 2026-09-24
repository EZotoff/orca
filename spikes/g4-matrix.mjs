// G4 composer feature-matrix driver (v2).
// Two parts:
//  A) OpenCode session: composer NOT mounted (structural) -> PTY-only, authority invariant.
//  B) Claude session (control): composer mounted -> characterize each feature via PTY bytes.
// Usage: CDP_PORT=18244 node g4-matrix.mjs <outfile.json>
const port = process.env.CDP_PORT ?? '18244'
const outfile = process.argv[2] ?? '/tmp/opencode/g4-matrix.json'
const { writeFileSync } = await import('node:fs')

const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const page = list.find((t) => t.type === 'page')
if (!page) { console.error('no page target'); process.exit(1) }
const ws = new WebSocket(page.webSocketDebuggerUrl)
let seq = 0
const pending = new Map()
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
}
await new Promise((r) => (ws.onopen = r))
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const id = ++seq
    pending.set(id, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)))
    ws.send(JSON.stringify({ id, method, params }))
  })
await send('Runtime.enable')
await send('Page.enable')
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 800))
  return r.result?.value ?? null
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Patch window.api.pty.write in-page to capture every write (the composer's send
// path calls this; the earlier miss was because the patch was installed after a
// page reload — re-install and verify).
const patchPty = async () => evaluate(`(() => {
  if (window.__g4pty && window.__g4ptyPatched) return 'already';
  window.__g4pty = [];
  const orig = window.api.pty.write.bind(window.api.pty);
  window.api.pty.write = function (...args) {
    try { window.__g4pty.push({ t: Date.now(), args: args.map(a => typeof a === 'string' ? a : (a && typeof a === 'object' ? '[obj]' : a)) }); } catch {}
    return orig(...args);
  };
  window.__g4ptyPatched = true;
  return 'patched';
})()`)
const drainPty = async () => (await evaluate('(() => { const r = window.__g4pty || []; window.__g4pty = []; return r; })()')) || []

const composerInfo = () => evaluate(`(() => {
  const ce = document.querySelector('[contenteditable="true"]');
  if (!ce) return null;
  const r = ce.getBoundingClientRect();
  return { text: ce.textContent || '', visible: r.width > 0 && r.height > 0, aria: ce.getAttribute('aria-label') };
})()`)
const focusComposer = () => evaluate(`(() => {
  const ce = document.querySelector('[contenteditable="true"]');
  if (!ce) return false;
  ce.focus();
  return document.activeElement === ce;
})()`)
const clearComposer = () => evaluate(`(() => {
  const ce = document.querySelector('[contenteditable="true"]');
  if (!ce) return null;
  ce.focus();
  document.execCommand('selectAll');
  document.execCommand('delete');
  return ce.textContent;
})()`)

// Type via CDP key events, one char at a time with a small settle delay so
// ProseMirror's async input handling does not drop characters.
const typeText = async (text) => {
  for (const ch of text) {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, unmodifiedText: ch, key: ch })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch })
    await sleep(12)
  }
}
const pressKey = async (key, modifiers = 0) => {
  const map = { Enter: 13, Tab: 9, Escape: 27, Backspace: 8, ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, ' ': 32 }
  const code = map[key] ?? (key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0)
  const text = key.length === 1 && !modifiers ? key : undefined
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, modifiers, text, unmodifiedText: text })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, modifiers })
}
const insertText = (text) => send('Input.insertText', { text })

const results = []
const record = (feature, verdict, surface, evidence, extra = {}) => {
  results.push({ feature, verdict, surface, evidence, ...extra, ts: new Date().toISOString() })
  console.log(`[${verdict}] ${feature} :: ${evidence}`)
}

await patchPty()

// ============ PART A: OpenCode session (composer not mounted) ============
// Switch to the OpenCode session (g4-composer-spike) and confirm composer absence.
const clickSession = async (y) => { await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 140, y, button: 'left', clickCount: 1, buttons: 1 }); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 140, y, button: 'left', clickCount: 1, buttons: 1 }) }

await clickSession(422) // g4-composer-spike (OpenCode)
await sleep(1500)
const ocComposer = await composerInfo()
const ocXterms = await evaluate(`(() => Array.from(document.querySelectorAll('.xterm')).map(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }))()`)
record('composer-surface (OpenCode session)', ocComposer && ocComposer.visible ? 'works' : 'not-present',
  'OpenCode session pane',
  `composer mounted=${ocComposer ? ocComposer.visible : false}; visible xterm=${ocXterms.filter(Boolean).length}; OpenCode renders as plain PTY terminal`,
  { composerVisible: ocComposer ? ocComposer.visible : false, xterms: ocXterms })

// Authority invariant: type into the OpenCode PTY, confirm the OpenCode TUI owns it.
const focusVisibleXterm = () => evaluate(`(() => {
  const xs = Array.from(document.querySelectorAll('.xterm'));
  const vis = xs.find(e => e.getBoundingClientRect().width > 0);
  if (!vis) return false;
  const ta = vis.querySelector('textarea');
  if (ta) { ta.focus(); return true; }
  return false;
})()`)
await focusVisibleXterm()
await typeText('G4AUTH_TEST')
await sleep(400)
const ocScreen = await evaluate(`(() => {
  const xs = Array.from(document.querySelectorAll('.xterm'));
  const vis = xs.find(e => e.getBoundingClientRect().width > 0);
  if (!vis) return '';
  return Array.from(vis.querySelectorAll('.xterm-rows > div')).map(r => r.textContent.replace(/\\s+$/, '')).filter(Boolean).slice(-8).join('\\n');
})()`)
const authOk = (ocScreen || '').includes('G4AUTH_TEST')
record('authority-invariant (OpenCode)', authOk ? 'works' : 'fails',
  'OpenCode TUI (xterm) is the authoritative prompt',
  `typed text appears in OpenCode TUI input box=${authOk}; OpenCode owns submission; no Orca editor state`,
  { screenTail: (ocScreen || '').slice(-300) })
// clear the OpenCode input line
await pressKey('u', 2) // ctrl+u
await sleep(300)

// ============ PART B: Claude session (composer mounted) — control ============
await clickSession(351) // g4-claude-spike (Claude)
await sleep(1500)
const clComposer = await composerInfo()
record('composer-surface (Claude session)', clComposer && clComposer.visible ? 'works' : 'not-present',
  'Claude session pane',
  `composer mounted=${clComposer ? clComposer.visible : false}; aria="${clComposer?.aria}"`,
  { composerVisible: clComposer ? clComposer.visible : false })

// B1: reliable editing + undo
await focusComposer()
await typeText('G4EDIT_ALPHA')
await sleep(200)
const afterType = await composerInfo()
await pressKey('Backspace'); await pressKey('Backspace'); await pressKey('Backspace')
await sleep(150)
const afterBackspace = await composerInfo()
await pressKey('z', 2) // ctrl+z
await sleep(200)
const afterUndo = await composerInfo()
record('reliable-editing+undo', (afterType?.text === 'G4EDIT_ALPHA' && afterBackspace?.text === 'G4EDIT_') ? (afterUndo?.text === 'G4EDIT_ALPHA' ? 'works' : 'partial') : 'fails',
  'native-composer (TipTap contenteditable)',
  `typed="${afterType?.text}" backspace3="${afterBackspace?.text}" ctrlZ="${afterUndo?.text}"`,
  { afterType: afterType?.text, afterBackspace: afterBackspace?.text, afterUndo: afterUndo?.text })
await clearComposer(); await sleep(150)

// B2: multiline entry (Shift+Enter inserts newline, no PTY write)
await focusComposer()
await typeText('G4LINE1')
await pressKey('Enter', 8)
await typeText('G4LINE2')
await sleep(200)
const afterMultiline = await composerInfo()
const ptyMultiline = await drainPty()
record('multiline-entry', (afterMultiline?.text?.includes('G4LINE1') && afterMultiline?.text?.includes('G4LINE2') && ptyMultiline.length === 0) ? 'works' : (afterMultiline?.text?.includes('G4LINE1') ? 'partial' : 'fails'),
  'native-composer (Shift+Enter)',
  `composer="${(afterMultiline?.text || '').replace(/\\n/g, '\\\\n')}" ptyWrites=${ptyMultiline.length}`,
  { composer: afterMultiline?.text, ptyWrites: ptyMultiline })
await clearComposer(); await sleep(150)

// B3: long paste (multi-KB)
const longText = Array.from({ length: 60 }, (_, i) => `line ${String(i).padStart(3, '0')} lorem ipsum dolor sit amet consectetur adipiscing elit`).join('\n')
await focusComposer()
await insertText(longText)
await sleep(400)
const afterLongPaste = await composerInfo()
record('long-paste-multikb', (afterLongPaste?.text?.length >= longText.length * 0.95) ? 'works' : (afterLongPaste?.text?.length > 100 ? 'partial' : 'fails'),
  'native-composer (Input.insertText)',
  `pastedChars=${longText.length} composerChars=${afterLongPaste?.text?.length}`,
  { pastedChars: longText.length, composerChars: afterLongPaste?.text?.length })
await clearComposer(); await sleep(150)

// B4: bracketed-paste preservation — multiline draft submitted via Enter must
// arrive at the PTY as ONE \x1b[200~...\x1b[201~ wrap, then \r as a SEPARATE write.
await focusComposer()
await insertText('G4BP_LINE1\nG4BP_LINE2')
await sleep(300)
await pressKey('Enter')
await sleep(800)
const ptySubmit = await drainPty()
const bpWrites = ptySubmit.map((r) => r.args[2]).filter((s) => typeof s === 'string')
const hasBpWrap = bpWrites.some((s) => s.includes('\x1b[200~') && s.includes('\x1b[201~'))
const hasSeparateEnter = bpWrites.some((s) => s === '\r')
record('bracketed-paste-preservation', hasBpWrap ? (hasSeparateEnter ? 'works' : 'partial') : 'fails',
  'native-composer -> PTY (window.api.pty.write)',
  `ptyWrites=${JSON.stringify(bpWrites.map((s) => s.replace(/\x1b/g, 'ESC').replace(/\r/g, '\\r').replace(/\n/g, '\\n').slice(0, 70)))} bpWrap=${hasBpWrap} separateEnter=${hasSeparateEnter}`,
  { ptyWrites: bpWrites, bpWrap: hasBpWrap, separateEnter: hasSeparateEnter })

// B5: no accidental prompt submission — typing alone writes nothing to the PTY.
await focusComposer()
await typeText('G4NOSUBMIT')
await sleep(300)
const ptyTyping = await drainPty()
record('no-accidental-submission', ptyTyping.length === 0 ? 'works' : 'fails',
  'native-composer (typing only)',
  `ptyWritesWhileTyping=${ptyTyping.length}`,
  { ptyWritesWhileTyping: ptyTyping })
await clearComposer(); await sleep(150)

// B6: Ctrl+C / interrupt — Esc in the composer writes a bare ESC byte to the PTY.
await focusComposer()
await pressKey('Escape')
await sleep(500)
const ptyEsc = await drainPty()
const escWrites = ptyEsc.map((r) => r.args[2]).filter((s) => typeof s === 'string')
record('ctrl-c-interrupt', escWrites.some((s) => s === '\x1b') ? 'works' : (escWrites.length ? 'partial' : 'fails'),
  'native-composer (Esc -> PTY ESC byte)',
  `ptyWrites=${JSON.stringify(escWrites.map((s) => s.replace(/\x1b/g, 'ESC')))}`,
  { ptyWrites: escWrites })

// B7: image/file input — DOM affordances
const attachInfo = await evaluate(`(() => {
  const btns = Array.from(document.querySelectorAll('button,[role="button"]')).map(b => (b.getAttribute('aria-label') || b.title || b.textContent || '').trim()).filter(Boolean);
  const attach = btns.filter(t => /attach|image|file|upload|paperclip|photo/i.test(t));
  return { attachButtons: attach, fileInputs: document.querySelectorAll('input[type="file"]').length };
})()`)
record('image-file-input', (attachInfo?.fileInputs > 0 || attachInfo?.attachButtons?.length > 0) ? 'works' : 'not-present',
  'native-composer (DOM affordances)',
  `fileInputs=${attachInfo?.fileInputs} attachButtons=${JSON.stringify(attachInfo?.attachButtons)}`,
  attachInfo)

// B8: IME composition — no engine on host
record('ime-composition-confirm', 'SKIPPED-ENV',
  'native-composer (IME)',
  'no IME engine active on host (X11, no fcitx/ibus); composer has dedicated composition handling + tests',
  {})

writeFileSync(outfile, JSON.stringify({ generatedAt: new Date().toISOString(), port, results }, null, 2))
console.log(`\nWROTE ${outfile} (${results.length} rows)`)
ws.close()

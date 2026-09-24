// G2 measurement suite — runs against the live throwaway via g2-cdp.mjs.
// Usage: node spikes/g2-cdp.mjs spikes/g2-measure.mjs
const fs = await import('node:fs')
const snapshot = JSON.parse(fs.readFileSync('/home/ezotoff/src/orca-g2/spikes/g2-snapshot.json', 'utf8'))
await page(`window.__g2.setSnapshot(${JSON.stringify(snapshot)})`)
await sleep(1500)
const state = await page('JSON.stringify(window.__g2.state())')
const board = await page(`(() => {
  const panel = document.querySelector('[data-g2-panel]')
  if (!panel) return JSON.stringify({err:'no panel'})
  const cols = [...panel.querySelectorAll('[data-bucket], [class*=column]')]
  const cardEls = [...panel.querySelectorAll('[class*=card]')]
  const esc = cardEls.find(c => /Supervisor/i.test(c.textContent))
  const escRect = esc ? esc.getBoundingClientRect() : null
  const panelRect = panel.getBoundingClientRect()
  const scroller = [...panel.querySelectorAll('*')].find(e => e.scrollWidth > e.clientWidth + 2)
  return JSON.stringify({
    panel: {w: Math.round(panelRect.width), h: Math.round(panelRect.height)},
    cols: cols.length,
    cardsRendered: cardEls.length,
    cardsExpected: ${JSON.stringify(snapshot.cards.length)},
    probeTextHits: (panel.textContent.match(/PROBE/g) || []).length,
    escalation: escRect ? {
      visibleWithoutScroll: escRect.top >= panelRect.top && escRect.bottom <= panelRect.bottom && escRect.right <= panelRect.right + 1,
      top: Math.round(escRect.top - panelRect.top), height: Math.round(escRect.height)
    } : null,
    hScroll: scroller ? {sw: scroller.scrollWidth, cw: scroller.clientWidth} : null,
    vScroll: panel.scrollHeight > panel.clientHeight + 2 ? {sh: panel.scrollHeight, ch: panel.clientHeight} : null
  })
})()`)
console.log('STATE', state)
console.log('BOARD', board)
const targets = JSON.parse(await page('JSON.stringify(window.__g2.listTargets())'))
console.log('TARGETS', JSON.stringify(targets))
// >=20 jumps across all quadrants: cycle every leaf 4x (6 leaves x 4 = 24)
const leaves = targets.flatMap(t => t.leafIds.map(l => ({tabId: t.tabId, leafId: l})))
const results = []
for (let round = 0; round < 4; round++) {
  for (const t of leaves) {
    const r = await page(`window.__g2.jump(${JSON.stringify(t.tabId)}, ${JSON.stringify(t.leafId)}).then(r => JSON.stringify(r))`).then(JSON.parse)
    results.push(r)
    await sleep(120)
  }
}
fs.writeFileSync('/home/ezotoff/src/orca-g2/spikes/g2-jump-rows.jsonl', results.map(r => JSON.stringify(r)).join('\n'))
const ok = results.filter(r => r.verified)
const ms = ok.map(r => r.elapsedMs).sort((a, b) => a - b)
const stats = {
  n: results.length, verified: ok.length,
  p50: ms[Math.floor(ms.length / 2)], p95: ms[Math.floor(ms.length * 0.95)], max: ms[ms.length - 1],
  over1s: ok.filter(r => r.elapsedMs > 1000).length,
  unverified: results.filter(r => !r.verified).map(r => r.leafId)
}
console.log('JUMPS', JSON.stringify(stats))
return 'DONE'

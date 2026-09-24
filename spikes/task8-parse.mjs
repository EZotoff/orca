#!/usr/bin/env node
// Parse task8 jump logs: per-jump latency = last chord keydown(preventDefault ts) -> first focus() on final pane.
import fs from 'fs'
const rows = []
for (const f of ['task8-jumplog-A.txt', 'task8-jumplog-B.txt', 'task8-jumplog-C.txt']) {
  const lines = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean)
  for (let i = 0; i < lines.length; i += 2) {
    const row = lines[i], data = JSON.parse(JSON.parse(lines[i + 1].replace(/^DATA /, "")))
    const m = row.match(/^ROW (\S+) src=(-?\d+) dst=(-?\d+) nchords=(\d+) active=(-?\d+) wallms=(\d+)/)
    if (!m) continue
    const [, name, src, dst, nch, active, wall] = m
    const foc = data.focuses.find(x => x.pane === Number(active))
    let ms = 'n/a'
    if (foc) { const prior = data.keys.map(k => k.ts).filter(t => t <= foc.ts); if (prior.length) ms = (foc.ts - Math.max(...prior)).toFixed(1) }
    rows.push({ name, src: +src, dst: +dst, nchords: +nch, reached: +active, ok: Number(active) === Number(dst), msLastChord: ms, wallms: +wall })
  }
}
const lat = rows.filter(r => r.msLastChord !== 'n/a').map(r => +r.msLastChord).sort((a, b) => a - b)
const p = q => lat[Math.floor(q * (lat.length - 1))]
console.log(JSON.stringify(rows, null, 0).replace(/\},\{/g, '},{\n'))
console.error(`n=${rows.length} latn=${lat.length} p50=${p(0.5)} p95=${p(0.95)} max=${lat[lat.length - 1]}`)

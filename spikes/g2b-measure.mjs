// G2b BINDING gate: >=20-jump <=1s fast-switch measurement against the REAL
// identity bridge (operator/identity-bridge), not the G2 prototype seam.
//
// Real path exercised per jump:
//   SupervisorRelayFocusService.jump (real)
//     -> IdentityBridge.resolveOutcome (real: reconcile vs live inventory +
//        hook correlations, persisted via real IdentityBridgeStore)
//     -> RuntimeFocusPort.focusTerminal == terminal.focus RPC over the real
//        E2EE runtime transport (sendRemoteRuntimeRequest) to a REAL orcad
//        runtime hosting REAL PTYs
//     -> focus verified via terminal.list (handle live, tabId == focused tabId)
//
// Fixture seams (injectable by design, Task 16 wires the live ones):
//   - LiveInventorySource: fed from the real orcad terminal.list payload
//   - HookCorrelationSource: synthetic authenticated-hook reports (one per
//     fixture terminal), verified by the REAL reconcile against live inventory
//
// Usage: G2B_PAIRING_URL='orca://pair?code=...' node out/g2b-measure.bundle.mjs
import { mkdir, rm } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { IdentityBridge } from '../src/main/identity-bridge/identity-bridge'
import { IdentityBridgeStore } from '../src/main/identity-bridge/identity-bridge-store'
import { SupervisorRelayFocusService } from '../src/main/supervisor-relay/supervisor-relay-focus'
import { decodePairingOffer } from '../src/shared/pairing'
import { sendRemoteRuntimeRequest } from '../src/shared/remote-runtime-client'

const HOST = 'runtime:g2b-orcad' // client-side execution host id for the paired orcad runtime
const BRIDGE_PATH = new URL('./g2b-bridge.json', import.meta.url).pathname
const ROWS_PATH = new URL('./g2b-jump-rows.jsonl', import.meta.url).pathname

const url = process.env.G2B_PAIRING_URL
if (!url) throw new Error('G2B_PAIRING_URL not set')
const pairing = decodePairingOffer(url)
const rpc = (method, params, timeoutMs = 10000) =>
  sendRemoteRuntimeRequest(pairing, method, params, timeoutMs)

// --- fixture: 3 projects, 8 terminals (3+3+2) --------------------------------
const projects = [
  { root: '/home/ezotoff/src/orca-g2', terminals: 3 },
  { root: '/home/ezotoff/src/orca-g2/spikes/g2-fixture-repo', terminals: 3 },
  { root: '/tmp/opencode/g2b/proj3', terminals: 2 }
]

async function listLive() {
  const response = await rpc('terminal.list', {})
  if (!response.ok) throw new Error('terminal.list failed: ' + JSON.stringify(response.error))
  return response.result.terminals
}

// --- real bridge with fixture-fed seams --------------------------------------
const inventory = {
  listInventory: async () => {
    const terminals = await listLive()
    return {
      terminals: terminals
        .filter((t) => t.connected)
        .map((t) => ({
          executionHostId: HOST,
          worktreeIdentity: t.worktreeId,
          tabId: t.tabId,
          leafId: t.leafId,
          terminalHandle: t.handle,
          launchToken: t.launchToken ?? undefined
        })),
      connectedHosts: [HOST]
    }
  }
}
let correlations = []
const correlationSource = { listCorrelations: async () => correlations }

await rm(BRIDGE_PATH, { force: true })
const bridge = new IdentityBridge({
  store: new IdentityBridgeStore(BRIDGE_PATH),
  inventory,
  correlations: correlationSource
})

// --- real focus service; focus port mirrors supervisor-relay-ipc runtimeFocusPort
let lastFocus = null
const focusService = new SupervisorRelayFocusService({
  bridge,
  focus: {
    focusTerminal: async (terminalHandle, executionHostId) => {
      if (executionHostId !== HOST) return false
      const response = await rpc('terminal.focus', { terminal: terminalHandle, navigation: 'host' })
      lastFocus = response.ok ? response.result.focus : null
      return response.ok
    }
  }
})

// --- build fixture: terminals + hook correlations + operator-view cards ------
const cards = []
const live0 = await listLive()
for (const project of projects) {
  const add = await rpc('repo.add', { path: project.root })
  if (!add.ok) throw new Error(`repo.add failed for ${project.root}: ${JSON.stringify(add.error)}`)
}

const launchTokenByHandle = new Map()
let n = 0
for (const project of projects) {
  for (let i = 0; i < project.terminals; i++) {
    const launchToken = `g2b-t${n}`
    const created = await rpc('terminal.create', {
      worktree: project.root,
      launchToken,
      title: `G2B ${project.root.split('/').pop()} #${i}`
    })
    if (!created.ok) throw new Error(`terminal.create failed for ${project.root}: ${JSON.stringify(created.error)}`)
    const t = created.result.terminal
    launchTokenByHandle.set(t.handle, launchToken)
    correlations.push({
      executionHostId: HOST,
      tabId: t.tabId,
      leafId: t.paneKey.split(':')[1],
      launchToken,
      sessionID: `ses-g2b-${n}`,
      canonicalRoot: project.root
    })
    cards.push({
      id: `card-${n}`,
      label: `${project.root.split('/').pop()} session ${n}`,
      sessionRef: { executionHostId: HOST, canonicalRoot: project.root, sessionID: `ses-g2b-${n}` }
    })
    n++
  }
}
console.log(`FIXTURE ${n} terminals across ${projects.length} projects (pre-existing live: ${live0.length})`)

// Seed the bridge through the REAL write path: reconcile verifies each hook
// correlation against live inventory and persists the record.
const seeded = await bridge.reconcile()
console.log(`SEED reconcile verified=${seeded.verified.length} rejected=${seeded.rejected.length}`)
if (seeded.verified.length !== n) throw new Error('bridge did not verify every fixture correlation')

const view = { cards }

// --- >=20 jumps: cycle all 8 targets 3x = 24 ----------------------------------
const rows = []
const targets = cards.map((c) => c.id)
const ROUNDS = 3
for (let round = 0; round < ROUNDS; round++) {
  for (const cardId of targets) {
    const from = rows.length ? rows[rows.length - 1].to : 'start'
    const t0 = performance.now() // identity lookup start
    const outcome = await focusService.jump(cardId, view)
    const tFocus = performance.now()
    let verified = false
    let verifyMs = null
    if (outcome.status === 'focused' && lastFocus) {
      const card = cards.find((c) => c.id === cardId)
      const expected = correlations.find(
        (c) => c.sessionID === card.sessionRef.sessionID && c.canonicalRoot === card.sessionRef.canonicalRoot
      )
      const v0 = performance.now()
      const listResponse = await rpc('terminal.list', { handles: [lastFocus.handle] })
      const live = listResponse.ok ? listResponse.result.terminals[0] : null
      verified =
        live !== undefined &&
        live.connected === true &&
        live.tabId === lastFocus.tabId &&
        lastFocus.tabId === expected.tabId
      verifyMs = performance.now() - v0
    }
    const tVerified = performance.now()
    rows.push({
      round: round + 1,
      from,
      to: cardId,
      outcome: outcome.status,
      verified,
      elapsedMs: Math.round((tVerified - t0) * 100) / 100,
      focusMs: Math.round((tFocus - t0) * 100) / 100,
      verifyMs: verifyMs === null ? null : Math.round(verifyMs * 100) / 100,
      ts: new Date().toISOString()
    })
    await new Promise((r) => setTimeout(r, 100))
  }
}

const { writeFileSync } = await import('node:fs')
writeFileSync(ROWS_PATH, rows.map((r) => JSON.stringify(r)).join('\n'))
const ok = rows.filter((r) => r.verified && r.outcome === 'focused')
const ms = ok.map((r) => r.elapsedMs).sort((a, b) => a - b)
const stats = {
  n: rows.length,
  verified: ok.length,
  p50: ms[Math.floor(ms.length / 2)],
  p95: ms[Math.floor(ms.length * 0.95)],
  max: ms[ms.length - 1],
  over1s: ok.filter((v) => v > 1000).length,
  unverified: rows.filter((r) => !r.verified).map((r) => r.to)
}
console.log('JUMPS', JSON.stringify(stats))
console.log('ROWS_PATH', ROWS_PATH)

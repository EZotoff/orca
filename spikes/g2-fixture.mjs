// G2 real-density fixture (orca-transition Task 9).
// Operator's ACTUAL active project set (from stage-a/baseline-2026-09-24.md
// project inventory + ~/src, ~/AI_projects listings) with a realistic
// concurrent session distribution: several Idle, many Working, multiple
// Needs You, ONE synthetic Supervisor escalation (the only synthetic-by-rule
// card), plus probe-class cards that the contract-(f) filter must drop.
// Prints the snapshot JSON on stdout.
const now = Date.now()
const m = (min) => now - min * 60_000

// [repoName, bucket(s)...] — 13 real projects, 24 real-shape sessions.
const projects = [
  { repo: 'ez-omo-config', sessions: [['working', 'provider retry patch'], ['attention', 'review systemd units']] },
  { repo: 'ez-omo-dash', sessions: [['working', 'attention queue card'], ['idle']] },
  { repo: 'voice-bridge', sessions: [['working', 'Gemini Live interrupt fix'], ['done']] },
  { repo: 'omo-control-plane', sessions: [['working', 'read model tests']] },
  { repo: 'omo-tg', sessions: [['idle']] },
  { repo: 'orca', sessions: [['working', 'nav precedence table'], ['working', 'identity bridge reconcile'], ['attention', 'chord gate re-run']] },
  { repo: 'accounting', sessions: [['idle']] },
  { repo: 'bim', sessions: [['working', 'IFC wall mapping'], ['done']] },
  { repo: 'ifc', sessions: [['idle']] },
  { repo: 'kraken', sessions: [['working', 'tasklite metrics'], ['attention', 'quota probe failure']] },
  { repo: 'market_research', sessions: [['done']] },
  { repo: 'asta-trading', sessions: [['working', 'backtest sweep']] },
  {
    repo: 'ANIA_data_watch_blocker_backup_20260505-181214',
    sessions: [['idle'], ['working', 'long-name-column-fit probe']]
  }
].map((p) => ({ ...p, repoId: `r-${p.repo}` }))

const dotFor = { attention: 'waiting', working: 'working', done: 'done', idle: 'idle' }
const cards = []
let n = 0
for (const p of projects) {
  for (const [bucket, taskText] of p.sessions) {
    n += 1
    cards.push({
      paneKey: `g2-${String(n).padStart(2, '0')}`,
      ptyId: null,
      agentType: 'opencode',
      bucket,
      dotState: dotFor[bucket],
      task: taskText ?? 'session',
      repoId: p.repoId,
      worktreeId: `wt-${p.repoId}`,
      tabId: `tab-${n}`,
      leafId: `leaf-${n}`,
      repoName: p.repo,
      worktreeName: p.repo,
      startedAt: m(90),
      finishedAt: bucket === 'done' ? m(12) : null,
      stateChangedAt: m(bucket === 'attention' ? 3 + n : 30 + n),
      unseen: bucket === 'attention',
      conversationName:
        p.repo === 'accounting' ? '회계 자동화 수정' : p.repo === 'bim' ? '벽 매핑 검토' : `${p.repo} session ${n}`
    })
  }
}

// The ONE synthetic Supervisor escalation (allowed by the plan: synthetic
// cards acceptable ONLY for the escalation). Most recent stateChangedAt so it
// sorts to the top of the Needs You column.
cards.push({
  paneKey: 'g2-esc',
  ptyId: null,
  agentType: 'opencode',
  bucket: 'attention',
  dotState: 'blocked',
  task: '[Supervisor] escalate: bench campaign quota exhausted, K3 fallback failed',
  repoId: 'r-orca',
  worktreeId: 'wt-r-orca',
  tabId: 'tab-3',
  leafId: 'leaf-3',
  repoName: 'orca',
  worktreeName: 'orca',
  startedAt: m(20),
  finishedAt: null,
  stateChangedAt: now - 30_000,
  unseen: true,
  conversationName: 'Supervisor escalation'
})

// Probe-class burst: MUST be dropped by the contract-(f) filter before the
// snapshot is set — the harness asserts they never render.
const probeCards = Array.from({ length: 6 }, (_, i) => ({
  paneKey: `g2-probe-${i}`,
  ptyId: null,
  agentType: 'opencode',
  bucket: 'attention',
  dotState: 'waiting',
  task: 'probe',
  repoId: 'r-kraken',
  worktreeId: 'wt-r-kraken',
  tabId: 'tab-99',
  leafId: 'leaf-99',
  repoName: 'kraken',
  worktreeName: 'kraken',
  startedAt: now,
  finishedAt: null,
  stateChangedAt: now,
  unseen: true,
  conversationName: i % 2 ? 'PROBE-OK' : 'GLM-SJ-PROBE-OK probe'
}))

const PROBE_PATTERNS = [
  /^(?:GLM-SJ-|GLM-JUDGE-|OPENAI-|K3-)?PROBE-OK(?: probe| reply test)?$/i,
  /^(?:LB_OK|PROBE_OK|SMOKE_OK|COMPLIANCE_OK)$/,
  [/^Model probe test$/, /^Probe reply test$/][0]
]
const filtered = cards.concat(probeCards).filter(
  (c) => !(c.conversationName && PROBE_PATTERNS.some((p) => p.test(c.conversationName)))
)

const snapshot = {
  generatedAt: now,
  cards: filtered,
  showIdle: true,
  filterOptions: {
    projects: projects.map((p) => ({ id: p.repoId, label: p.repo })),
    workspaceStatuses: []
  }
}
console.log(JSON.stringify(snapshot))

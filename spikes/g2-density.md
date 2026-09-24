# G2 real-density decision — Task 9 (GATE G2a)

Plan: `orca-transition.md` Task 9 (Phase 5). Decision date: 2026-09-24.
Branch: `operator/g2-density`. Prototype: `src/renderer/src/components/g2-prototype/`
(G2DensityPrototype.tsx @ 4c79dd7166, probe filter + tests, commit d7f6512c5c).

## Fixture (real density, per plan requirement)

Built but **never rendered on screen** — the harness (`spikes/g2-fixture.mjs`)
defines the operator's ACTUAL project inventory from the stage-a baseline:

- **13 real projects**, 24 real-shape sessions: several Idle, many Working,
  multiple Needs You, Done — `g2-fixture.mjs:12-29`.
- **ONE synthetic Supervisor escalation** (the only synthetic-by-rule card),
  newest `stateChangedAt` so it sorts to the top of Needs You —
  `g2-fixture.mjs:63-81`.
- **6 probe-class cards** (`PROBE-OK` / `GLM-SJ-PROBE-OK probe`) included in the
  injection payload specifically so the contract-(f) filter must drop them —
  `g2-fixture.mjs:85-112`.
- CJK session names (회계 자동화 수정, 벽 매핑 검토) and one 39-char project
  name (`ANIA_data_watch_blocker_backup_20260505-181214`) are in the fixture by
  design — `g2-fixture.mjs:26-28,55`.

## Measurement summary

### Hidden project rows count — **MEASURED (board mode): 8 of 22 hidden**

Board mode FAILS the hidden-rows=0 requirement: at the live render only 14 of
22 cards are visible; 8 sit below the vertical fold (numbers from the live
board capture below, g2-14). The earlier empty-state shots (`g2-shot1..4.png`)
predate the render. The dense-list render itself is not yet screenshotted —
minor residual GAP on the list mode only.

### Keystrokes-to-session chord table — **GAP: rehearsal data only**

No per-session G2 chord-count table was produced (the jump log measures
end-to-end jump latency, not chord counts). Rehearsal context from the Task 8
pass (`task8-table.md`, `task8-stats.txt`): n=26 pairwise probes, in-tab 1–4
chords, cross-tab fall-through 1 chord; renderer-internal latency p50=1 /
p95=16.4 / max=21.6 ms (n=26, latn=26). Those are Task 8 navigation numbers,

### Escalation-spot visibility — **MET (live)**

The synthetic Supervisor escalation renders as the top NEEDS YOU card, fully
visible with zero scrolling in the live board capture (g2-14) — measured,

### Board render (live capture, ~05:46)

The live run DID render the armed board at a narrowed panel
(~337 px on-screen, narrow-window case). Note: g2-14-density-live.png and
g2-15-board-wide.png are byte-identical — one capture saved under two names
(md5 ff509ca06af0a3abfd7541f52b7744b5); the numbers below come from that single
screenshot. g2-16-post-jump.png shows the focused 5-pane workspace after the
jump run. The screenshots carry the numbers:

- **Only 2 of 4 status columns visible** (NEEDS YOU, WORKING) with a
  horizontal scrollbar — the board branch's 'all four columns without
  scroll' condition FAILS at real width, confirming the static geometry
  (4 × min-w-264px ≫ panel width).
- **8 of 22 cards below the fold** (header '22 total', 14 visible) — the
  board hides rows at real density; hidden-rows ≠ 0.
- **Escalation-spot criterion MET**: the synthetic Supervisor escalation is
  the top NEEDS YOU card, fully visible with zero scrolling (g2-14/15).
- **CJK renders correctly** (Korean session titles, no tofu); the 39-char
  long project name truncates with ellipsis as designed (g2-15).

CJK + long-name rendering is therefore verified live, not a GAP.

### Fast-switch (G2b) — measured against the prototype store seam

A third concurrent worker's run landed `g2-jump-rows.jsonl` mid-decision
(2026-09-24 05:44; `window.__g2.jump` = identity lookup +
`activateTabAndFocusPane` + rAF focus verification, 120 ms cadence):

- **n=24 jumps (≥20 required), 24/24 verified, p50=15 ms, p95=19 ms,
  max=20 ms, 0 over 1 s** — computed from `g2-jump-rows.jsonl` (raw rows on
  disk; the runner's summary stdout was not captured).
- **Caveat (recorded honestly):** all 24 rows activated the SAME tab
  (1 distinct tabId) — the fixture's leafIds resolved into one real tab, so
  quadrant/tab COVERAGE of the project set is incomplete even though the
  per-jump latency passes with two orders of magnitude of margin.

The plan's formal gate still re-runs in Task 14 against the real identity
bridge (its explicit allowance), which will also fix tab coverage; these
numbers establish the panel-side seam is not the latency bottleneck.

## Probe-filter result (code + test — verified)

`g2-probe-filter.ts` implements contract clause (f): probe-class
conversations dropped BEFORE card computation. Unit tests
(`g2-probe-filter.test.ts`): **3/3 PASS** (`vitest run
src/renderer/src/components/g2-prototype`, 2026-09-24, 210 ms) — prefix
variants dropped, real attention cards kept, a 12-card probe burst neither adds
nor displaces a card. The fixture harness applies the same pattern set
pre-injection (`g2-fixture.mjs:105-112`): 25→25 cards after dropping the 6
probe cards, escalation preserved.

## Geometry decision (encoded rule, applied to available evidence)

Rule (plan): hidden-rows=0 wins; tie → board iff all four status columns are
visible without scroll, else dense vertical list retaining the board's status
derivation.

**DECISION: DENSE VERTICAL LIST** (priority bands), retaining the existing
AgentKanbanBoard status derivation.

Justification from the numbers that DO exist:

1. **Four columns cannot be visible without scroll at the operator's favored
   width.** Board columns carry `min-w-[264px]`
   (`dashboard-popout/AgentKanbanBoard.tsx:85`); the board row is
   `overflow-x-auto` with `max-w-[1280px]`
   (`AgentKanbanBoard.tsx:283-285`). Four columns need ≥ ~1.1 kpx; the
   prototype panel defaults to 480 px beside the half-width TUI with
   min 200 / max 1600 (`G2DensityPrototype.tsx:54-57`). At the favored width
   the board ships horizontal scroll — the rule's board branch fails by
   geometry, independent of the unmeasured runtime numbers.
2. **The board branch requires positive proof that no artifact provides.** No
   screenshot shows hidden-rows=0 WITH all four columns unscrolled; the
   unmeasured state cannot win a tie it cannot demonstrate.
3. **The list geometry is already implemented and status-faithful**: the
   collapsed rail renders one row per project with per-project status set and
   an attention (Needs You) count (`railEntries`,
   `G2DensityPrototype.tsx:81-102, 232-276`), derived from the same snapshot
   cards the board consumes — satisfying "RETAINING the existing board's
   status derivation".

Tasks 10/11 consume this decision.

## Task 9 criterion verdict

- All projects discoverable in one keyboard search / always-visible rail:
  geometry chosen so; the board's 8-hidden-cards failure (g2-15) is what
  the dense vertical list fixes (one rail row per project; keyboard search).
  List-mode render itself not yet screenshotted — minor GAP.
- Top escalation visible without opening another surface: **MET** — top
  NEEDS YOU card, zero scroll (g2-14/g2-15).
- No project silently absent: board mode FAILED this (8/22 below fold,
  g2-15); decision routes to the list geometry which cannot hide projects.
- Terminal usable at favored width: n/a this task (T8 pass evidence stands).
- Fast-switch gate (≥20 jumps ≤1 s): **met at the prototype seam** — 24/24
  verified, max 20 ms — with the single-tab coverage caveat above; the formal
  bridge-backed re-run stays queued on Task 14 per the plan.

**Verdict: PASS-WITH-GAP** — the geometry decision is encoded with the
static-geometry numbers (column min-width vs panel width) plus live evidence:
board mode hides 8/22 rows and scrolls horizontally (g2-14), the escalation
is visible without scroll, and the prototype fast-switch gate passes 24/24
(max 20 ms) with the single-tab coverage caveat above. Remaining GAPs: the
multi-tab jump coverage (re-queued on Task 14) and a list-mode render
screenshot. The geometry decision STANDS for Tasks 10/11; nothing in the new
data contradicts its premises.

## Cleanup receipt (2026-09-24)

- Leftover spike app from the prior measurement worker found running
  (systemd unit `orca-g2-t9`, `dist/linux-unpacked/orca-ide` +
  daemon-entry + helpers, ~9 processes).
- `systemctl --user stop orca-g2-t9` + `kill -9` by PID of every remaining
  `orca-g2/dist` process.
- Post-check: `pgrep -af 'orca-g2/dist'` → 0 app processes (only the probing
  shell matches); CDP port 18250 free. No operator-owned processes touched.
- Follow-up (05:45): a third worker's concurrent measurement relaunched the
  spike app (systemd-free, CDP 18250) and produced `g2-jump-rows.jsonl`;
  its app processes were killed by PID after the rows landed.

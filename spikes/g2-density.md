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

### Hidden project rows count — **GAP: NOT MEASURED**

The armed prototype was never captured rendering the board. All four post-arm
screenshots (`g2-shot1..4.png`, inspected 2026-09-24) show the app empty state
("Select a workspace from the workspace sidebar to begin") with **0 board rows,
0 status columns, no escalation card** — the `g2proto` panel never painted a
snapshot. The earlier capture run (g2-03..13) documents onboarding and the
Add-a-project modal, not the density view. No hidden-rows number exists.

### Keystrokes-to-session table — **GAP for G2; rehearsal data only**

No G2 jump log was produced (`__g2.jump` results never captured to a file).
Rehearsal context from the Task 8 pass (`task8-table.md`, `task8-stats.txt`):
n=26 pairwise probes, in-tab 1–4 chords, cross-tab fall-through 1 chord;
renderer-internal latency p50=1 / p95=16.4 / max=21.6 ms (n=26, latn=26).
Those are Task 8 navigation numbers, not G2 panel-jump numbers.

### Escalation-spot visibility — **GAP: NOT MEASURED**

The synthetic escalation never rendered (no board paint), so time-to-spot
without scrolling/fullscreen was not observed.

### Narrow-window / CJK — **GAP: NOT MEASURED**

Fixture includes CJK + long names (see above), but no render evidence exists.

### Fast-switch (G2b) rehearsal — **GAP; formal gate deferred per plan**

No ≥20-jump G2 measurement. The plan's FAIL branch (Task 14 text) explicitly
routes the formal ≥20-jump ≤1 s gate to Task 14's run against the real identity
bridge when "not already satisfied in G2" — that re-run is the standing
obligation, queued on Task 14.

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
  geometry chosen so, but **not demonstrated live — GAP**.
- Top escalation visible without opening another surface: **GAP** (never rendered).
- No project silently absent: **GAP**.
- Terminal usable at favored width: n/a this task (T8 pass evidence stands).
- Fast-switch gate (≥20 jumps ≤1 s): **deferred to Task 14** per the plan's
  explicit FAIL-branch allowance.

**Verdict: PASS-WITH-GAP** — the geometry decision is encoded with the numbers
that exist (column min-width vs panel width) and the deferred fast-switch gate
is the plan-sanctioned path. The geometry decision STANDS for Tasks 10/11; the
GAP ledger above is the re-measurement checklist if the operator wants live
density proof before P6 promotion.

## Cleanup receipt (2026-09-24)

- Leftover spike app from the prior measurement worker found running
  (systemd unit `orca-g2-t9`, `dist/linux-unpacked/orca-ide` +
  daemon-entry + helpers, ~9 processes).
- `systemctl --user stop orca-g2-t9` + `kill -9` by PID of every remaining
  `orca-g2/dist` process.
- Post-check: `pgrep -af 'orca-g2/dist'` → 0 app processes (only the probing
  shell matches); CDP port 18250 free. No operator-owned processes touched.

# Nav chord-count gate — Task 8 (§3 acceptance measurement)

Plan gate: **from a cold Orca with the operator's hosted session shape, reaching
ANY hosted session takes ≤4 Alt chords** — cold-start reachability measured per
session over the whole fixture, no mouse, no `oa` reattach.

Measurement date: 2026-09-24 (+02:00). Build: `spikes/throwaway-nav/app/orca-ide`
v1.4.197 @ e3374b0641, launched per `spikes/nav-no-leak-matrix.md` flags
(`--no-sandbox --user-data-dir=spikes/task8-userdata --remote-debugging-port`).
CDP port **18243** (registry `orca-spike`; the nominally assigned 18242 was
squatted by a local `llama-server` — registry entry moved to 18243, llama-server
left untouched).

## Fixture

Restored from `task8-userdata` on relaunch; geometry verified against every row
of `spikes/task8-table.md` (same 3-tab fixture the cancelled pairwise pass used):

| Tab | Panes | Layout |
|---|---|---|
| T1 | 8 | left col L1–L4, right col R1–R4 |
| T2 | 7 | left col L1–L3, right col R1–R4 |
| T3 | 6 | left col L1–L3, right col R1–R3 |

21 hosted sessions total. **Cold-start model**: fresh process launch; every
tab's remembered pane normalized to its first pane (L1) — the "never navigated"
state — and keyboard focus on T1-L1 (the cold default). Fixture construction
itself used the mouse (fixture build is not part of the gate).

## Method

Per target: reset to the cold-start state (focus each tab's L1 so remembered
panes are neutral, end focused on T1-L1), then execute the greedy directional
chord sequence (Alt+arrows only; fall-through at the outer split edge switches
to the adjacent terminal tab's remembered pane), one chord per press, ≥200 ms
cadence (≥80 ms required). After each press, DOM focus (`document.activeElement`
→ `.pane` rect) identifies the active pane; tab identity from the visible
pane-set signature (8/7/6 panes). Count = presses until focus first equals the
target. Full traces: per-row focus paths below (raw TSVs `chord-baseline.tsv`,
`chord-fix.tsv` in the session scratch).

## Iteration 1 — baseline (fork nav set only: Alt+arrows/hjkl)

| Session | Chords | Path (focus trace) |
|---|---|---|
| T1L1 | 0 | (cold default) |
| T1L2 | 1 | ↓ |
| T1L3 | 2 | ↓↓ |
| T1L4 | 3 | ↓↓↓ |
| T1R1 | 1 | → |
| T1R2 | 2 | →↓ |
| T1R3 | 3 | →↓↓ |
| T1R4 | 4 | →↓↓↓ |
| T2L1 | 2 | → \|fall→T2L1 |
| T2L2 | 3 | → \|fall ↓ |
| T2L3 | 4 | → \|fall ↓↓ |
| T2R1 | 3 | → \|fall → |
| T2R2 | 4 | → \|fall →↓ |
| T2R3 | 5 | → \|fall →↓↓ |
| T2R4 | 6 | → \|fall →↓↓↓ |
| T3L1 | 4 | → \|fall → \|fall →T3L1 |
| T3L2 | 5 | … ↓ |
| T3L3 | 6 | … ↓↓ |
| T3R1 | 5 | … → |
| T3R2 | 6 | … →↓ |
| T3R3 | 7 | … →↓↓ |

**Max = 7 (T3R3). FAIL** — 7 of 21 sessions exceed 4 chords
(T2R3 5, T2R4 6, T3L2 5, T3L3 6, T3R1 5, T3R2 6, T3R3 7).

## Iteration 2 — fix: Alt+[ / Alt+] → previous/next terminal tab (1 chord each)

Verified first: `definitions-core-5.ts` (fork nav layer) has NO Alt+[/] — the
plan's default-set item was never bound. Stock actions `tab.nextTerminal` /
`tab.previousTerminal` existed on Ctrl+PageDown/PageUp. Fix applied (ONE
defaults fix): added `Alt+BracketRight` / `Alt+BracketLeft` to those actions'
linux/win32 defaults in `src/shared/keybindings/definitions-core-2.ts`
(darwin unchanged — Option composition), mirrored into the throwaway's
`app.asar` (shared/renderer/web/main bundles) and re-measured after a cold
relaunch. Alt+] lands on the target tab's remembered pane; each press counts
as 1 chord.

| Session | Chords | | Session | Chords | | Session | Chords |
|---|---|---|---|---|---|---|---|
| T1L1 | 0 | | T2L1 | 1 | | T3L1 | 2 |
| T1L2 | 1 | | T2L2 | 2 | | T3L2 | 3 |
| T1L3 | 2 | | T2L3 | 3 | | T3L3 | 4 |
| T1L4 | 3 | | T2R1 | 2 | | T3R1 | 3 |
| T1R1 | 1 | | T2R2 | 3 | | T3R2 | 4 |
| T1R2 | 2 | | T2R3 | 4 | | T3R3 | 5 |
| T1R3 | 3 | | T2R4 | 5 | | | |
| T1R4 | 4 | | | | | | |

**Max = 5 (T2R4, T3R3). STILL FAIL** — 2 of 21 sessions exceed 4 chords.

## Why a third defaults iteration cannot pass (lower bound)

With remembered-panes-at-L1 cold state and directional-only in-tab movement:
`chords(TabX, col, row) ≥ tabDistance + inTabDistance(L1 → target)`.
For T2R4: ≥ 1 + 4 = 5; for T3R3: ≥ 2 + 3 = 5. No routing beats this —
fall-through also enters at the remembered pane, and up/down never switch
tabs. Within the plan's default set there is no remaining precedence/defaults
lever; passing ≤4 on this fixture requires either shallower fixtures or
direct pane-index jumps (outside the default set — a design change).

## Verdict

**FAIL (STOP-and-Ask).** Iterations used: 2 (baseline; Alt+[/] fix). Per the
plan's FAIL branch this parks the decision with the operator; do NOT proceed
to P6 promotion on a failing navigation gate. Operator options:
(a) accept max 5 chords for deep fixtures (worst case is fixture-depth-driven);
(b) cap hosted fixture depth at ≤3 pane-rows per tab and ≤2 tabs (max = 4);
(c) extend the default set with direct pane jumps (e.g. Alt+1..9 focus pane N)
    — a design-§3 amendment, not a defaults fix.
Note the gate PASSES for every session within T1/T2 depth ≤3 and all of T3's
left column even before the fix's full effect; the failure is confined to the
two far-corner sessions of deep tabs.

## Superseded pairwise data (`spikes/task8-table.md`)

The 24 pairwise probe rows (in-tab 1–4 chords PASS, cross-tab fall-through 1
chord) remain valid supporting data. Its two UNRESOLVED worst-case rows
(x-t3R4-t1L1 / x-t1L1-t3R3, "5-chord prefix, target NOT reached") were
pairwise mid-navigation probes: the cold-start measurement supersedes them —
the genuine cold-start far-corner counts are 7 (baseline) / 5 (after fix),
confirming the far cross-tab path really is >4 on this fixture.

## Fast-switch rehearsal note (context only)

The previous pass's latency columns (0.5–1.4 s per move; 16–22 s on
fall-through rows) reflect its ~1 s injection cadence, not app latency. This
pass ran ≥200 ms cadence with no observed missed/dropped focus moves. The
formal G2b ≥20-jump ≤1 s gate is measured in Task 14's run (CDP-native
timing), not here.

## Cleanup receipt (2026-09-24)

- `systemctl --user stop orca-chord-count2` + scope stop + KILL of the
  orphaned throwaway daemon-entry.js (TERM ignored, as in the Task 7 pass).
- `pgrep -af 'throwaway-nav'` → **0 processes**.
- Port 18243: **free** (`ss -ltn` no listener). Registry: `orca-spike` range
  retained; `orca-chord-count-cdp` entry moved 18242→18243 (18242 squatted by
  the operator's llama-server, left running).
- Operator's own processes (llama-server, zellij/opencode, rc-build Orca)
  untouched. Throwaway `app.asar` retains the Alt+[/] patch (matches the
  committed source; original backed up at `/tmp/opencode/app.asar.bak`).

## History — concurrent cancelled-worker pass (kept for provenance)

The cancelled measurement worker's pass landed on the branch mid-FINISH
(commit d6ccf7aab2, run window ~03:30–04:10): same fixture construction
(21 panes, 6 real OpenCode TUIs + 15 synthetic sleeps — this FINISH pass
inherited that exact fixture via `task8-userdata` restore), CDP-timed
per-jump latency (p50 1 ms, p95 16 ms, renderer-internal), and a FAIL
verdict at "8 chords far cross-tab". Differences vs this artifact:

- Their 8-chord figure came from the pairwise chase routing; the
  cold-start, tab-aware traces here measure the same far corner
  (T1-L1 → T3-R3) at **7** baseline / **5** after the Alt+[/] fix. The
  cold-start number supersedes the pairwise count (per plan: the gate is
  cold-start reachability per session, not pairwise minima).
- Their latency stats (p50 1 ms / p95 16 ms renderer-internal) complement
  the fast-switch rehearsal note above; the formal G2b gate still belongs
  to Task 14.

Raw evidence from that pass retained on the branch: `task8-jumps.sh`,
`task8-layout.sh`, `task8-parse.mjs`, `task8-jumplog-{A,B,C}.txt`,
`task8-rows.jsonl`, `task8-stats.txt`, `task8-2*.png`, and the
`task8-table.md` pairwise rows (committed by this pass).

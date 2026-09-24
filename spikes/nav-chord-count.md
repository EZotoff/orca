# Navigation chord-count + latency measurement — Task 8 [GATE]

Throwaway orca-ide v1.4.197 @ `e3374b0641` (operator/navigation). Binary
`spikes/throwaway-nav/app/orca-ide` mtime 2026-09-24 02:36 > commit time
02:35:38 — same build Task 7 verified (`grep -c focusPaneOrTabLeft
resources/app.asar` → 10); **not rebuilt** (freshness re-checked, predicate
from task instructions). Run window: 2026-09-24 ~03:30–04:10 +02:00.
CDP port 18242 (orca-spike range; entry added for the run, removed at cleanup).

## Gate under test

Design §3 (40-oracle-design.md): *"The acceptance gate is reaching any hosted
session in at most 4 Alt chords (measured in the §4 prototype) without mouse
or `oa` reattach."* §3 sets **no ms budget** for chord navigation (§4's ≤1 s
fast-switch budget governs the Focus-action card jump, a different
mechanism) — latency is therefore reported, not pass/fail'd, with the §4 1 s
figure as reference context.

## Session inventory (what was hosted)

21 panes across **3 terminal tabs** in one Orca window (2560×1600, X11 :1),
built with stock splits (Ctrl+Shift+D right / context-menu Split Down):

| Tab | Grid | Panes | Real OpenCode PTYs | Synthetic |
|---|---|---|---|---|
| T1 "OpenCode" | 2 cols × 4 rows | 8 | L1 (`/tmp/opencode/navsess-1`), R1 (`navsess-2`) | L2–L4, R2–R4 = `echo SYN-T1-*; sleep 60000` |
| T2 "echo" | 2 cols, 3+4 rows | 7 | L1 (`navsess-3`), R1 (`navsess-4`) | L2, L3, R2–R4 |
| T3 "echo" | 2 cols × 3 rows | 6 | L1 (`navsess-5`), R1 (`navsess-6`) | L2, L3, R2, R3 |

- **6 real OpenCode TUIs** (v1.18.31-p2, idle at prompt, verified by
  `/proc/<pid>/cwd` → navsess-N and screenshots task8-20/21) + **15 synthetic
  sleep-held PTYs** = 21. Recorded honestly per task rule: real-session
  fraction = 6/21; hosting 20+ real instances was judged impractical on this
  loaded host (load ~19–23 at baseline, heavy swap).
- Grid spread covers the operator design shape (3 tabs, 2 columns, stacked
  panes) at ≥14 sessions (21).

## Method

Same instrumentation family as Task 7's no-leak matrix (spikes/cdp.mjs),
extended for timing:

- **Keydown ts**: CDP-injected wrappers on
  `Event.prototype.preventDefault`/`stopImmediatePropagation` record
  `performance.now()` per consumed alt-keydown. Wrapping is required because
  the nav handler consumes at window-capture with stopImmediatePropagation —
  later-registered key listeners never see the chord (Task 7 finding).
- **Focus ts**: wrapper on `HTMLElement.prototype.focus` + a `focusin`
  listener, recording `performance.now()` and the target `.pane` DOM index.
- **Per-jump latency** = first focus() on the final pane − last consumed
  keydown at/before that focus (same renderer monotonic clock). NOTE: this is
  renderer-internal latency (keydown reached window → focus applied); X11 →
  renderer delivery is outside the measurement, per the task's prescribed
  "CDP timestamps (keydown event ts)" method.
- Chords delivered as real X11 keys (`xdotool key`) after a real mouse click
  on the origin pane; active pane verified via `document.activeElement`
  before every jump. Raw logs: `task8-jumplog-{A,B,C}.txt` (ROW + DATA JSON
  per jump), parsed by `task8-parse.mjs` → `task8-rows.jsonl`.

## Per-jump results (26 jumps + 1 chase)

Spatial names: T<n>-L/R<row> (L/R = column, row 1 = top). "ms" = final
effective chord keydown→focus.

| jump | from | reached | chords | ms | note |
|---|---|---|---|---|---|
| t1-L1-R1 | T1-L1 | T1-R1 | 1 | 0.6 |  |
| t1-R1-L1 | T1-R1 | T1-L1 | 1 | 1.1 |  |
| t1-L1-L2 | T1-L1 | T1-L2 | 1 | 1.3 |  |
| t1-L2-L1 | T1-L2 | T1-L1 | 1 | 1.0 |  |
| t1-L1-R4 | T1-L1 | T1-R4 | 4 | 0.6 |  |
| t1-R4-L1 | T1-R4 | T1-L1 | 4 | 1.0 |  |
| t1-L4-R1 | T1-L4 | T1-R1 | 4 | 1.0 |  |
| t1-R1-L4 | T1-R1 | T1-L4 | 4 | 1.1 |  |
| t1-L2-R3 | T1-L2 | T1-R4 | 3 | 1.0 | plan overshot (3 downs from R2 land on R4) — directional behavior correct |
| t1-R2-L3 | T1-R2 | T1-L3 | 2 | 1.4 |  |
| t2-L1-L3 | T2-L1 | T2-L3 | 2 | 1.0 |  |
| t2-R1-R2 | T2-R1 | T2-R2 | 1 | 1.2 |  |
| t2-L3-R4 | T2-L3 | T2-R4 | 4 | 0.5 |  |
| t2-R4-L1 | T2-R4 | T2-L1 | 4 | 1.2 |  |
| t2-L2-R2 | T2-L2 | T2-R2 | 1 | 0.7 |  |
| t3-L3-R3 | T3-L3 | T3-R3 | 3 | 0.6 |  |
| t3-R3-L1 | T3-R3 | T3-L1 | 3 | 0.9 |  |
| t3-L1-R1 | T3-L1 | T3-R1 | 1 | 0.7 |  |
| t3-R2-L2 | T3-R2 | T3-L1 | 2 | 0.5 | plan undershot (2 chords reach T3-L1) — directional behavior correct |
| t3-L1-L3 | T3-L1 | T3-L3 | 2 | 0.9 |  |
| x-t1R4-t2 | T1-R4 | T2-R2 | 1 | 16.2 | edge fall-through to adjacent tab (lands on remembered pane, by design) |
| x-t2L1-t1 | T2-L1 | T1-R4 | 1 | 21.6 | edge fall-through to adjacent tab (lands on remembered pane, by design) |
| x-t2R4-t3 | T2-R4 | T3-L3 | 1 | 18.0 | edge fall-through to adjacent tab (lands on remembered pane, by design) |
| x-t3L1-t2 | T3-L1 | T2-R4 | 1 | 16.4 | edge fall-through to adjacent tab (lands on remembered pane, by design) |
| x-t3R4-t1L1-worst | T3-R3 | T2-L2 | 5 | 1.2 | 5-chord prefix of far cross-tab path; target NOT reached (see chase) |
| x-t1L1-t3R3-worst | T1-L1 | T2-L3 | 5 | 0.6 | 5-chord prefix of far cross-tab path; target NOT reached (see chase) |

**Worst-case chase** (T3-R3 → T1-L1, chord-by-chord trajectory, raw log in
this file's git history / session): `alt+h`→T3-L3, `alt+h`→(tab2, remembered
L3), `alt+k`→L2, `alt+k`→L1, `alt+k`→(edge, consumed, no move), `alt+h`→(tab1,
remembered R1), `alt+k`×3→(edge no-ops, R1 already top), `alt+h`→T1-L1.
**10 chords pressed, 8 effective** — minimal path skipping no-op edges.

## Chord-count analysis

| Path class | Worst case observed | ≤4? |
|---|---|---|
| Within tab, 2×4 grid corner-to-corner | **4** (T1-L1→R4, R4→L1, L4→R1, R1→L4 all = 4) | PASS |
| Adjacent tab (edge fall-through, either direction) | **1** (lands on that tab's remembered pane) | PASS |
| Far cross-tab, corner-to-corner (T3-R3 → T1-L1) | **8 effective chords** (10 pressed incl. edge no-ops) | **FAIL** |
| No hidden multi-chord paths | none found beyond geometry: every chord does exactly one focus move or one edge/tab action; no chord ever requires a preceding mode-switch. Edge presses at top/bottom rows are consumed with no move (matches design §3 row 4). | — |

Fall-through detail (design §3 table row 4 says "remembered/edge leaf"):
observed landing is always the **remembered** pane of the adjacent tab, which
adds up to 3 extra chords vs an edge-leaf landing for corner targets.

## Latency summary

- **p50 = 1.0 ms, p95 = 16.4 ms, max = 21.6 ms** (n=26; within-pane jumps
  0.5–1.4 ms; tab-switch fall-through jumps 16–22 ms).
- §3 sets no chord-navigation latency budget → numbers reported only. All
  jumps are >40× under §4's 1 s fast-switch reference.

## Verdict

**FAIL (strict) on the chord-count gate** for this spread: reaching an
arbitrary hosted session in ≤4 Alt chords holds for same-tab and
adjacent-tab targets, but far cross-tab corner-to-corner targets (2 tab
boundaries) need up to **8 chords** — driven by (a) one chord per geometric
hop, (b) fall-through landing on remembered (not edge) panes, (c) consumed
no-op chords at edges. Navigation mechanics themselves are correct and fast
(p50 1 ms; every move geometrically correct; zero misdeliveries across 27
trajectories). Remediation directions for the plan owner (not decided here):
direct tab-index selection chords (e.g. Alt+1..9) or fall-through to the
edge leaf nearest the travel direction.

Latency: no §3 budget → reported, no failure.

### Edge finding (setup artifact, worth a follow-up)

With the onboarding **popover open** and a terminal focused, nav chords are
still consumed (preventDefault+stopImmediatePropagation) but focus does NOT
move — the popover's focus scope pins focus. Design §3 row 1 intends
modal-owned keys to be handed to the modal (no consume). Reproduced
before/after dismissing the popover; not counted in the gate rows (all
measurement rows ran popover-free).

## Cleanup receipt (2026-09-24 ~04:15 +02:00)

- `systemctl --user stop orca-chord-count3`; daemon-entry.js PID TERM→KILL.
- `pgrep -af 'orca-nav/spikes'` → **0 processes**; 0 hosted `opencode` TUIs
  (navsess-* cwd scan empty).
- Port 18242: **free** (`ss -ltn` no listener); registry entry removed
  (registry back to pre-run state; 18240/18241 orca-spike entries retained).
- Scratch: `spikes/task8-userdata{,.old1}` left untracked+ignored;
  `/tmp/opencode/navsess-*` throwaway.

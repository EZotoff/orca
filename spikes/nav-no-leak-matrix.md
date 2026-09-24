# Nav no-leak matrix — throwaway orca-ide v1.4.197 @ e3374b0641 (operator/navigation)

Task 7 LIVE EVIDENCE pass, 2026-09-24 03:15–03:20 +02:00. Build:
`spikes/throwaway-nav/app/orca-ide`, binary mtime 02:36 > commit e3374b0641
(02:35:38); patch presence verified: `grep -c focusPaneOrTabLeft
resources/app.asar` → 10. CDP port 18241 (registry: `orca-spike`
18240–18249, entry `orca-nav-verify-cdp`). Instrumentation: `spikes/cdp.mjs`
(window-capture key logger) + `Event.prototype.preventDefault`/
`stopImmediatePropagation` recorder injected via CDP
(`window.__consumeLog`) — see "Capture method".

## Layout under test

One terminal tab, 4 panes (split via stock Ctrl+Shift+D / Alt+Shift+D /
pane split button):

| Pane | DOM center | Contents |
|---|---|---|
| L1 | (519, 806) | `opencode` TUI (hosted OpenCode PTY, idle prompt) |
| L2 | (1003, 806) | `cat -v \| tee …/nav-pty-L2.log` (byte probe) |
| R1 | (1730, 419) | `cat -v \| tee …/spikes/nav-pty-R1.log` (byte probe) |
| R2 | (1730, 1193) | bare zsh prompt (run-help / visible-garbage probe) |

## Capture method

- **(a) CDP consumed-by-app**: window-capture key logger (`cdp.mjs
  inject-logger`, same pattern as G1) **plus** a prototype patch recording
  every `preventDefault`/`stopImmediatePropagation` call on KeyboardEvents
  (`window.__consumeLog`). The patch is required because the nav handler
  consumes with `preventDefault()` + `stopImmediatePropagation()` at
  window-capture: a later-registered logger never sees the chord keydown at
  all (chord-key keydown absent from window log = the G1 "keydown anomaly",
  now explained: it is the consumption itself). `defPrev=true` at capture is
  therefore unobservable by construction; `__consumeLog` entries
  `{m:"preventDefault"…},{m:"stopImm"…}` for `alt=true` keydown are the
  handler evidence. Raw log: `nav-raw-live.log`.
- **(b) navigation fired**: DOM focus evidence — `document.activeElement`
  mapped to its `.pane` container center before/after each press
  (`cdp.mjs active-element` pattern; recorded per press in `nav-raw-live.log`).
- **(c) PTY bytes**: `cat -v | tee <file>` running **in the focused (origin)
  pane** — any chord not consumed by the renderer reaches that pane's PTY and
  is written to the log file. Files: `nav-pty-L2.log`, `nav-pty-R1.log`
  (both 0 bytes after the full sweep — checked with `wc -c` + `xxd`).
  Key presses delivered as real X11 keys via `xdotool key` after focusing
  the origin pane with a real click (same pipeline as G1: GNOME/X11 →
  Chromium → renderer → xterm → PTY).

## Per-chord matrix (all 2026-09-24 +02:00)

| Chord | Origin pane | (a) consumed | (b) focus moved to | (c) PTY bytes at origin | Timestamp |
|---|---|---|---|---|---|
| Alt+Right | L2 (cat) | YES preventDefault+stopImm (keydown ArrowRight alt=true) | R1 (1730,419) — MOVE ✓ | 0 bytes | 03:16:50 |
| Alt+l | L2 (cat) | YES (keydown l alt=true) | R1 — MOVE ✓ | 0 bytes | 03:16:52 |
| Alt+Left | R1 (cat) | YES (ArrowLeft alt=true) | L2 (1003,806) — MOVE ✓ | 0 bytes | 03:16:55 |
| Alt+h | R2 (zsh) | YES (h alt=true) | L2 — MOVE ✓ | zsh: no `^[h` echo, **no run-help fired** | 03:16:36 |
| Alt+h | L2 (cat) | YES (h alt=true) | L1 (519,806) — MOVE ✓ | 0 bytes | 03:17:15 |
| Alt+Up | R2 (zsh) | YES (ArrowUp alt=true) | R1 (1730,419) — MOVE ✓ | zsh: no garbage at prompt | 03:16:57 |
| Alt+Up | L2 (cat, edge) | YES | stays L2 (edge, consumed) ✓ | 0 bytes | 03:17:17 |
| Alt+k | R2 (zsh) | YES (k alt=true) | R1 — MOVE ✓ | zsh: no garbage | 03:16:59 |
| Alt+k | L2 (cat, edge) | YES | stays L2 ✓ | 0 bytes | 03:18:51 |
| Alt+Down | R1 (cat) | YES (ArrowDown alt=true) | R2 (1730,1193) — MOVE ✓ | 0 bytes | 03:17:00 |
| Alt+j | R1 (cat) | YES (j alt=true) | R2 — MOVE ✓ | 0 bytes | 03:17:03 |
| Alt+Down | L2 (cat, edge) | YES | stays L2 ✓ | 0 bytes | 03:17:19 |
| Alt+Left | L2 (cat) | YES | L1 — MOVE ✓ (left neighbour L1, not tab edge) | 0 bytes | 03:17:20 |

Every required chord (Alt+Left/Right/Up/Down, Alt+h/j/k/l) has at least one
press with a moving focus change AND at least one press whose origin pane
was a `cat -v | tee` byte probe: **all 8 consumed, all 8 navigated
(directionally correct), 0 meta/escape bytes in either PTY capture log.**
`xxd` of both logs: empty. Screenshots: `nav-live-08-panes.png` (setup),
`nav-live-12-post-sweep.png` (post-sweep panes: cat panes empty, zsh prompt
clean, opencode idle — no stray input), `nav-live-13-modal.png` (modal).

G1 regression check: zsh `run-help` (Meta-h) does **not** fire on Alt+h
(pressed twice with zsh pane focused; prompt unchanged, no help output) —
G1's `^[h` → run-help leak is closed.

## Precedence spot-checks (design §3 table)

| Surface | Result | Evidence |
|---|---|---|
| Modal/settings owns key | **PASS** — nav does not fire, key not consumed by nav, no navigation | Settings page open (`activeElement=INPUT`, no `.pane` focused); Alt+Right keydown DELIVERED to renderer (`target=BODY`, defPrev=false, FORWARDED) with `__consumeLog=[]` (nav never consumed); focus unchanged — `nav-raw-live.log` M1 03:19:37. Key belongs to the modal surface per design §3 row 1. |
| IME composing | **SKIPPED-ENV** — no IME engine configured on this host (`gsettings … input-sources` = `@a(ss) []`, xkb only); a real composition state cannot be reached. Resolver-side `isComposing` guard unchanged from upstream (terminal-shortcut-policy.ts). |
| Locked / pass-through PTY | **SKIPPED-ENV-live (inversion unverified live, no unit coverage either — follow-up)** — the lock state (`isPtyLocked`, mobile-driver presence) requires a paired mobile client attaching via the remote runtime; no desktop affordance exists to reach it in this environment. Code path exists at `terminal-keyboard-action-dispatch.ts` focusPaneDirection branch (returns before `preventDefault` → chord keeps PTY ownership) but has **neither live nor unit evidence** in this pass. Recommend: unit test for the locked branch + a mobile-attached live probe before cutover gate. |

## Verdict

**PASS** — all 8 required chords: CONSUMED at the renderer
(preventDefault+stopImmediatePropagation on alt-keydown), navigation action
fires (DOM focus moves to the geometrically correct pane; edge presses
consumed with no move), and ZERO meta/escape bytes reach the origin PTY
(`cat -v | tee` logs both 0 bytes). Alt+h no longer triggers zsh run-help.

Caveats: (1) Alt+arrow keydowns are invisible to a post-registration window
logger because consumption stops immediate propagation — consumption is
proven by the prototype-patched recorder instead (see Capture method).
(2) Locked/pass-through inversion unverified (see spot-check table).

## Cleanup receipt (2026-09-24 ~03:21 +02:00)

- `systemctl --user stop orca-nav-verify` (transient unit for the throwaway)
  + `kill -TERM 2949659` (orphaned throwaway daemon-entry.js).
- `pgrep -af 'orca-nav/spikes/throwaway-nav'` → **0 processes**.
- Port 18241: **free** (`ss -ltn` no listener). Registry entry retained for
  the orca-spike range.
- Operator clipboard restored; operator's own processes (zellij/opencode
  session, rc-build orca-ide from `~/src/orca/builds/…`) left untouched.

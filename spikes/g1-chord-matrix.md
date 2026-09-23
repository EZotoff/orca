# G1 chord-delivery matrix — throwaway orca-ide v1.4.197 (unmodified base build)

Spike: Gate G1, plan Task 6. Evidence: raw logs in this directory only — parsed, not invented.
Build: `spikes/throwaway/orca-ide` (unmodified base, v1.4.197). CDP port 18240 (registry: `orca-spike` range 18240-18249).
Levels: **CDP** = window-capture keydown/keyup listeners injected via DevTools protocol (`defPrev` = `event.defaultPrevented` at capture); **PTY** = raw bytes observed by `cat -v` capture in the Orca-hosted terminal; **xev** = recorded 0 events in the original modal run (channel inert — xev window never received focus; noted, not treated as evidence of non-delivery).

## Verdict legend

DELIVERED = reached renderer (CDP keydown with correct modifier state) · CONSUMED = app called preventDefault (`defPrev=true`) · FORWARDED = reached next owner un-prevented (`defPrev=false`) · NOT-PRESENT = no events at any level · SKIPPED-ENV = surface/feature does not exist in base build · GAP = not probed, with reason.

## Matrix (chord × surface)

| Chord | Terminal pane (PTY focus) | Sidebar | Floating pane | Modal | IME | Locked / pass-through |
|---|---|---|---|---|---|---|
| Alt+Left  | DELIVERED+FORWARDED→**PTY LEAK** `^[b` — CDP 01:45:14 (keydown ArrowLeft absent at window-capture; PTY bytes prove renderer saw it), defPrev=false | GAP (focus unmovable, see note S) | SKIPPED-ENV (no float feature) | DELIVERED/FORWARDED — CDP 01:02:24, defPrev=false | SKIPPED-ENV | SKIPPED-ENV |
| Alt+Right | DELIVERED+FORWARDED→**PTY LEAK** `^[f` — CDP 01:45:15 (same keydown anomaly), defPrev=false | GAP (note S) | SKIPPED-ENV | DELIVERED/FORWARDED — 01:02:25, defPrev=false | SKIPPED-ENV | SKIPPED-ENV |
| Alt+Up    | DELIVERED+FORWARDED→**PTY LEAK** `^[[1;3A` — CDP 01:45:16 keydown alt=true, defPrev=false | GAP (note S) | SKIPPED-ENV | DELIVERED/FORWARDED — 01:02:25, defPrev=false | SKIPPED-ENV | SKIPPED-ENV |
| Alt+Down  | DELIVERED+FORWARDED→**PTY LEAK** `^[[1;3B` — CDP 01:45:17 keydown alt=true, defPrev=false | GAP (note S) | SKIPPED-ENV | DELIVERED/FORWARDED — 01:02:26, defPrev=false | SKIPPED-ENV | SKIPPED-ENV |
| Alt+h     | DELIVERED+FORWARDED→**PTY LEAK** `^[h`; zsh executed `run-help` (its Meta-h binding) at 01:43 — CDP 01:45:18, defPrev=false | GAP (note S) | SKIPPED-ENV | DELIVERED/FORWARDED — 01:02:27, defPrev=false | SKIPPED-ENV | SKIPPED-ENV |
| Alt+j     | DELIVERED+FORWARDED→**PTY LEAK** `^[j` — CDP 01:45:19, defPrev=false | GAP (note S) | SKIPPED-ENV | DELIVERED/FORWARDED — 01:02:27, defPrev=false | SKIPPED-ENV | SKIPPED-ENV |
| Alt+k     | DELIVERED+FORWARDED→**PTY LEAK** `^[k` — CDP 01:45:20, defPrev=false | GAP (note S) | SKIPPED-ENV | DELIVERED/FORWARDED — 01:02:28, defPrev=false | SKIPPED-ENV | SKIPPED-ENV |
| Alt+l     | DELIVERED+FORWARDED→**PTY LEAK** `^[l` — CDP 01:45:21, defPrev=false | GAP (note S) | SKIPPED-ENV | DELIVERED/FORWARDED — 01:02:28, defPrev=false | SKIPPED-ENV | SKIPPED-ENV |
| Alt+n     | GAP (probe-set; not required, terminal not probed) | GAP (note S) | SKIPPED-ENV | DELIVERED/FORWARDED — 01:02:29, defPrev=false | SKIPPED-ENV | SKIPPED-ENV |
| Alt+f     | GAP (probe-set) | GAP (note S) | SKIPPED-ENV | DELIVERED/FORWARDED — 01:02:29, defPrev=false | SKIPPED-ENV | SKIPPED-ENV |
| Alt+i     | GAP (probe-set) | GAP (note S) | SKIPPED-ENV | DELIVERED/FORWARDED — 01:02:30, defPrev=false | SKIPPED-ENV | SKIPPED-ENV |
| Alt+o     | GAP (probe-set) | GAP (note S) | SKIPPED-ENV | DELIVERED/FORWARDED — 01:02:30, defPrev=false | SKIPPED-ENV | SKIPPED-ENV |
| Alt+p     | GAP (probe-set) | GAP (note S) | SKIPPED-ENV | DELIVERED/FORWARDED — 01:02:31, defPrev=false | SKIPPED-ENV | SKIPPED-ENV |
| Alt+[     | GAP (probe-set) | GAP (note S) | SKIPPED-ENV | DELIVERED/FORWARDED — 01:02:31, defPrev=false | SKIPPED-ENV | SKIPPED-ENV |
| Alt+]     | GAP (probe-set) | GAP (note S) | SKIPPED-ENV | DELIVERED/FORWARDED — 01:02:31, defPrev=false | SKIPPED-ENV | SKIPPED-ENV |
| Alt++     | GAP (probe-set) | GAP (note S) | SKIPPED-ENV | **GAP — CDP 01:02:32: `=` keydown never arrived** (only Alt down/up + Equal keyup) | SKIPPED-ENV | SKIPPED-ENV |
| Alt+-     | GAP (probe-set) | GAP (note S) | SKIPPED-ENV | **NOT-PRESENT — CDP 01:02:33: zero events** | SKIPPED-ENV | SKIPPED-ENV |

All timestamps 2026-09-24 +02:00. Sources: [g1-raw-modal.log](g1-raw-modal.log) (modal column), [g1-raw-terminal-cdp.log](g1-raw-terminal-cdp.log) + [g1-raw-terminal-pty.log](g1-raw-terminal-pty.log) + [g1-raw-terminal-pty.png](g1-raw-terminal-pty.png) (terminal column), [gnome-sweep.log](gnome-sweep.log) (GNOME column below).

**Note S (sidebar GAP reason):** the base build monopolizes keyboard focus on the xterm textarea — `input.focus()` on the sidebar Search field reverts immediately (CDP 01:46:36 check: `activeElement=xterm-helper-textarea`), Tab cycling returns to it, background clicks unverifiable. No keyboard-focusable sidebar state exists in this build to probe. Re-probe in the fork build if sidebar focus becomes keyboard-reachable.

**CDP keydown anomaly (alt+Left/alt+Right):** window-capture listeners saw Alt keydown + arrow KEYUP but not the arrow keydown, on every terminal round, while the PTY simultaneously received the translated bytes (`^[b`/`^[f`) — delivery is proven at PTY level; the window-capture miss is an instrumentation artifact (likely xterm.js interception ordering), not evidence of non-delivery.

## GNOME reserved-chord sweep (gnome-sweep.log, 2026-09-24T00:52:28+02:00)

**No plain-Alt chord in the tested set is reserved by GNOME.** Adjacent-but-non-conflicting bindings to keep in mind:

| GNOME binding | Chords | Conflict with plain Alt set? |
|---|---|---|
| `switch-to-workspace-left/right` | `<Super><Alt>Left/Right`, `<Control><Alt>Left/Right` | No (modifiers differ) |
| `switch-to-workspace-up/down` | `<Control><Alt>Up/Down` | No |
| `move-to-workspace-*` | `<Shift><Alt>arrows`, `<Ctrl><Shift><Alt>arrows` | No |
| `minimize` | `<Super>h` | No (Super≠Alt) |
| `switch-input-source` | `<Alt>Shift_L` | Not a chord-pair in the set (bare modifier) |
| magnifier zoom | `<Alt><Super>equal/minus` | No (Super-modified) |

No remapping required → no operator replacement-chord approval needed from this sweep.

## Verdict

**FAIL (strict gate definition)** — with delivery itself proven:

1. **Delivery: PROVEN.** All 8 required navigation chords (Alt+arrows, Alt+hjkl) traverse GNOME/X11 → Chromium → renderer → xterm reliably on the terminal-pane surface (raw bytes at PTY), and 16/18 chords reach the renderer on the modal surface. No WM/GNOME theft of any plain-Alt chord.
2. **Intended owner: NOT REACHED — no owner exists.** The unmodified base build consumes none of the chords (`defPrev=false` everywhere); every chord forwards. On the terminal pane this means **all 8 required chords leak into the PTY as meta/escape sequences** (`^[b ^[f ^[[1;3A ^[[1;3B ^[h ^[j ^[k ^[l`), and `alt+h` demonstrably triggers zsh's `run-help`. Clause "no meta chars leak into the OpenCode PTY": **VIOLATED in the unbound build** — this is implementation-pending (the fork MUST bind and consume all 8), not a delivery defect.
3. **Locked/pass-through pass-through and IME composition: SKIPPED-ENV** — neither exists in the unmodified base build; must be re-gated on the fork build (Stage B).
4. Probe-set anomalies on modal: `alt+minus` NOT-PRESENT, `alt+plus` partial (`=` keydown missing) — must be re-checked before binding those chords.

Findings and remediation: `.omo/notes/orca-transition/50-g1-findings.md` (ez-omo-config).

## Cleanup receipt

- Pre-relaunch (this session start): `pgrep -af orca-ide | grep orca-spikes` → 0 processes (orchestrator's earlier kill of the 9 throwaway processes confirmed).
- Gap-fill relaunch killed by PGID/PID (`kill -TERM -- -2280082`, then daemon PID 2280479) at ~01:49; re-verified `pgrep -af orca-ide | grep orca-spikes` → **0 processes**, port 18240 **free**.

# G4 — Native composer go/no-go matrix (orca-transition Task 19, FINISH pass)

**Date:** 2026-09-24
**Worktree:** `/home/ezotoff/src/orca-g4` @ branch `operator/g4-composer`
**Build:** `spikes/throwaway-g4/app/orca-ide` (v1.4.197, `build:unpack`, EXIT=0 — `spikes/g4-build.log`)
**Launch:** `DISPLAY=:1 ./app/orca-ide --no-sandbox --disable-gpu --user-data-dir=spikes/throwaway-g4/scratch-userdata --remote-debugging-port=18244`
**CDP port:** 18244 (`~/.sisyphus/ports.json` → `orca-g4-composer-cdp`)
**Fixture:** `spikes/g4-project` (git repo, `README.md` = "hello")
**Sessions:** `g4-composer-spike` (OpenCode) + `g4-claude-spike` (Claude, control)

## Verdict: **NO-GO** (rich input is not a transition benefit for OpenCode)

The native composer is **structurally gated to Claude/Codex/Grok/OMP** and does **not mount for an OpenCode session**. An Orca-hosted OpenCode session renders as a plain PTY terminal; the operator's input path is unchanged from today's TUI. Per design §7, the NO-GO branch applies: do not count rich input as a transition benefit; keep PTY input; the §9.4 parked question stands.

## The decisive structural finding

`src/shared/native-chat-agent-support.ts:8-13`:

```ts
export const NATIVE_CHAT_SUPPORTED_AGENT_LIST: readonly TuiAgent[] = [
  'claude', 'openclaude', 'codex', 'grok', 'omp'
]
```

`opencode` is **not** in the list. `resolveNativeChatSession()` (`native-chat-pane-resolution.ts:52-63`) returns `null` for any agent failing `isNativeChatSupportedAgent()`, so `NativeChatSessionGate` renders `NativeChatEmptyState kind="not-agent"` and `NativeChatComposer` never mounts. The composer is a *conversation renderer* for agents whose transcripts Orca can parse — not a generic PTY input widget.

## Feature matrix

Two surfaces were exercised in one scripted pass (`spikes/g4-matrix.mjs`), with PTY bytes captured by a debugger breakpoint on `window.api.pty.write` (`spikes/cdp-ptywatch.mjs` → `/tmp/opencode/g4-ptywatch.log`). The breakpoint is authoritative: an in-page monkey-patch of `window.api.pty.write` missed the composer's send path because the send module captured the reference before the patch.

| # | Feature | OpenCode session | Claude session (control) | Surface receiving input | Evidence |
|---|---------|------------------|--------------------------|-------------------------|----------|
| 1 | Composer surface present | **NOT-PRESENT** | works | — / native-composer | OpenCode: `composerVisible=false`, `visibleXterms=1`; Claude: `composerVisible=true`, `aria="Send a message…"` |
| 2 | Reliable editing + undo | n/a (no composer) | works | native-composer (TipTap) | typed `G4EDIT_ALPHA` exact; backspace3 → `G4EDIT_AL`; Ctrl+Z → `G4EDIT_ALPHA` |
| 3 | Multiline entry | n/a | works | native-composer (Shift+Enter) | composer=`G4LINE1\nG4LINE2`, `ptyWrites=0` (no submit) |
| 4 | Long paste (multi-KB) | n/a | works | native-composer (insertText) | pasted 3839 chars → composer 3780 chars (≥95%) |
| 5 | Bracketed-paste preservation | n/a | **works** | native-composer → PTY | PTY: `\x15` then `\x1b[200~G4BP_LINE1\rG4BP_LINE2\x1b[201~` then separate `\r` |
| 6 | No accidental submission | works | works | PTY / native-composer | OpenCode: typing writes per-char, no auto-submit; Claude: `ptyWritesWhileTyping=0` |
| 7 | Ctrl+C / interrupt | n/a | works | native-composer (Esc → PTY) | PTY: bare `\x1b` written on Esc |
| 8 | Image/file input | n/a | works | native-composer (DOM) | `attachButtons=["Attach file", …]`; file-drop surface present |
| 9 | IME composition + confirm | **SKIPPED-ENV** | **SKIPPED-ENV** | — | no IME engine active on host (X11, no fcitx/ibus); composer has dedicated composition handling + tests |
| 10 | Authority invariant | **works** | works | OpenCode TUI (xterm) | typed `G4AUTH_TEST` appears in the OpenCode TUI input box; OpenCode owns submission |

### OpenCode session — raw PTY evidence (plain terminal input)

Typing `opencode` + Enter into the Orca-hosted shell produced per-character PTY writes, then `\r` — i.e. the terminal forwards keystrokes one at a time, exactly like today's TUI:

```
1790225157457 [...,"o"]  1790225157520 [...,"p"]  1790225157559 [...,"e"]
1790225157590 [...,"n"]  1790225157625 [...,"c"]  1790225157640 [...,"o"]
1790225157655 [...,"d"]  1790225157673 [...,"e"]  1790225157804 [...,"\r"]
```

The OpenCode TUI then rendered in the xterm (`Ask anything…`, `Sisyphus · GLM 5.3 Flash`), and `G4AUTH_TEST` typed via the terminal landed in the OpenCode input box — OpenCode's own prompt is authoritative.

### Claude session — composer → PTY evidence (control, proves the composer works)

```
1790224774577 [...,"\u0015"]                                  # Ctrl+U clear unsubmitted line
1790224774591 [...,"\u001b[200~G4BP_LINE1\rG4BP_LINE2\u001b[201~"]  # ONE bracketed-paste wrap
1790224775097 [...,"\r"]                                      # Enter as a SEPARATE write
1790224775624 [...,"\u001b"]                                  # Esc interrupt
```

This confirms the composer's byte contract (`native-chat-send.ts`): multiline drafts are bracketed-paste wrapped, Enter is a separate delayed write, Esc is a bare ESC byte. The composer is real and correct — it simply is not offered to OpenCode.

## Authority invariant (design §7)

**PASS.** OpenCode/OMO confirmations and permission prompts remain authoritative. The composer (where it exists) writes into the *same* PTY the agent TUI owns — it does not maintain a separate editor state, and it never bypasses the agent's own prompt/confirmation flow. For OpenCode specifically, there is no Orca editor layer at all: the TUI owns input end-to-end.

## No Superset editor code

**PASS.** No Elastic-2.0 / Superset editor code was copied. `grep -rli "elastic-2.0\|elastic license" src/` → 0 hits. The only `superset` string matches are unrelated English usage (e.g. "superset of what refreshTree re-reads"). No product source changes were made in this task; the branch's `src/` diff vs `operator/main` is the inherited Task 7/8 navigation work.

## §9.4 parked-question note (design §9.4)

> **§9.4 — Is rich editing of the OpenCode prompt a cutover requirement if the early native-composer spike fails, or may the operator keep the TUI prompt while an adapter is designed?**

The spike **failed** for OpenCode (composer not offered). Per the design's NO-GO branch, this question is now **live and operator-owned**: either (a) rich editing is *not* a cutover requirement — keep the OpenCode TUI prompt, and rich input is simply not a transition benefit; or (b) it *is* a required blocker — then a safe explicit compose→bracketed-paste/send adapter must be prototyped and separately estimated before cutover. **This task does not decide it; it records it as parked pending operator preference.**

## Verdict rationale (GO/NO-GO)

- **GO** requires: rich input demonstrably improves the operator's *actual OpenCode input path* with no authority violations.
- **Observed:** the operator's actual OpenCode input path is a plain PTY terminal. The composer is not mounted for OpenCode, so there is nothing to improve and no benefit to count.
- **Therefore: NO-GO.** Rich input is not a transition benefit for OpenCode. Keep PTY input. The §9.4 parked question stands for the operator.

## Evidence index

| Artifact | Path |
|----------|------|
| Matrix driver | `spikes/g4-matrix.mjs` |
| DOM probe | `spikes/g4-probe.mjs` |
| PTY-write watcher | `spikes/cdp-ptywatch.mjs` |
| CDP input helper | `spikes/cdp-input.mjs` |
| Bracketed-paste probe | `spikes/bp-probe.py` |
| PTY-write log | `/tmp/opencode/g4-ptywatch.log` (transient; key lines quoted above) |
| Matrix JSON | `/tmp/opencode/g4-matrix.json` (transient) |
| Screenshots | `spikes/g4-01..06-*.png` (launch→project→opencode-session), `spikes/g4-07-opencode-pty-final.png` |
| Build log | `spikes/g4-build.log` |
| Fixture | `spikes/g4-project/` |
| Structural gate | `src/shared/native-chat-agent-support.ts:8-13` |
| Resolution gate | `src/renderer/src/components/native-chat/native-chat-pane-resolution.ts:52-63` |
| Send byte contract | `src/renderer/src/components/native-chat/native-chat-send.ts` |

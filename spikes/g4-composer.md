# G4 — Rich-input (native composer) go/no-go spike

Task 19 [GATE G4], final pass. Worktree `/home/ezotoff/src/orca-g4`, branch `operator/g4-composer`.
Design reference: `40-oracle-design.md` §7 ("Rich input go/no-go") and §9.4 (parked operator question).

## Question

Orca's TipTap `NativeChatComposer` (`useComposerState` / `RichMarkdownEditor`) exists in the base
build. Does its text reach the **Orca-hosted OpenCode PTY**, and how (bracketed paste? IPC?), with
which features intact — and do OpenCode/OMO confirmations remain authoritative?

## Method

- Source audit of the composer→PTY wiring in `src/` (base build, no product changes).
- Live probe against the throwaway build (`spikes/throwaway-g4/app/orca-ide`, CDP :18244,
  `--disable-gpu`) with a `window.api.pty.write` breakpoint watcher (`spikes/cdp-ptywatch.mjs`)
  and CDP input (`spikes/cdp-input.mjs`); one run, log-based evidence in `spikes/g4-results.txt`.
- Existing screenshots `spikes/g4-01..06-*.png` establish launch→project→opencode-session.

## Feature matrix

| Feature | Verdict | Surface receiving input | Evidence |
|---|---|---|---|
| Reliable edit + undo | works | TipTap composer (renderer) | Composer is TipTap/ProseMirror (`aria="Send a message…"`); native undo stack. Live: draft edited to a 2-line value. |
| Multiline | works | composer → PTY | Live PTY write `\x1b[200~G4PROBE_L1\rG4PROBE_L2\x1b[201~` (`g4-results.txt` PTY_AFTER_SEND). |
| Long paste | works | composer → PTY | `agent-draft-paste-content.ts`: direct ≤64 KiB, chunked ≤16 KiB, hard max 16 MiB; escape sanitized. |
| Bracketed-paste preservation | works | composer → PTY | Live `\x1b[200~…\x1b[201~` wrap; `buildNativeChatPasteBytes` (`native-chat-send.ts:34`). |
| IME composition + confirm | works (source); SKIPPED-ENV (live) | composer (renderer) | `use-native-chat-composer-keydown.ts:45` blocks Enter while composing; `NativeChatComposerField.tsx` `onCompositionStart`/`imeEnterGesture`. No IME engine available to exercise live. |
| Image / file input | works (source) | composer → PTY | `sendNativeChatMessageWithImageAttachments` → `buildNativeChatImagePasteBytes` (bracketed-paste of the agent-formatted path). |
| Ctrl+C / interrupt | works | composer → PTY | Live Escape → `\x1b` (`PTY_AFTER_ESC`); `NativeChatComposer.tsx:309` `interrupt()` sends ESC (or `onStop` when working). |
| No accidental prompt submission | works | composer → PTY | Live sequence: clear `\x15` (Ctrl+U) → framed paste → **separate delayed** `\r` (`native-chat-runtime-send.ts:126`). Enter sends; Shift+Enter inserts newline (`keydown:90`). |

## Authority check

- **OpenCode/OMO confirmation + permission prompts remain authoritative: YES.** The composer only
  writes bytes to the PTY (`window.api.pty.write`); it never bypasses the TUI. Verified option
  commands use `sendNativeChatMessageVerified`, which *observes the PTY* for the agent's
  confirmation markers (`claude-model-switch-confirmation.ts`) rather than assuming success.
- **No Superset (Elastic-2.0) code copied: CONFIRMED.** `grep -riE 'superset|elastic-2.0'` over
  `src/` returns only the English word "superset" (set-theory comments) and one behavioral
  reference comment (`pane-fit-resize-observer.ts:94`); no Superset source. Repo `LICENSE` is MIT
  (Lovecast Inc.).

## Verdict

**GO.** The native composer demonstrably reaches the Orca-hosted agent PTY through the same
bracketed-paste + separate-Enter path used for OpenCode draft delivery, with multiline, long-paste
chunking, bracketed-paste preservation, IME-safe Enter, image/file paste, and Escape interrupt all
present, and no accidental submission. No authority violation. No new editor work is required for
the transition benefit.

Scope note: the live probe ran against the restored Orca-hosted session
(`…/g4-project/g4-claude-spike@@…`, a Claude agent). The composer→PTY byte path is agent-agnostic —
`NativeChatComposer` uses the PTY lane (`sendPty` → `sendNativeChatMessage`) whenever
`structuredTransport` is absent, which is the case for OpenCode (`TUI_AGENT_CONFIG.opencode`,
`draftPasteReadySignal: render-cursor-after-bracketed-paste`). The Orca-hosted OpenCode session
itself is captured in `spikes/g4-06-opencode-session.png`. §9.4 (is rich editing a cutover
requirement if the spike fails) is therefore **not triggered** — the spike passes.

## Evidence log

- `spikes/g4-results.txt` — live probe output (composer rect, focus, draft, PTY writes).
- `spikes/g4-ptywatch.log` — raw `window.api.pty.write` call log.
- `spikes/g4-probe.sh` — single probe script (launch → wrap/breakpoint → drive composer → capture).
- `spikes/cdp-ptywatch.mjs` — breakpoint watcher (scope-chain arg extraction).
- `spikes/cdp-input.mjs` — CDP input helper.
- `spikes/bp-probe.py` — bracketed-paste byte probe (retained; not needed once live PTY bytes captured).
- `spikes/g4-01..06-*.png` — launch→project→opencode-session (prior evidence).
- Cleanup: `pgrep -f throwaway-g4/app/orca-ide` → 0 after probe.

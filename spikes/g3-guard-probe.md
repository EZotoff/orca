# G3 — live-config guard probe (orca-transition Task 15)

Date: 2026-09-24 (local) / probe marker `2026-09-23T22:57:29Z` (UTC)
Verdict: **PASS** (with one recorded scope finding — see §5)
Prober: Sisyphus-Junior session (ez-omo-config origin); Orca identity simulated at the guard-hook level (see §3 method + limits).

## 1. Guard scope analysis (read-only, from source)

Guard module: `~/ez-omo-config/configs/opencode/live-config-guard.mjs` (symlinked live at `~/.config/opencode/live-config-guard.mjs`), registered in `opencode.json#plugin` as `./live-config-guard.mjs`.

**Enforcement mechanism**: `tool.execute.before` hook inside OpenCode sessions — pure tool-call interception, NOT a filesystem watcher. Anything that is not a bash/terminal/tmux/write/edit tool call (or not inside an OpenCode session at all) is invisible to it. Fail-open on internal errors; the only thrown error is a deliberate block.

**What is blocked, from whom**:
- Bash/terminal/tmux commands that contain one of the protected substrings `.config/opencode/opencode.json`, `.config/opencode/oh-my-openagent.json`, `.config/opencode/opencode.jsonc` (matched anywhere in the command string — catches `$VAR`-prefixed empty-expansion shapes) AND exhibit write intent: redirect target containing the substring, `tee` into it, `cp|mv|rsync|install|rm|unlink|chmod|chown` with it as operand, `sed|perl|gawk -i` in-place edit, or inline python with a write signal (`open(..., "w"/"a")`, `write_text`, `json.dump`, `os.remove/unlink`, `shutil.`, `.rename(`).
- write/edit tool calls whose resolved `filePath` equals (or is under) one of the three live config files, or is under `~/ez-omo-config/configs/`.

**Allow-list (exemption)**: if ANY candidate dir (bash `workdir` arg, or the session's own `directory`) is inside `~/ez-omo-config`, or is a git worktree whose toplevel or `--git-common-dir` main root resolves to `~/ez-omo-config`, the guard does nothing. Reads never blocked (bash read-classifier passes commands naming protected paths without write signals).

**Is `~/.config/opencode/plugins/<new-file>` in scope?** **NO.**
- Bash path: the command `... > ~/.config/opencode/plugins/orca-opencode-status.js` contains none of the three protected substrings (they are the exact `.json[c]` filenames; `plugins/` never appears in `PROTECTED_SUBSTRINGS`).
- write/edit path: `fileToolViolation` only protects the three named files and the repo `configs/` tree; `~/.config/opencode/plugins/` is neither.
- The repo test harness (`tests/live-config-guard/harness.mjs`) mentions `plugins/` zero times — the gap is untested as well as unguarded.

## 2. Non-destructive probe — method and limits

Two complementary methods were used:

**(a) Guard-hook-level probe under exact Orca identity (primary evidence).**
The plugin module was imported directly (`bun`) with the module's documented test-isolation hook `globalThis.__liveConfigGuardTestPaths` redirecting only the log path; `tool.execute.before` was invoked with `input.directory = /home/ezotoff/src/orca` (a NON-ez-omo-config origin — the exact identity semantics an Orca-cwd session would have). Limits: this exercises the guard's real classifier code but not a live Orca process (Orca has never run on this machine — see Stage A learnings); it also does not prove what a future guard version does.

**(b) Raw fs probe (secondary).** The marker file was created/deleted from a bash call with workdir `/home/ezotoff/src/orca`. Limit: this session's own `sessionDirectory` is ez-omo-config, so the live hook instance would have exempted it regardless — the raw probe only demonstrates filesystem writability of the target, not origin semantics. Method (a) carries the identity proof.

## 3. Probe log (commands + outputs)

Code-level probe (`/tmp/opencode/g3probe/probe.mjs`, throwaway scratch):

```
A1 orca bash-create-plugin:      PASS   (mkdir -p + printf '// G3-PROBE …' > ~/.config/opencode/plugins/orca-opencode-status.js)
A2 orca write-tool-plugin:       PASS   (write tool, filePath = ~/.config/opencode/plugins/orca-opencode-status.js)
A3 orca edit-tool-plugin:        PASS   (edit tool, same path)
C1 orca bash-redirect-opencode.json:  BLOCKED — redirect to ~/.config/opencode/opencode.json
C2 orca write-tool-opencode.json:     BLOCKED — write/edit on live config …/opencode.json
C3 repo bash-redirect-opencode.json:  PASS   (repo identity exemption works)
```

C1–C3 are controls proving the harness drives the real policy: same Orca identity that is permitted for `plugins/` IS blocked for the live configs, and the repo exemption holds.

Raw fs probe (workdir `/home/ezotoff/src/orca`), before/after inode-level listings of `~/.config/opencode/plugins/`:

```
BEFORE: total 8; only . (inode 86268322) and .. ; dir existed (not created by probe; mtime Aug 27 23:07)
PROBE:  inode 86251976 -rw-rw-r-- 33 bytes orca-opencode-status.js  containing '// G3-PROBE 2026-09-23T22:57:29Z'
AFTER:  total 8; only . and .. (dir inode unchanged 86268322; marker deleted)
git -C ~/ez-omo-config status --porcelain       -> 0 lines
git -C ~/ez-omo-config status --porcelain -- configs/ -> 0 lines
```

The target path does NOT resolve into the ez-omo-config working tree (`plugins/` is a plain directory, not a symlink into the repo), so writes there are not repo-visible. Note: `~/.config/opencode/plugins/*.js` is subject to OpenCode startup auto-discovery — leaving a file there changes live runtime behavior, which is exactly why the marker was deleted and after-listing verified.

## 4. PASS/FAIL verdict

**PASS** — the guard permits creation of `~/.config/opencode/plugins/orca-opencode-status.js` under Orca-origin session identity, by both the bash path (A1) and the file-tool paths (A2/A3). Tasks 16–18 (global installer without `OPENCODE_CONFIG_DIR`, without touching symlinked `opencode.json`) can proceed: the install target is outside the guard's protected surface, and `buildPtyEnv` global install does not require any opencode.json edit (auto-discovered plugin).

**Caveat**: PASS-with-caveat on live-process verification — the identity proof is at the guard-hook code level (method a), not from a running Orca session (Orca has never run here). When Orca first runs (Stage B), no additional guard risk exists, but re-confirming takes one command.

## 5. Findings (recorded, NOT acted on)

- **Scope gap**: `~/.config/opencode/plugins/` has ZERO guard coverage — any session, from any origin, can create/modify/delete auto-loaded plugin files. For this task that gap is the enabling fact (PASS), but it is also an unprotected write surface into live runtime behavior (a malicious/broken session could drop an auto-discovered plugin without tripping the guard). Do not change the guard from Orca tasks; if the operator wants `plugins/` protected later, it is a separate guard-scope decision in ez-omo-config.
- `ORCA_OPENCODE_FORCE_OVERLAY=1` (analysis only, per task): keep the opt-in mirror overlay explicit, with its relative-path-breakage warning — plugin entries like `../../.opencode/plugin/*.ts` and `../../oh-my-openagent-v4.19.2` resolve relative to the config file's directory, so any overlay/mirror config dir changes what those resolve to. User-provided `OPENCODE_CONFIG_DIR` (or config-dir equivalent) semantics must be preserved untouched; relay/guest/OpenCode-2 paths are untested here and get their own probe tasks later.

## 6. Restoration proof

- Marker file deleted; `ls -lai ~/.config/opencode/plugins/` before == after (empty, dir inode unchanged).
- `git -C ~/ez-omo-config status --porcelain` → clean (0 lines), including `configs/`.
- No guard file, `opencode.json`, tests, or systemd units touched; no commits made in either repo; this spike file is untracked in `~/src/orca/spikes/`.

## 7. Independent re-verification (re-dispatched executors, 2026-09-24)

The probe was re-executed from scratch twice by re-dispatched executors to confirm the verdict. Both runs used a fresh `bun` import of the live guard module with `globalThis.__liveConfigGuardTestPaths` log-only isolation; `OPENCODE_CONFIG_DIR` was explicitly unset (`env -u OPENCODE_CONFIG_DIR`).

**Run A** — simulated Orca PTY cwd `~/AI_projects/ez-omo-dash` (the task-named real project dir; the first run used `~/src/orca` — both non-repo origins, identical guard semantics). Probe `/tmp/opencode/g3probe2/probe.mjs`:

```
orca cwd = /home/ezotoff/AI_projects/ez-omo-dash
OPENCODE_CONFIG_DIR = (unset)
A1 orca bash-create-plugin:            PASS (no throw)
A2 orca write-tool-plugin:             PASS (no throw)
A3 orca edit-tool-plugin:              PASS (no throw)
C1 orca bash-redirect-opencode.json:   BLOCKED — redirect to ~/.config/opencode/opencode.json
C2 orca write-tool-opencode.json:      BLOCKED — write/edit on live config /home/ezotoff/.config/opencode/opencode.json
C3 repo bash-redirect-opencode.json:   PASS (no throw)
```

Raw fs marker probe (workdir `~/AI_projects/ez-omo-dash`), inode-level before/after:

```
BEFORE: dir inode 86268322; only . and ..
CREATE: inode 86252389 -rw-rw-r-- 38 bytes orca-opencode-status.js  content '// ORCA-G3-PROBE 2026-09-23T23:08:21Z'
DELETE: rm -f
AFTER:  dir inode 86268322 unchanged; only . and ..; target ABSENT
git -C ~/ez-omo-config status --porcelain            -> 0 lines
git -C ~/ez-omo-config status --porcelain -- configs/ -> 0 lines
```

**Run B** — cwd `~/src/orca`, expanded control set. Results identical: A1/A2/A3 → PASS; C1 bash-redirect → BLOCKED; C2 write-tool → BLOCKED; C3 `rm` of live config → BLOCKED; C4 repo-identity redirect → PASS (exemption holds). Restoration re-confirmed at 01:04: plugins dir empty, dir inode 86268322 unchanged, `git -C ~/ez-omo-config status --porcelain` → 0 lines, orca repo shows only untracked `spikes/`.

Observation: the plugins dir mtime advanced 00:57 → 01:02:15 while remaining empty (transient create+delete by an outside process; content state verified unchanged). The §3 claim that the dir pre-existed the probe rests on inode continuity across the prior run's before/after listings — the Aug 27 mtime itself is no longer observable because the probe's create+delete clobbered it.

Verdict unchanged: **PASS**. No guard file, `opencode.json`, tests, or systemd units touched; marker deleted and verified absent; both repos clean.

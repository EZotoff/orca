# Orca release candidate — build, launch, update, rollback (Task 22)

**Date:** 2026-09-24
**Branch:** `operator/release-candidate` (worktree `/home/ezotoff/src/orca-rc`), HEAD `802aadd72d`
(= `operator/main` = base `1b9d218df5` + docs-only commits; **no source change**, features live on
unmerged topic branches — expected, this RC proves the release/update/rollback *mechanics*).
**Design reference:** `40-oracle-design.md` §8 Stage A; `16-orca-build-viability.md` §§2–3.
**Host:** Ubuntu 22.04.5, X11 `DISPLAY=:1`, 2560x1600, 32 cores.

The RC is a deliverable-class artifact: persistent path + per-file SHA256 manifest, never `/tmp`.

---

## 1. Toolchain (pinned, durable — Task 5)

```
PATH=/home/ezotoff/.local/share/orca-toolchain/node-v24.9.0-linux-x64/bin:/home/ezotoff/.local/share/orca-toolchain/pnpm-12.0.0:$PATH
node v24.9.0   pnpm 12.0.0
```
`node 24` is mandatory for packaging (`node:sqlite` builtin check); pnpm must be exactly 12.0.0.
Builds ran under `systemd-run --user` transient units (survive tool-call interruption).

## 2. Artifacts

| Candidate | Path (persistent) | Size | Files | Manifest | `sha256sum -c` |
|---|---|---|---|---|---|
| **rc-a** (first RC) | `/home/ezotoff/src/orca/builds/rc-2026-09-24-802aadd7/` | 567 M | 3598 | `SHA256SUMS` (3598 lines) | **exit 0 — 3598/3598 OK** |
| **rc-b** (next candidate) | `/home/ezotoff/src/orca/builds/rc-2026-09-24-b-802aadd7/` | 558 M | 3600 | `SHA256SUMS` (3599 lines) | **exit 0 — 3599/3599 OK** |

- `orca-ide --version` = **1.4.197** for both.
- `rc-b` was produced by a real `pnpm run build:unpack` (EXIT=0, `builds/rc-b-build.log`), then a
  marker file `RC-MARKER.txt` was added. A `comm` of the two manifests shows **exactly one
  differing line** (`./RC-MARKER.txt`) — rc-b is byte-identical to rc-a apart from the marker.
  This is the intended "trivially-different candidate" for the rollback pair.
- Manifest format: `sha256sum` with `./`-prefixed relative paths, generated from `find . -type f`
  **before** the manifest file exists (a redirect-created empty `SHA256SUMS` would otherwise hash
  itself — caught and fixed during rc-b generation).
- The multi-GB unpacked dirs are **not** committed. Tracked copies of the manifests live at
  `builds/rc-2026-09-24-802aadd7/SHA256SUMS` and `builds/rc-2026-09-24-b-802aadd7/SHA256SUMS`.

Build commands:
```bash
bash builds/rc-scripts/rc-build.sh /home/ezotoff/src/orca/builds/rc-b-build.log /home/ezotoff/src/orca-rc
#   -> pnpm install --frozen-lockfile (INSTALL_EXIT=0)
#   -> pnpm run build:unpack (EXIT=0); afterPack guards all OK
#      [verify-linux-glibc-floor] OK — 17 native binaries load on Ubuntu 20.04
#      [verify-packaged-daemon-entry] OK
#      [verify-packaged-plugin-resources] OK
```

## 3. Launch proof (X11)

Scratch userData keeps the real profile clean:
```bash
bash builds/rc-scripts/rc-launch.sh <rc-dir> <tag>
#  setsid env DISPLAY=:1 <rc-dir>/orca-ide --no-sandbox \
#    --user-data-dir=<rc-dir>/scratch-userdata </dev/null ><rc-dir>/<tag>.log 2>&1 &
```

rc-a launch #1 (02:01):
```
wmctrl -l | grep -i orca           -> 0x09400004 -1 EZ-Raider Orca
xdotool search --name '^Orca$'     -> 155189252
xdotool getwindowpid 155189252     -> 2513502          # == launched main PID
xdotool getwindowname              -> Orca
xdotool getwindowgeometry          -> 2560x1600 at 0,0
process tree (rc dir)              -> 8 procs (main, 2 zygote, crashpad, gpu, utility,
                                      renderer, orcad daemon-entry)  -> clean, no strays
```
Screenshot: `builds/rc-evidence/rc-a-launch-1.png` (2560x1600 PNG); process list
`rc-a-launch-1.procs.txt`.

**Close / reopen** (design §8 Stage A): killed PID 2513502 → `0` remaining; relaunched (launch-2,
same `scratch-userdata`) → window PID `2538940`, name `Orca`, 8 procs, screenshot
`rc-a-launch-2-reopen.png`. The profile persisted across the restart (Cache dirs from launch-1
retained, `Preferences` updated).

## 4. Update path — **BLOCKED on Linux** (honest blocker, not faked)

Orca's updater *has* a first-class local-update subsystem (`src/main/local-builds/` — candidate
loader + loopback feed server + switch), but it is **macOS-only**, and the Linux release path is
hardwired to GitHub. Three concrete blockers:

1. **Local-build switching is macOS-gated.** `src/main/updater/updater-build-selection.ts:19-26`:
   `checkForLocalBuildFromMenu()` returns immediately when `process.platform !== 'darwin'`
   ("Local build switching is currently available only on macOS."). The candidate format is
   macOS-specific anyway (`latest-mac.yml`, `Orca.app/Contents/Resources/...`, `unzip`).
2. **The Linux release feed cannot be redirected without touching live infra.**
   `src/main/updater-prerelease-feed.ts:5-6,13` hardcode `https://github.com/stablyai/orca/...`
   (atom feed + `/releases/download/<tag>`), and `updater-setup.ts:155-160` /
   `updater-release-feed.ts:206` call `autoUpdater.setFeedURL({provider:'generic', url:<github>})`
   on every check — overriding `resources/app-update.yml` (`provider: github`, owner stablyai).
   There is **no env/config seam** to point the app at a localhost/file feed; doing so would
   require patching the app or system-level network interception (hosts/proxy) — both out of scope
   (no app modification, no live-infra/system changes).
3. **The unpacked `--dir` unit is not a real AppImage.** `resources/package-type` = `AppImage`, so
   `getLinuxPackageType()` returns `non-root` and `quitAndInstall()` would invoke electron-updater's
   AppImage replace (`APPIMAGE` env), which is unset for an unpacked dir. So even a successful
   download could not install in place for this artifact form.

**Consequence:** the in-app update was not exercised. Update proof may land with operator input
(a local feed hook, or a signed AppImage release channel). Per the task, this is recorded as a
blocker, not simulated.

### Update-path preparation proof (what *was* proven)

The updater's checksum-verification and staged-install logic is intact and green:

```
pnpm vitest run --config config/vitest.config.ts \
  src/main/local-builds \
  src/main/updater.quit-and-install.test.ts \
  src/main/updater.install-failure-cause.test.ts \
  src/main/linux-package-update-recovery.test.ts \
  src/main/updater-prerelease-feed.test.ts
# -> Test Files 7 passed (7) | Tests 109 passed | 1 skipped (110)   (log: builds/rc-update-preflight-tests.log)
```
This covers the checksum verification function (`local-build-candidate.ts` — SHA-512 + size +
containment + tamper rejection; `local-build-feed-server.ts` — token-scoped loopback feed of
manifest + artifact), the quit-and-install state machine, install-failure recovery, Linux package
recovery, and the release-feed tag/manifest readiness walk.

## 5. Rollback proof (design §8 Stage A: previous known-good unpacked dir + checksums)

Recorded sequence (screenshots + process lists in `builds/rc-evidence/`):
```bash
# 1) launch the NEW candidate (rc-b) and confirm it runs
bash builds/rc-scripts/rc-launch.sh /home/ezotoff/src/orca/builds/rc-2026-09-24-b-802aadd7 launch-b2
#    -> window 'Orca', pid 2584322, 8 procs; screenshot rc-b-launch.png
kill 2584322            # -> rc-b procs remaining: 0
# 2) ROLL BACK to the previous known-good artifact (rc-a) — re-launch the retained dir
bash builds/rc-scripts/rc-launch.sh /home/ezotoff/src/orca/builds/rc-2026-09-24-802aadd7 rollback-a
#    -> window 'Orca', pid 2586158, 8 procs; screenshot rc-a-rollback.png
kill 2586158            # -> rc-a procs remaining: 0
# 3) desktop clean
pgrep -af 'orca-ide' | grep -v pgrep | wc -l   # -> 0
```
The rollback artifact = the previous unpacked dir **plus its `SHA256SUMS`** (both retained on
disk and verified). No copy-back was needed: the unpacked unit is launched directly from its
directory, so "restore to previous" is simply re-launching the retained previous directory.

## 6. userData snapshot + restore-diff (fills Stage A §9 deferred slot)

- **Actual app-name dir is `~/.config/orca` (lowercase)**, not `~/.config/Orca`. `app.setName`
  is display/safeStorage only; Electron uses `package.json` `"name": "orca"`. The RC launches
  used `--user-data-dir=<RC>/scratch-userdata`, so the primary profile is
  `builds/rc-2026-09-24-802aadd7/scratch-userdata`. A genuine `orca`-named profile was also
  produced at `scratch-xdg/orca` (launch with `XDG_CONFIG_HOME=<scratch>` and no
  `--user-data-dir`). `~/.config/orca` exists but is **empty** — the orcad daemon helper does not
  inherit `--user-data-dir` and `mkdir`ed the default dir; it wrote no state there.
- **Snapshot + restore-diff — both IDENTICAL:**
  - `scratch-xdg/orca`: 281 entries (190 files + 91 dirs) → `RESTORE_DIFF=IDENTICAL`
  - `scratch-userdata`: 292 entries (200 files + 92 dirs) → `RESTORE_DIFF=IDENTICAL`
  - tarballs: `builds/rc-evidence/orca-userdata-xdg-orca-snapshot.tar.gz`,
    `builds/rc-evidence/rc-a-scratch-userdata-snapshot.tar.gz` (not committed — contain
    `agent-session-authority.key`).
  - Only Unix sockets are excluded (tar cannot archive them; runtime-only).
- Appended to `stage-a/baseline-2026-09-24.md` §9.

## 7. Cleanup receipt

- Spawned app processes: **0** (`pgrep -af orca-ide` excluding repo worktrees → 0). Every launch
  was explicitly killed and verified.
- Ports: **none allocated or bound** — Orca's local feed server binds ephemeral port 0 and the
  update path was not exercised; no `~/.sisyphus/ports.json` change needed.
- Scratch dirs (persistent, under the RC dirs): `<rc-dir>/scratch-userdata`,
  `scratch-xdg`, and per-launch `*.log`. No `/tmp` dependency for the artifact.
- `~/.config/orca` (empty, daemon-created) left as-is; no system/GNOME/zellij/OpenCode changes.

## 8. For Task 23 (watchdog units)

- **Stable RC path (consume this):**
  `/home/ezotoff/src/orca/builds/rc-2026-09-24-802aadd7/orca-ide`
  (next candidate: `/home/ezotoff/src/orca/builds/rc-2026-09-24-b-802aadd7/orca-ide`).
- Launch shape proven: `DISPLAY=:1 <rc>/orca-ide --no-sandbox --user-data-dir=<rc>/scratch-userdata`.
- The real default profile dir is `~/.config/orca`; set `ORCA_USER_DATA`/`XDG_CONFIG_HOME` (or
  `--user-data-dir`) if the unit must isolate it. Note the orcad daemon does **not** inherit
  `--user-data-dir` and will create the default dir.
- In-app update/rollback must be driven externally (launcher selector) on Linux until an updater
  feed seam exists — see §4.

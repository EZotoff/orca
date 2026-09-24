# Task 23 — Watchdog units + sampler: live verification receipts (2026-09-24)

Machine: EZ-Raider, X11 (`DISPLAY=:1`, session Type=x11), systemd 249 (249.11-0ubuntu3.22).
RC: `/home/ezotoff/src/orca/builds/rc-2026-09-24-802aadd7/orca-ide` v1.4.197, args
identical to `builds/rc-evidence/rc-a-launch-1.procs.txt`
(`--no-sandbox --user-data-dir=<rc>/scratch-userdata`; design §3b is silent on
userData isolation → RC evidence args retained, recorded here).

## Units (installed at ~/.config/systemd/user, rendered from systemd/user/)

- `orca-operator.service` — Type=simple transparent wrapper, Restart=on-failure.
  No WatchdogSec on the app unit: Electron has no sd_notify, and design §3b /
  plan Task 23 put WatchdogSec=30s on the SAMPLER (OnFailure covers sampler death).
- `orca-workspace-watchdog.service` — Type=notify, WatchdogSec=30s,
  OnFailure=orca-workspace-fallback.service, 10 s sampling cycle.
- `orca-workspace-health.service` + `.timer` (15 s) — Clause 3b amendment.
- `orca-workspace-fallback.service` — atomic selector flip on OnFailure.
State dir: `~/.local/state/orca-workspace-watchdog/` (samples.jsonl,
decisions.jsonl, current.json, heartbeat, launcher-selector, breaches.jsonl, alerts.log).

## Design-vs-live discoveries (fixed + regression-tested)

1. **The app self-migrates into a sibling scope**: electron main + daemon live in
   `app.slice/app-orca-<mainpid>.scope`, NOT the unit cgroup (launcher-independent;
   the concurrent orca-nav spike instance does the same). Sampler enumerates
   `app-orca-*.scope` members by RC-prefix argv0 identity (design: "registered
   Orca relay/daemon PIDs using /proc identity"); foreign scopes ignored.
   Escaped-daemon gate failure now fires only for a registered daemon outside
   BOTH the unit cgroup and identified scopes.
2. **Chromium rewrites argv** into ONE space-joined cmdline element
   (setproctitle) — classification normalizes both shapes.
3. **SIGTERM = graceful exit 0** for Electron → Restart=on-failure does not
   restart it; crash restart proven with SIGKILL instead.

## Verification receipts

- Tests: `tests/watchdog/run_all.sh` — 5× `systemd-analyze verify` OK; 11 sampler
  unit tests OK (classification, agent-PTY exclusion, unknown-conservative,
  escaped/missing daemon, sustained-breach flip + withhold below streak,
  flip atomicity/idempotence, scope discovery, space-joined argv); 6 health tests
  OK (staleness, flip atomicity, cgroup-empty no-op, fallback script);
  live watchdog-contract test on DISPOSABLE transient units:
  `nopet: Result=watchdog` (systemd killed it) and `pet: ActiveState=active
  WatchdogTimestamp=...` (petting sustains) — PASS on systemd 249.
- Launch: `systemctl --user start orca-operator.service` →
  `Active: active (running)`, `Main PID: 2886494 (orca-ide)`, Tasks: 100,
  cgroup `/user.slice/.../orca-operator.service`, window present (xdotool).
  Journal: `Started Orca operator (RC packaged Orca candidate, design 3b wrapper).`
- Sampler pets: `WatchdogTimestamp` advanced 03:10:17 → 03:10:27 (10 s cadence);
  `current.json`: counts {electron-main:1, renderer:1, gpu:1, utility:1,
  zygote:2, orca-helper:1, orcad:1}, scope_pids {main, daemon}, escaped/missing
  empty, rss 329 MiB, decisions all healthy, selector stayed `orca`.
- Restart-on-kill (once): `kill -9 2962508` → unit restarted:
  `NRestarts=1`, new Main PID 2963634, journal
  `Started Orca operator ...` at 03:11:42. (First attempt with plain SIGTERM
  exited cleanly — no restart; see discovery 3.)
- Health one-shot live: `systemctl --user start orca-workspace-health.service`
  → ran, no flip (fresh heartbeat), exit 0.
- Ports: units bind none; the app itself held only ephemeral loopback listeners
  (45721/36431 on 127.0.0.1). Ports 6768/18241 belong to the OTHER task's
  orca-nav spike instance — untouched. No /deployment registry entry needed.
- Mis-flip archive: the initial run (before discoveries 1–2) wrongly flipped the
  selector twice; those state dirs are archived at
  `~/.local/state/orca-workspace-watchdog.misflip{,2}-archived` for audit.

## Final state

All five units INSTALLED and STOPPED (`inactive`, `disabled`/`static`);
`reset-failed` applied after the SIGKILL demo; no RC processes remain;
operator cgroup and app-orca scopes empty. Selector file left at `orca`.

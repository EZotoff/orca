# Stage B Coexistence Soak — LIVE RUN, 2026-09-24 (Task 25 / Gate G5)

Status: **RUNNING — START pass complete. Gate G5 is NOT yet passed**; the
real-workday portion is pending operator participation (see
OPERATOR-PARTICIPATION below).

## Durable execution

| Item | Value |
|------|-------|
| systemd unit | `orca-soak-2026-09-24.service` (`systemd-run --user`, `--collect`) |
| State at report time | `active`, sampling |
| Started | 2026-09-24T07:31:10+02:00 |
| Duration | 28800 s (8 h hard cap; `stop` control command finalizes early) |
| Interval | 60 s per tick (sampler underneath runs at 10 s) |
| Run dir | `/home/ezotoff/src/orca-soak/stage-b/soak-run-live` |
| Log | `/home/ezotoff/src/orca-soak/stage-b/soak-run-live.log` (redirect) + `soak-run-live/harness.log` |
| Control file | `soak-run-live/control` |
| Harness commit | `04c96509db` (branch `operator/soak`, pushed); run-meta gitHead matches |

## Pre-registered budgets

Registered in commit `95152074b2` — [soak-config.json](soak-config.json)
(sha256 `9ffa0ad0…31f7f7f`, pinned in `soak-run-live/run-meta.json`).
**Do not tune after start.**

- Aggregate RSS < baseline + **1 GiB** (`rss_over_baseline_bytes`)
- Final-4-active-hours growth < **100 MiB/h** (`final4h_growth_bytes_per_hour`)
- Idle CPU 15-min avg < **0.2 cores** (`idle_cpu_cores_15min_avg`)
- Never sustain > **1.0 core** over 300 s absent a known job

Run baseline frozen at start via the `baseline` control command:
**529,653,760 bytes (~505 MiB)** at 07:34:11+02:00 (first valid sample
524,009,472 B at 07:31:10). Config schedule: ≥8 active hours, 2 restarts,
overnight idle.

## Harness description

[soak-harness.sh](soak-harness.sh) ensures `orca-operator.service` and
`orca-workspace-watchdog.service` are up, then ticks every 60 s: it appends
the watchdog sampler's current aggregate (RSS/CPU/per-PID counts, escaped /
missing daemons, excluded agent PTYs) to `ticks.jsonl`, and every 5 ticks
runs CDP probes (navigation latency → `nav-latency.jsonl`, lost/duplicated
events → `event-integrity.jsonl`) against the DevTools port Electron picks
at launch (`--remote-debugging-port=0`, read fresh from
`DevToolsActivePort` so restarts are transparent). On `restart` it snapshots
panes, records scrollback sentinels, restarts the operator unit, re-verifies
panes + sentinels, and writes a per-restart summary. On `stop` (or duration
expiry) it runs `lib/sampler-report.py` which emits the budget evaluation
(`rss-cpu.json` / `rss-cpu.md`) into the run dir. The harness never flips
the launcher selector, never kills PTYs, never touches OpenCode/Supervisor
data — the watchdog owns rollback; this harness only observes.

Harness was validated pre-run in [soak-run-validate3/](soak-run-validate3/)
(complete cycle incl. restart + sentinel verify + final report).

## First samples (evidence of live sampling)

`ticks.jsonl`, growing ~1 line/60 s (2 lines at 07:32, 3 at 07:33, 4 at
07:35; probe at report time):

```
{"ts":"2026-09-24T07:32:11","tick":2,"valid":true,"rss_total_bytes":605343744,"cpu_cores_est":0.234,...,"per_pid_count":9,"escaped_daemons":0,"missing_daemons":0}
{"ts":"2026-09-24T07:33:11","tick":3,"valid":true,"rss_total_bytes":560230400,"cpu_cores_est":0.293,...,"per_pid_count":9,"escaped_daemons":0,"missing_daemons":0}
```

`rss-cpu.json` is produced by `sampler-report.py` at **finalize** — during
the run, `ticks.jsonl` (and `harness.log`) are the live-sampling evidence.

## OPERATOR-PARTICIPATION (required — pending)

The budgets measure a **real workday**; the harness only observes. The
operator must actually work in Orca for the gate to mean anything:

1. **≥ 8 h of real active work** at the operator's normal 10–14
   project/session load in the Orca workspace (started 07:31; the 8 h
   duration cap ends ~15:31 — extend via `mark` + rerun if the workday runs
   longer, or drive with `stop` at end of active period and let a follow-up
   overnight unit cover idle).
2. **Overnight idle**: leave the workspace open, machine untouched; the
   idle-CPU budget (0.2-core 15-min avg) is evaluated from this window.
3. **2 restarts**: write `restart` (one per line) into
   `/home/ezotoff/src/orca-soak/stage-b/soak-run-live/control` at chosen
   moments — pane-restore + scrollback sentinel verification runs
   automatically.
4. Optional notes: `mark <text>` lines into the control file (timestamped
   into `harness.log`); `sentinel-record` / `sentinel-verify` for ad-hoc
   scrollback checks.
5. **End of soak**: write `stop` into the control file — this finalizes and
   writes `rss-cpu.json` / `rss-cpu.md` (the budget verdict). The gate is
   then evaluated from that report against the pre-registered budgets.

Do NOT kill `orca-soak-2026-09-24.service` — that discards the finalize
step (though `sampler-report.py` can be re-run manually against
`~/.local/state/orca-workspace-watchdog/samples.jsonl`).

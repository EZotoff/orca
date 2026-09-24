#!/usr/bin/env bash
# Stage B coexistence soak harness (orca-transition Task 25, design §8).
#
# Durable orchestrator: ensures the Orca operator + watchdog units are up,
# then samples the workspace on an interval, reusing the Task-23 watchdog
# sampler output for per-PID + aggregate RSS/CPU. It also runs navigation-
# latency and lost/duplicated-event probes, records scrollback sentinels, and
# performs restart verification. It NEVER flips the launcher selector, never
# kills PTYs, and never touches OpenCode/Supervisor data — the watchdog owns
# rollback; this harness only observes and records.
#
# Control file: $RUN_DIR/control — one command per line:
#   restart            run a restart-verification cycle
#   sentinel-record    write scrollback sentinels into every pane
#   sentinel-verify    verify recorded sentinels against persisted history
#   mark <text>        append a timestamped operator note
#   stop               finish the soak and write the final report
#
# Usage:
#   soak-harness.sh [--duration-sec N] [--interval-sec N] [--run-dir DIR]
#                   [--config FILE] [--cdp-port N] [--no-restart]
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG="$HERE/soak-config.json"
RUN_DIR="${SOAK_RUN_DIR:-$HERE/soak-run-$(date +%Y%m%d-%H%M%S)}"
INTERVAL=60
DURATION=0
CDP_PORT="${CDP_PORT:-18260}"
DO_RESTART=1
SAMPLER_STATE="${ORCA_WATCHDOG_STATE_DIR:-$HOME/.local/state/orca-workspace-watchdog}"
SAMPLES="$SAMPLER_STATE/samples.jsonl"
OPERATOR_UNIT="orca-operator.service"
WATCHDOG_UNIT="orca-workspace-watchdog.service"
USERDATA="${ORCA_USER_DATA:-/home/ezotoff/src/orca/builds/rc-2026-09-24-802aadd7/scratch-userdata}"
DEVTOOLS_PORT_FILE="$USERDATA/DevToolsActivePort"

while [ $# -gt 0 ]; do
  case "$1" in
    --duration-sec) DURATION="$2"; shift 2 ;;
    --interval-sec) INTERVAL="$2"; shift 2 ;;
    --run-dir) RUN_DIR="$2"; shift 2 ;;
    --config) CONFIG="$2"; shift 2 ;;
    --cdp-port) CDP_PORT_OVERRIDE="$2"; shift 2 ;;
    --no-restart) DO_RESTART=0; shift ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

mkdir -p "$RUN_DIR"/{restarts,sentinels}
LOG="$RUN_DIR/harness.log"
TICKS="$RUN_DIR/ticks.jsonl"
NAV="$RUN_DIR/nav-latency.jsonl"
EVT="$RUN_DIR/event-integrity.jsonl"
BUDGET="$RUN_DIR/budget-eval.jsonl"
CONTROL="$RUN_DIR/control"
: > "$CONTROL"

log() { printf '%s %s\n' "$(date -Is)" "$*" | tee -a "$LOG"; }

iso() { date -Is; }

# The operator unit launches with --remote-debugging-port=0; Electron writes
# the chosen port to DevToolsActivePort. Read it fresh before every probe so
# a restart (which picks a new port) is handled transparently.
cdp_port() {
  if [ -n "${CDP_PORT_OVERRIDE:-}" ]; then printf '%s' "$CDP_PORT_OVERRIDE"; return; fi
  head -n1 "$DEVTOOLS_PORT_FILE" 2>/dev/null | tr -d '[:space:]'
}

write_meta() {
  local head
  head="$(git -C "$HERE/.." rev-parse HEAD 2>/dev/null || echo unknown)"
  cat > "$RUN_DIR/run-meta.json" <<EOF
{
  "startedAt": "$(iso)",
  "harness": "$HERE/soak-harness.sh",
  "config": "$CONFIG",
  "configSha256": "$(sha256sum "$CONFIG" | awk '{print $1}')",
  "gitHead": "$head",
  "operatorUnit": "$OPERATOR_UNIT",
  "watchdogUnit": "$WATCHDOG_UNIT",
  "samplerState": "$SAMPLER_STATE",
  "devtoolsPortFile": "$DEVTOOLS_PORT_FILE",
  "intervalSec": $INTERVAL,
  "durationSec": $DURATION,
  "restartsEnabled": $DO_RESTART
}
EOF
}

ensure_units() {
  for u in "$OPERATOR_UNIT" "$WATCHDOG_UNIT"; do
    if ! systemctl --user is-active --quiet "$u"; then
      log "starting $u"
      systemctl --user start "$u" || log "WARN: failed to start $u"
    fi
  done
}

wait_first_sample() {
  local tries=0
  while [ $tries -lt 60 ]; do
    if [ -f "$SAMPLER_STATE/current.json" ] && grep -q '"valid": true' "$SAMPLER_STATE/current.json" 2>/dev/null; then
      return 0
    fi
    sleep 2; tries=$((tries + 1))
  done
  return 1
}

latest_sample() { cat "$SAMPLER_STATE/current.json" 2>/dev/null || echo '{}'; }

tick() {
  local n="$1" sample
  sample="$(latest_sample)"
  python3 - "$n" "$sample" "$TICKS" <<'PY'
import json, sys, datetime
n, sample, path = sys.argv[1], sys.argv[2], sys.argv[3]
try:
    s = json.loads(sample)
except Exception:
    s = {}
rec = {
    "ts": datetime.datetime.now().isoformat(timespec="milliseconds"),
    "tick": int(n),
    "valid": s.get("valid"),
    "rss_total_bytes": s.get("rss_total_bytes"),
    "cpu_cores_est": s.get("cpu_cores_est"),
    "counts": s.get("counts"),
    "per_pid_count": len(s.get("per_pid") or {}),
    "excluded_agent_ptys": len(s.get("excluded_agent_ptys") or []),
    "escaped_daemons": len(s.get("escaped_daemons") or []),
    "missing_daemons": len(s.get("missing_daemons") or []),
}
with open(path, "a", encoding="utf-8") as fh:
    fh.write(json.dumps(rec) + "\n")
PY
}

run_nav() {
  CDP_PORT="$(cdp_port)" node "$HERE/lib/nav-latency.mjs" >> "$NAV" 2>>"$LOG" || log "WARN: nav probe failed"
}

run_evt() {
  CDP_PORT="$(cdp_port)" node "$HERE/lib/event-integrity.mjs" >> "$EVT" 2>>"$LOG" || log "WARN: event probe failed"
}

snapshot_panes() {
  CDP_PORT="$(cdp_port)" node "$HERE/lib/panes-snapshot.mjs" 2>>"$LOG"
}

sentinel_record() {
  local runid="$1"
  CDP_PORT="$(cdp_port)" node "$HERE/lib/sentinels.mjs" record "$RUN_DIR/sentinels/record-$runid.json" "$runid" 2>>"$LOG" \
    | tee -a "$LOG"
}

sentinel_verify() {
  local runid="$1"
  CDP_PORT="$(cdp_port)" node "$HERE/lib/sentinels.mjs" verify "$RUN_DIR/sentinels/record-$runid.json" "$RUN_DIR/sentinels" 2>>"$LOG" \
    | tee -a "$LOG"
}

do_restart() {
  local n="$1"
  local dir="$RUN_DIR/restarts/r$n"
  mkdir -p "$dir"
  log "restart #$n: snapshot before"
  snapshot_panes > "$dir/panes-before.json" 2>>"$LOG"
  sentinel_record "r$n" > "$dir/sentinel-record.json" 2>>"$LOG"
  # let the PTY stream flush to the persisted history before the restart
  sleep 3
  log "restart #$n: systemctl --user restart $OPERATOR_UNIT"
  systemctl --user restart "$OPERATOR_UNIT" || log "WARN: restart failed"
  # wait for the app + CDP to come back on a fresh DevToolsActivePort
  local tries=0 port=""
  while [ $tries -lt 60 ]; do
    port="$(cdp_port)"
    if [ -n "$port" ] && curl -sf --max-time 2 "http://127.0.0.1:$port/json" >/dev/null 2>&1; then break; fi
    sleep 2; tries=$((tries + 1))
  done
  sleep 5
  log "restart #$n: snapshot after"
  snapshot_panes > "$dir/panes-after.json" 2>>"$LOG"
  sentinel_verify "r$n" > "$dir/sentinel-verify.json" 2>>"$LOG"
  python3 - "$dir" "$n" <<'PY'
import json, os, sys
d, n = sys.argv[1], sys.argv[2]
def load(p):
    try:
        return json.load(open(os.path.join(d, p)))
    except Exception:
        return {}
before, after = load("panes-before.json"), load("panes-after.json")
rec = {
    "restart": int(n),
    "paneCountBefore": before.get("paneCount"),
    "paneCountAfter": after.get("paneCount"),
    "panesRestored": before.get("paneCount") == after.get("paneCount"),
    "beforeTails": [p.get("tail") for p in before.get("panes", [])],
    "afterTails": [p.get("tail") for p in after.get("panes", [])],
}
json.dump(rec, open(os.path.join(d, "restart-summary.json"), "w"), indent=2)
print(json.dumps(rec))
PY
  log "restart #$n: done"
}

finalize() {
  log "finalizing: sampler report"
  local end baseline_arg
  end="$(iso)"
  baseline_arg=""
  if [ -f "$RUN_DIR/baseline.json" ]; then
    baseline_arg="--baseline-bytes $(python3 -c "import json;print(json.load(open('$RUN_DIR/baseline.json'))['rss_total_bytes'])")"
  fi
  python3 "$HERE/lib/sampler-report.py" \
    --samples "$SAMPLES" --config "$CONFIG" \
    --start "$(python3 -c "import json;print(json.load(open('$RUN_DIR/run-meta.json'))['startedAt'])")" \
    --end "$end" --outdir "$RUN_DIR" $baseline_arg >> "$LOG" 2>&1 || log "WARN: sampler report failed"
  log "finalized"
}

# ---- main ----
write_meta
log "soak harness start: run_dir=$RUN_DIR interval=${INTERVAL}s duration=${DURATION}s"
ensure_units
if ! wait_first_sample; then
  log "ERROR: no valid sampler sample within 120s — aborting"
  finalize
  exit 1
fi
log "first valid sample observed; baseline RSS = $(python3 -c "import json;print(json.load(open('$SAMPLER_STATE/current.json')).get('rss_total_bytes'))")"

START_EPOCH=$(date +%s)
tick_n=0
while true; do
  tick_n=$((tick_n + 1))
  tick "$tick_n"
  # probes every 5 ticks
  if [ $((tick_n % 5)) -eq 1 ]; then run_nav; run_evt; fi
  # control file
  if [ -s "$CONTROL" ]; then
    while IFS= read -r cmd; do
      case "$cmd" in
        restart) [ "$DO_RESTART" = 1 ] && do_restart "$(date +%s)" ;;
        sentinel-record) sentinel_record "manual-$(date +%s)" ;;
        sentinel-verify) sentinel_verify "manual-$(date +%s)" ;;
        baseline)
          cp "$SAMPLER_STATE/current.json" "$RUN_DIR/baseline.json" 2>/dev/null \
            && log "baseline recorded: $(python3 -c "import json;print(json.load(open('$RUN_DIR/baseline.json')).get('rss_total_bytes'))") bytes" \
            || log "WARN: baseline record failed" ;;
        mark\ *) log "OPERATOR MARK: ${cmd#mark }" ;;
        stop) log "stop requested"; finalize; exit 0 ;;
        "") ;;
        *) log "unknown control command: $cmd" ;;
      esac
    done < "$CONTROL"
    : > "$CONTROL"
  fi
  if [ "$DURATION" -gt 0 ] && [ $(( $(date +%s) - START_EPOCH )) -ge "$DURATION" ]; then
    log "duration reached"
    finalize
    exit 0
  fi
  sleep "$INTERVAL"
done

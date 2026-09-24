#!/usr/bin/env bash
# Demo C (plan Task 24): memory/CPU threshold simulation -> rollback.
# The Stage-B budgets are env-overridable so the pre-Stage-C gate can
# simulate a sustained breach against a REAL Orca instance. Phase C1 lowers
# the RSS budget and adds a real memory hog to the Orca cgroup; phase C2
# lowers the CPU sustained window and adds a real CPU hog. Both hogs are
# ordinary processes in the Orca scope, so the sampler aggregates them
# exactly as it would a real Orca leak.
set -euo pipefail
source "$(dirname "$0")/demo-common.sh"
OUT="$DEMO_DIR/demo-c-threshold-sim.log"
DROPIN_DIR="$HOME/.config/systemd/user/orca-workspace-watchdog.service.d"
DROPIN="$DROPIN_DIR/zz-demo-threshold.conf"
mkdir -p "$DROPIN_DIR"

# The sampler samples the UNIT cgroup directly (all members, any argv0) plus
# RC-prefix scope members. A foreign hog in the app scope is deliberately
# ignored, so the simulation hog goes in the unit cgroup to be aggregated.
unit_cgroup_path() {
  echo "/sys/fs/cgroup$(systemctl --user show orca-operator.service -p ControlGroup --value)/cgroup.procs"
}

spawn_hog() { # cmd... -> prints pid
  local procs; procs=$(unit_cgroup_path)
  "$@" >/dev/null 2>&1 &
  local pid=$!
  sleep 1
  echo "$pid" > "$procs" 2>/dev/null || true
  echo "$pid"
}

wait_rss_stable() { # max_wait_s
  local i=0 prev="" cur
  while [ "$i" -lt "$1" ]; do
    cur=$(python3 -c "import json;print(json.load(open('$STATE_DIR/current.json'))['rss_total_bytes'])")
    if [ -n "$prev" ] && [ $(( cur > prev ? cur - prev : prev - cur )) -lt 5242880 ]; then
      echo "  RSS stable at $(( cur / 1048576 )) MiB"; return 0
    fi
    prev="$cur"; sleep 10; i=$((i+10))
  done
  echo "  RSS did not fully stabilize; continuing"
}

phase() { # name envline hog_kind
  local name="$1" envline="$2" hog="$3"
  echo "## PHASE $name: $envline"
  printf '[Service]\n%s\n' "$envline" > "$DROPIN"
  systemctl --user daemon-reload
  printf 'orca\n' > "$SELECTOR"
  systemctl --user restart orca-workspace-watchdog.service
  sleep 12
  echo "  BEFORE: selector=$(cat "$SELECTOR")"
  local hogpid=""
  if [ "$hog" = "mem" ]; then
    hogpid=$(spawn_hog python3 -c "import time;a=bytearray(300*1024*1024);time.sleep(300)")
  elif [ "$hog" = "cpu" ]; then
    hogpid=$(spawn_hog yes)
  fi
  echo "  hog pid: $hogpid (in Orca scope)"
  wait_for_selector zellij 70 || true
  echo "  AFTER: selector=$(cat "$SELECTOR")"
  echo "  last_decision: $(cat "$STATE_DIR/last-decision.json" | tr -d '\n' | head -c 400)"
  breach_tail
  [ -n "$hogpid" ] && kill "$hogpid" 2>/dev/null || true
}

{
  echo "### DEMO C: memory/CPU threshold simulation -> rollback"
  echo "date: $(date -Is)"
  echo "## BEFORE"
  snapshot
  echo "## wait for RSS stability"
  wait_rss_stable 60
  phase "C1-RSS" "Environment=ORCA_WATCHDOG_RSS_BREACH_BYTES=52428800" mem
  phase "C2-CPU" "Environment=ORCA_WATCHDOG_CPU_SUSTAINED_SAMPLES=2
Environment=ORCA_WATCHDOG_CPU_SUSTAINED_CORES=0.5" cpu
  echo "## CLEANUP: remove threshold drop-in"
  rm -f "$DROPIN"
  systemctl --user daemon-reload
  echo "  drop-in removed: $(ls "$DROPIN" 2>/dev/null || echo yes)"
  echo "## journal excerpt"
  journal_excerpt
} 2>&1 | tee "$OUT"

#!/usr/bin/env bash
# Shared helpers for the Task 24 pre-Stage-C rollback demonstrations.
# All demos run the RC under Xvfb :99 (another worker holds the real desktop).
set -euo pipefail

STATE_DIR="${ORCA_WATCHDOG_STATE_DIR:-$HOME/.local/state/orca-workspace-watchdog}"
DEMO_DIR="$STATE_DIR/demo"
SELECTOR="$STATE_DIR/launcher-selector"
mkdir -p "$DEMO_DIR"

snapshot() {
  echo "  selector: $(cat "$SELECTOR" 2>/dev/null || echo '<missing>')"
  echo "  orca-operator: $(systemctl --user show orca-operator.service -p ActiveState --value) (MainPID $(systemctl --user show orca-operator.service -p MainPID --value))"
  echo "  watchdog: $(systemctl --user show orca-workspace-watchdog.service -p ActiveState --value) (MainPID $(systemctl --user show orca-workspace-watchdog.service -p MainPID --value))"
  echo "  heartbeat_age_s: $(python3 -c "import os,time;print(round(time.time()-os.stat('$STATE_DIR/heartbeat').st_mtime,1))" 2>/dev/null || echo missing)"
  echo "  last_decision: $(cat "$STATE_DIR/last-decision.json" 2>/dev/null | tr -d '\n' | head -c 400)"
}

pid_of_class() { # class
  python3 -c "import json;d=json.load(open('$STATE_DIR/current.json'));print([p for p,i in d['per_pid'].items() if i['class']=='$1'][0])"
}

proc_state() { # pid
  awk '{print $3}' "/proc/$1/stat" 2>/dev/null || echo gone
}

wait_for_selector() { # value timeout_s
  local want="$1" timeout="$2" i=0
  while [ "$i" -lt "$timeout" ]; do
    if [ "$(cat "$SELECTOR" 2>/dev/null)" = "$want" ]; then
      echo "  selector reached '$want' after ${i}s"
      return 0
    fi
    sleep 2; i=$((i+2))
  done
  echo "  TIMEOUT: selector did not reach '$want' within ${timeout}s"
  return 1
}

journal_excerpt() {
  journalctl --user -u orca-workspace-watchdog.service -u orca-workspace-fallback.service \
    -u orca-operator.service --since "-3 min" --no-pager 2>/dev/null | tail -25
}

breach_tail() {
  echo "  breaches.jsonl tail:"; tail -3 "$STATE_DIR/breaches.jsonl" 2>/dev/null | sed 's/^/    /'
  echo "  alerts.log tail:"; tail -2 "$STATE_DIR/alerts.log" 2>/dev/null | sed 's/^/    /'
}

reset_orca() {
  printf 'orca\n' > "$SELECTOR"
  systemctl --user restart orca-workspace-watchdog.service
  sleep 12
}

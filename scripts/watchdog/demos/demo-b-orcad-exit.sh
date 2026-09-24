#!/usr/bin/env bash
# Demo B (plan Task 24): orcad exit -> rollback.
# Kill the registered Orca daemon; the sampler must detect the missing
# required daemon and flip the selector. Also observes that a hosted PTY
# process in the Orca cgroup survives the rollback (the watchdog never kills).
set -euo pipefail
source "$(dirname "$0")/demo-common.sh"
OUT="$DEMO_DIR/demo-b-orcad-exit.log"
PTY_PID_FILE=/tmp/opencode/hosted-pty.pid
{
  echo "### DEMO B: orcad exit -> rollback"
  echo "date: $(date -Is)"
  echo "## BEFORE"
  snapshot
  ORCAD=$(pid_of_class orcad)
  echo "  orcad pid: $ORCAD  state: $(proc_state "$ORCAD")"
  if [ -f "$PTY_PID_FILE" ]; then
    PTY=$(cat "$PTY_PID_FILE")
    echo "  hosted PTY pid: $PTY  alive: $(kill -0 "$PTY" 2>/dev/null && echo yes || echo no)  cgroup: $(cat /proc/$PTY/cgroup 2>/dev/null)"
  fi
  echo "## TRIGGER: kill $ORCAD (orcad exit)"
  kill "$ORCAD"
  sleep 1
  echo "  orcad after kill: $(proc_state "$ORCAD")"
  echo "## WAIT for sustained breach (3 samples @10s)"
  wait_for_selector zellij 70 || true
  echo "## AFTER"
  snapshot
  breach_tail
  echo "## journal excerpt"
  journal_excerpt
  if [ -f "$PTY_PID_FILE" ]; then
    PTY=$(cat "$PTY_PID_FILE")
    echo "## PTY SURVIVAL: hosted PTY pid $PTY alive after rollback: $(kill -0 "$PTY" 2>/dev/null && echo YES || echo NO)"
    echo "  cgroup: $(cat /proc/$PTY/cgroup 2>/dev/null)"
  fi
} 2>&1 | tee "$OUT"

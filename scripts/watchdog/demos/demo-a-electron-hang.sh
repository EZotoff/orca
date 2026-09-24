#!/usr/bin/env bash
# Demo A (plan Task 24): forced Electron hang -> rollback.
# SIGSTOP the required Electron main; the sampler must detect the hung
# (state T) main as an independently observable failed health gate and flip
# the selector to zellij after the sustained-breach streak.
set -euo pipefail
source "$(dirname "$0")/demo-common.sh"
OUT="$DEMO_DIR/demo-a-electron-hang.log"
{
  echo "### DEMO A: forced Electron hang -> rollback"
  echo "date: $(date -Is)"
  echo "## BEFORE"
  snapshot
  MAIN=$(pid_of_class electron-main)
  echo "  electron-main pid: $MAIN  state: $(proc_state "$MAIN")"
  echo "## TRIGGER: kill -STOP $MAIN (forced hang)"
  kill -STOP "$MAIN"
  echo "  state after STOP: $(proc_state "$MAIN")"
  echo "## WAIT for sustained breach (3 samples @10s)"
  wait_for_selector zellij 70 || true
  echo "## AFTER"
  snapshot
  breach_tail
  echo "## journal excerpt"
  journal_excerpt
  echo "## RESTORE: kill -CONT $MAIN"
  kill -CONT "$MAIN"
  echo "  state after CONT: $(proc_state "$MAIN")"
} 2>&1 | tee "$OUT"

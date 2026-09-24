#!/usr/bin/env bash
# Demo D (plan Task 24 / Clause 3b): watchdog interruption -> OnFailure fallback.
# SIGSTOP the sampler (simulated hang). systemd WatchdogSec=30s kills it and
# fires OnFailure=orca-workspace-fallback.service, which atomically flips the
# selector to zellij. This is the mandatory pre-Stage-C gate: one of the two
# paths (systemd OnFailure or the Clause-3b health timer) MUST be demonstrated.
set -euo pipefail
source "$(dirname "$0")/demo-common.sh"
OUT="$DEMO_DIR/demo-d-watchdog-interruption.log"
{
  echo "### DEMO D: watchdog interruption -> OnFailure fallback"
  echo "date: $(date -Is)"
  echo "## BEFORE"
  snapshot
  SAMPLER=$(systemctl --user show orca-workspace-watchdog.service -p MainPID --value)
  echo "  sampler pid: $SAMPLER  state: $(proc_state "$SAMPLER")"
  echo "## TRIGGER: kill -STOP $SAMPLER (simulated sampler hang)"
  kill -STOP "$SAMPLER"
  echo "  state after STOP: $(proc_state "$SAMPLER")"
  echo "## WAIT for systemd WatchdogSec=30s to kill the sampler + OnFailure"
  wait_for_selector zellij 90 || true
  echo "## AFTER"
  snapshot
  echo "  fallback unit: $(systemctl --user show orca-workspace-fallback.service -p ActiveState -p Result --value | tr '\n' ' ')"
  breach_tail
  echo "## journal excerpt (watchdog timeout + OnFailure + fallback)"
  journalctl --user -u orca-workspace-watchdog.service -u orca-workspace-fallback.service \
    --since "-3 min" --no-pager 2>/dev/null | tail -30
} 2>&1 | tee "$OUT"

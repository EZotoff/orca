#!/usr/bin/env bash
# Install orca watchdog user units + scripts (plan Task 23).
# Renders @LIBDIR@ placeholders, copies scripts to ~/.local/lib/orca-watchdog,
# units to ~/.config/systemd/user/, then daemon-reloads. Does NOT enable or
# start anything (final state policy: installed + stopped).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LIBDIR="$HOME/.local/lib/orca-watchdog"
UNIT_DIR="$HOME/.config/systemd/user"

mkdir -p "$LIBDIR" "$UNIT_DIR"

install -m 0755 "$REPO_ROOT/scripts/watchdog/orca-workspace-sampler" "$LIBDIR/"
install -m 0755 "$REPO_ROOT/scripts/watchdog/orca-workspace-health" "$LIBDIR/"
install -m 0755 "$REPO_ROOT/scripts/watchdog/orca-workspace-fallback" "$LIBDIR/"
install -m 0644 "$REPO_ROOT/scripts/watchdog/orca_watchdog_lib.py" "$LIBDIR/"

for unit in orca-operator.service orca-workspace-watchdog.service \
            orca-workspace-health.service orca-workspace-health.timer \
            orca-workspace-fallback.service; do
  sed "s|@LIBDIR@|$LIBDIR|g" "$REPO_ROOT/systemd/user/$unit" > "$UNIT_DIR/$unit"
done

systemctl --user daemon-reload
echo "installed units to $UNIT_DIR (not enabled, not started):"
ls -1 "$UNIT_DIR"/orca-*.service "$UNIT_DIR"/orca-workspace-health.timer

#!/usr/bin/env bash
# Probe for a running Orca RC instance: window, process tree, version.
set -uo pipefail
RC_DIR="${1:?usage: rc-probe.sh <rc-dir>}"
echo "--- wmctrl windows matching Orca ---"
DISPLAY=:1 wmctrl -l | grep -i orca || echo "(none)"
echo "--- xdotool windows by name Orca ---"
DISPLAY=:1 xdotool search --name '^Orca$' 2>/dev/null || echo "(none)"
echo "--- process tree (RC dir) ---"
pgrep -af "$RC_DIR" || echo "(none)"
echo "--- process count ---"
pgrep -af "$RC_DIR" | grep -v 'pgrep\|rc-probe' | wc -l

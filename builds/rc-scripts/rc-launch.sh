#!/usr/bin/env bash
# Launch an Orca RC unpacked artifact on X11 with a scratch userData dir.
# Usage: rc-launch.sh <rc-dir> [tag]
set -uo pipefail
RC_DIR="${1:?usage: rc-launch.sh <rc-dir> [tag]}"
TAG="${2:-launch}"
LOG="$RC_DIR/${TAG}.log"
cd "$RC_DIR"
setsid env DISPLAY="${DISPLAY:-:1}" "$RC_DIR/orca-ide" --no-sandbox \
  --user-data-dir="$RC_DIR/scratch-userdata" </dev/null >"$LOG" 2>&1 &
echo "launched pid=$! tag=$TAG log=$LOG"

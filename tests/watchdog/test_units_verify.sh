#!/usr/bin/env bash
# systemd-analyze verify on the rendered unit files.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
TMP="$(mktemp -d /tmp/opencode/orca-wd-verify.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

LIBDIR="$HOME/.local/lib/orca-watchdog"
rc=0
for unit in orca-operator.service orca-workspace-watchdog.service \
            orca-workspace-health.service orca-workspace-health.timer \
            orca-workspace-fallback.service; do
  sed "s|@LIBDIR@|$LIBDIR|g" "$REPO_ROOT/systemd/user/$unit" > "$TMP/$unit"
  if out=$(systemd-analyze verify "$TMP/$unit" 2>&1); then
    echo "verify OK: $unit"
  else
    echo "verify FAIL: $unit"
    echo "$out"
    rc=1
  fi
done
exit $rc

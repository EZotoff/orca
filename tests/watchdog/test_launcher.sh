#!/usr/bin/env bash
# Unit tests for scripts/watchdog/orca-launcher (plan Task 24).
# The launcher reads the selector on EVERY invocation and refuses `orca`
# unless the watchdog heartbeat is current (<30 s).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAUNCHER="$HERE/../../scripts/watchdog/orca-launcher"
TMP="$(mktemp -d /tmp/opencode/orca-launcher-test.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

STATE="$TMP/state"
mkdir -p "$STATE"
export ORCA_WATCHDOG_STATE_DIR="$STATE"
export ORCA_WATCHDOG_SELECTOR_FILE="$STATE/launcher-selector"
export ORCA_LAUNCHER_MAX_HEARTBEAT_AGE=30

fail=0
check() { # name expected actual
  if [ "$2" = "$3" ]; then echo "ok: $1"; else echo "FAIL: $1 (expected '$2' got '$3')"; fail=1; fi
}

# 1. selector=orca + fresh heartbeat -> orca
printf 'orca\n' > "$STATE/launcher-selector"
touch "$STATE/heartbeat"
check "orca+fresh" "orca" "$("$LAUNCHER" --decide)"

# 2. selector=orca + stale heartbeat -> zellij
touch -d '2 minutes ago' "$STATE/heartbeat"
check "orca+stale" "zellij" "$("$LAUNCHER" --decide)"

# 3. selector=orca + missing heartbeat -> zellij
rm -f "$STATE/heartbeat"
check "orca+missing-heartbeat" "zellij" "$("$LAUNCHER" --decide)"

# 4. selector=zellij + fresh heartbeat -> zellij
printf 'zellij\n' > "$STATE/launcher-selector"
touch "$STATE/heartbeat"
check "zellij+fresh" "zellij" "$("$LAUNCHER" --decide)"

# 5. selector missing -> zellij
rm -f "$STATE/launcher-selector"
check "missing-selector" "zellij" "$("$LAUNCHER" --decide)"

# 6. selector=orca + fresh heartbeat -> launches ORCA_CMD
printf 'orca\n' > "$STATE/launcher-selector"
touch "$STATE/heartbeat"
ORCA_LAUNCHER_ORCA_CMD="touch $TMP/orca-launched" \
ORCA_LAUNCHER_ZELLIJ_CMD="touch $TMP/zellij-launched" \
  "$LAUNCHER"
[ -f "$TMP/orca-launched" ] && echo "ok: launch-orca" || { echo "FAIL: launch-orca"; fail=1; }
[ ! -f "$TMP/zellij-launched" ] && echo "ok: no-zellij-when-orca" || { echo "FAIL: no-zellij-when-orca"; fail=1; }

# 7. selector=orca + stale heartbeat -> launches ZELLIJ_CMD + records refusal
rm -f "$TMP/orca-launched" "$TMP/zellij-launched"
touch -d '2 minutes ago' "$STATE/heartbeat"
ORCA_LAUNCHER_ORCA_CMD="touch $TMP/orca-launched" \
ORCA_LAUNCHER_ZELLIJ_CMD="touch $TMP/zellij-launched" \
  "$LAUNCHER"
[ -f "$TMP/zellij-launched" ] && echo "ok: launch-zellij-on-refusal" || { echo "FAIL: launch-zellij-on-refusal"; fail=1; }
[ ! -f "$TMP/orca-launched" ] && echo "ok: no-orca-on-refusal" || { echo "FAIL: no-orca-on-refusal"; fail=1; }
grep -q "refused orca" "$STATE/launcher-refusals.log" && echo "ok: refusal-recorded" || { echo "FAIL: refusal-recorded"; fail=1; }

# 8. selector=zellij -> no refusal recorded (only orca refusals are logged)
rm -f "$STATE/launcher-refusals.log"
printf 'zellij\n' > "$STATE/launcher-selector"
touch "$STATE/heartbeat"
ORCA_LAUNCHER_ORCA_CMD="touch $TMP/orca-launched" \
ORCA_LAUNCHER_ZELLIJ_CMD="touch $TMP/zellij-launched" \
  "$LAUNCHER"
[ ! -f "$STATE/launcher-refusals.log" ] && echo "ok: no-refusal-when-zellij" || { echo "FAIL: no-refusal-when-zellij"; fail=1; }

exit $fail

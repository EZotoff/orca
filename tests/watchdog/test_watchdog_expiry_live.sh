#!/usr/bin/env bash
# Live watchdog-contract test on DISPOSABLE transient units (never the real
# operator/watchdog units): (1) a Type=notify unit that never pets is killed
# by systemd after WatchdogSec (Result=watchdog); (2) a unit that pets stays
# up past WatchdogSec. Requires a systemd user session.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! systemctl --user is-system-running >/dev/null 2>&1 \
   && [ "$(systemctl --user is-system-running 2>/dev/null || true)" != "running" ] \
   && [ "$(systemctl --user is-system-running 2>/dev/null || true)" != "degraded" ]; then
  echo "SKIP: no usable systemd user session"
  exit 0
fi

echo "systemd version: $(systemctl --version | head -1)"

# --- case 1: never pets -> systemd kills it (Result=watchdog) -------------
systemd-run --user --unit=orca-wd-test-nopet \
  --property=Type=notify --property=WatchdogSec=4s --property=RemainAfterExit=no \
  --collect /usr/bin/python3 "$HERE/notify_dummy.py" --pet no --duration 120 --interval 1 >/dev/null

result=""
for _ in $(seq 1 30); do
  sleep 1
  result=$(systemctl --user show orca-wd-test-nopet -p Result --value || true)
  [ "$result" = "watchdog" ] && break
done
state=""
for _ in $(seq 1 15); do
  state=$(systemctl --user show orca-wd-test-nopet -p ActiveState --value || true)
  [ "$state" = "failed" ] && break
  sleep 1
done
echo "nopet: Result=$result ActiveState=$state"
systemctl --user reset-failed orca-wd-test-nopet 2>/dev/null || true
if [ "$result" != "watchdog" ] || { [ "$state" != "failed" ] && [ "$state" != "inactive" ]; }; then
  echo "FAIL: expected Result=watchdog / failed"
  exit 1
fi

# --- case 2: pets every 2s with WatchdogSec=8 -> stays running -------------
systemd-run --user --unit=orca-wd-test-pet \
  --property=Type=notify --property=WatchdogSec=8s \
  --collect /usr/bin/python3 "$HERE/notify_dummy.py" --pet yes --duration 15 --interval 2 >/dev/null
sleep 12
state=$(systemctl --user show orca-wd-test-pet -p ActiveState --value || true)
wdt=$(systemctl --user show orca-wd-test-pet -p WatchdogTimestamp --value || true)
echo "pet: ActiveState=$state WatchdogTimestamp=$wdt"
systemctl --user stop orca-wd-test-pet 2>/dev/null || true
systemctl --user reset-failed orca-wd-test-pet 2>/dev/null || true
if [ "$state" != "active" ] || [ -z "$wdt" ]; then
  echo "FAIL: expected petting unit to stay active with a WatchdogTimestamp"
  exit 1
fi

echo "PASS: watchdog contract (expiry kills, petting sustains)"

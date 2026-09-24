#!/usr/bin/env bash
# Run all orca-watchdog tests: unit verify, sampler/health unit tests,
# live watchdog-contract test on disposable transient units.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

bash "$HERE/test_units_verify.sh"
bash "$HERE/test_launcher.sh"
python3 "$HERE/test_sampler.py"
python3 "$HERE/test_health.py"
bash "$HERE/test_watchdog_expiry_live.sh"
echo "ALL ORCA-WATCHDOG TESTS PASSED"

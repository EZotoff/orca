#!/usr/bin/env bash
# Build the Orca unpacked RC with the pinned durable toolchain.
# Usage: rc-build.sh <logfile> [worktree]
set -uo pipefail
LOG="${1:?usage: rc-build.sh <logfile> [worktree]}"
WORKTREE="${2:-/home/ezotoff/src/orca-rc}"
export PATH=/home/ezotoff/.local/share/orca-toolchain/node-v24.9.0-linux-x64/bin:/home/ezotoff/.local/share/orca-toolchain/pnpm-12.0.0:$PATH
cd "$WORKTREE"
{
  echo "=== orca RC build $(date -Is) ==="
  echo "WORKTREE: $WORKTREE"
  echo "HEAD: $(git rev-parse HEAD)"
  echo "node: $(node --version) ($(which node))"
  echo "pnpm: $(pnpm --version) ($(which pnpm))"
  echo "--- pnpm install --frozen-lockfile ---"
  pnpm install --frozen-lockfile
  echo "INSTALL_EXIT=$?"
  echo "--- pnpm run build:unpack ---"
  pnpm run build:unpack
  echo "EXIT=$?"
  date -Is
} > "$LOG" 2>&1

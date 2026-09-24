#!/usr/bin/env bash
# Snapshot a userData profile, delete it, restore from the tarball, and prove
# byte-identity of the restored tree.
# Usage: rc-userdata-restore-diff.sh <profile-dir> <tarball> [workdir]
set -uo pipefail
PROFILE="${1:?usage: rc-userdata-restore-diff.sh <profile-dir> <tarball> [workdir]}"
TARBALL="${2:?}"
WORKDIR="${3:-/tmp/opencode}"
PARENT="$(dirname "$PROFILE")"; NAME="$(basename "$PROFILE")"
manifest() {
  ( cd "$PARENT" && \
    find "$NAME" -type d -printf 'D %p\n' | sort && \
    find "$NAME" -type f -print0 | sort -z | xargs -0 sha256sum | sed 's/^/F /' && \
    find "$NAME" -type l -printf 'L %p -> %l\n' | sort )
}
echo "== profile: $PROFILE"
echo "== tarball: $TARBALL"
echo "-- files before: $(find "$PROFILE" -type f | wc -l), dirs: $(find "$PROFILE" -type d | wc -l)"
tar czf "$TARBALL" -C "$PARENT" "$NAME"
echo "-- tarball size: $(du -h "$TARBALL" | cut -f1)"
manifest > "$WORKDIR/ud-before.txt"
rm -rf "$PROFILE"
test ! -e "$PROFILE" && echo "-- deleted OK"
tar xzf "$TARBALL" -C "$PARENT"
manifest > "$WORKDIR/ud-after.txt"
if diff -q "$WORKDIR/ud-before.txt" "$WORKDIR/ud-after.txt" >/dev/null; then
  echo "RESTORE_DIFF=IDENTICAL ($(wc -l < "$WORKDIR/ud-before.txt") entries)"
else
  echo "RESTORE_DIFF=DIFFERS"; diff "$WORKDIR/ud-before.txt" "$WORKDIR/ud-after.txt" | head -20
fi

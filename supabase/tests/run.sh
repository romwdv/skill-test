#!/usr/bin/env bash
# Runs every test file against a freshly migrated database.
# Usage: tests/run.sh [test-glob]   (default: t*.sql)

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
source ./lib.sh

trap db_stop EXIT

target="${1:-t*.sql}"

db_init
db_reset
db_apply_migrations

failures=0
for f in ./$target; do
  printf '== %s\n' "$(basename "$f")"
  case "$f" in
    *.sh) if ! bash "$f"; then
            echo "FAILED: $f" >&2
            failures=$((failures + 1))
          fi ;;
    *)    if ! "${PSQL[@]}" -d "$PGDATABASE" -f "$f"; then
            echo "FAILED: $f" >&2
            failures=$((failures + 1))
          fi ;;
  esac
done

if [ "$failures" -ne 0 ]; then
  echo "$failures test file(s) failed" >&2
  exit 1
fi
echo "All test files passed."
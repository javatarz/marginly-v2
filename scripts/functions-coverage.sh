#!/usr/bin/env bash
#
# CODING_STANDARDS.md §3: 100% branch coverage for the pure seams. vitest.config.ts
# enforces that on the Next.js side; `deno coverage` has no threshold flag of its
# own, so this reads its lcov output and fails on anything under the bar. Only files
# a test actually loads are measured, which is what leaves the thin adapters — the
# `Deno.serve` entrypoints — out of it, as the standard asks.

set -euo pipefail

CONFIG=supabase/functions/deno.json
ROOT=supabase/functions
PROFILE=$(mktemp -d)

trap 'rm -rf "$PROFILE"' EXIT

deno test --config "$CONFIG" --coverage="$PROFILE" "$ROOT"

deno coverage "$PROFILE" --exclude='_test\.ts$' --lcov \
  --output="$PROFILE/coverage.lcov" >/dev/null

under_bar=$(awk -F'[:,]' '
  /^SF:/ { file = $2 }
  /^LF:/ { found["line"] = $2 }
  /^LH:/ { hit["line"] = $2 }
  /^FNF:/ { found["function"] = $2 }
  /^FNH:/ { hit["function"] = $2 }
  /^BRF:/ { found["branch"] = $2 }
  /^BRH:/ { hit["branch"] = $2 }
  /^end_of_record$/ {
    for (kind in found) {
      if (hit[kind] < found[kind]) {
        printf "%s: %d of %d %ss covered\n", file, hit[kind], found[kind], kind
      }
    }
    delete found
    delete hit
  }
' "$PROFILE/coverage.lcov")

if [[ -n "$under_bar" ]]; then
  echo "Coverage is under 100%:" >&2
  sed 's/^/  /' >&2 <<<"$under_bar"
  exit 1
fi

echo "Deno coverage is at 100% of lines, functions and branches."

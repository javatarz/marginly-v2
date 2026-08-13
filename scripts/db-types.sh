#!/usr/bin/env bash
#
# The generated schema types, checked in and gated.
#
# ADR-0013: types are generated from the local stack into src/lib/database.types.ts
# and committed, so a clean checkout typechecks without a database. `check` fails
# on a stale diff rather than regenerating silently, which is what makes a
# migration and its types move together.
#
#   scripts/db-types.sh generate   rewrite the checked-in file
#   scripts/db-types.sh check      fail if the checked-in file is stale

set -euo pipefail

MODE="${1:-check}"
TARGET="src/lib/database.types.ts"

case "$MODE" in
generate | check) ;;
*)
  echo "usage: scripts/db-types.sh [generate|check]" >&2
  exit 2
  ;;
esac

FRESH="$(mktemp)"
trap 'rm -f "$FRESH"' EXIT

# The generator resolves the password from the environment rather than from the
# running stack, so this sets up its own pre-state: the local stack's superuser
# password is always the CLI's published default. Deliberately not honouring an
# inherited value — a shell or .env.local carrying a *linked project's* password
# would break the gate on a machine where it happens to be exported.
export SUPABASE_DB_PASSWORD="postgres"

if ! supabase gen types typescript --local >"$FRESH" 2>"$FRESH.err"; then
  echo "Could not generate database types from the local stack." >&2
  echo "Start it first:  supabase start" >&2
  sed 's/^/  /' "$FRESH.err" >&2
  rm -f "$FRESH.err"
  exit 1
fi
rm -f "$FRESH.err"

if [[ "$MODE" == "generate" ]]; then
  mkdir -p "$(dirname "$TARGET")"
  mv "$FRESH" "$TARGET"
  echo "Wrote $TARGET from the local stack."
  exit 0
fi

if [[ ! -f "$TARGET" ]]; then
  echo "$TARGET is missing. Generate it:  npm run db:types" >&2
  exit 1
fi

if ! diff -u "$TARGET" "$FRESH" --label "$TARGET (checked in)" --label "$TARGET (from migrations)"; then
  echo >&2
  echo "$TARGET is stale: the migrations describe a different schema." >&2
  echo "Regenerate and commit it alongside the migration:  npm run db:types" >&2
  exit 1
fi

echo "$TARGET matches the migrations."

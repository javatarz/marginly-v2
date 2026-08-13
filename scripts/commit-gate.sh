#!/usr/bin/env bash
#
# Everything that must be true before a commit, in one command.
#
# ADR-0013 makes `npm run verify` the only gate, and there is no pull request behind it.
# What verify cannot see is a migration that has never run: it compares the checked-in
# types against the schema, so SQL that changes no schema — a backfill, a grant, a data
# fix — is invisible to it and would first fail during `supabase db push` in production.
# So this replays every migration from an empty database first.
#
# A reset drops local data, which is why it is not folded into verify itself: verify runs
# constantly, this runs before a commit.
#
#   npm run gate

set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> supabase db reset (every migration, from empty)"
supabase db reset

echo
echo "==> npm run verify"
npm run verify

echo
echo "Gate passed. Safe to commit."

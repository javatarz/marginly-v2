#!/usr/bin/env bash
#
# CODING_STANDARDS.md §1: no secret credential reaches the Next.js runtime, and
# no key of any kind is hardcoded anywhere. This gate reads the tree the way a
# leak would look in it — a service key named or reached for in app code, or key
# material sitting in a source file.

set -euo pipefail

# Directories, not named files: grep exits 2 for a path that does not exist, and an
# absent path would otherwise make this gate report nothing at all. `src` covers the
# app, `middleware.ts` lives at the root beside next.config.ts, and both are scanned by
# scanning the root non-recursively.
APP_PATHS=(src)
KEY_PATHS=(src supabase/functions)
ROOT_FILES=(middleware.ts next.config.ts)

status=0

report() {
  status=1
  echo "$1" >&2
  sed 's/^/  /' >&2
}

# grep's exit codes: 0 found, 1 none, 2 an error such as a missing path. Only 1 means
# "clean", so anything else is either a hit to report or a fault to fail on.
scan() {
  local pattern="$1" description="$2"
  shift 2

  local hits exit_code=0
  hits=$(grep -rniE "$pattern" "$@" 2>&1) || exit_code=$?

  case "$exit_code" in
  0) report "$description" <<<"$hits" ;;
  1) ;;
  *)
    report "Could not scan for a leak (grep exit $exit_code):" <<<"$hits"
    ;;
  esac
}

# The service key must never be named by the app. Edge Functions may hold secrets;
# the Next.js runtime may not.
#
# src/lib/env.ts exists to *refuse* a service key, so it names one, and its tests name
# one back. They are the only place in the app allowed to say the words; the
# key-material scan below still covers them.
scan 'service[_-]?role|serviceRole' \
  "A service key is referenced in application code:" \
  --exclude=env.ts --exclude=env.test.ts \
  "${APP_PATHS[@]}" "${ROOT_FILES[@]}"

# Key material itself, on either side of the boundary. Secrets are read from the
# environment, never written down.
scan 'sb_secret_[A-Za-z0-9]{16,}|eyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}' \
  "Key material is hardcoded:" \
  "${KEY_PATHS[@]}" "${ROOT_FILES[@]}"

if [[ $status -eq 0 ]]; then
  echo "No service key and no hardcoded key material."
fi

exit $status

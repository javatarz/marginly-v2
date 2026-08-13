#!/usr/bin/env bash
#
# CODING_STANDARDS.md §1: no secret credential reaches the Next.js runtime, and
# no key of any kind is hardcoded anywhere. This gate reads the tree the way a
# leak would look in it — a service key named or reached for in app code, or key
# material sitting in a source file.

set -euo pipefail

APP_PATHS=(src next.config.ts)
KEY_PATHS=(src supabase/functions)

# src/lib/env.ts exists to *refuse* a service key, so it names one, and its tests
# name one back. They are the only place in the app allowed to say the words; the
# key-material scan below still covers them.
NAME_EXCEPTIONS=(src/lib/env.ts src/lib/env.test.ts)

status=0

report() {
  status=1
  echo "$1" >&2
  sed 's/^/  /' >&2
}

exclude_args=()
for path in "${NAME_EXCEPTIONS[@]}"; do
  exclude_args+=(--exclude "$(basename "$path")")
done

# The service key must never be named by the app. Edge Functions may hold secrets;
# the Next.js runtime may not.
if hits=$(grep -rniE 'service[_-]?role|serviceRole' "${exclude_args[@]}" "${APP_PATHS[@]}" 2>/dev/null); then
  report "A service key is referenced in application code:" <<<"$hits"
fi

# Key material itself, on either side of the boundary. Secrets are read from the
# environment, never written down.
if hits=$(grep -rnE 'sb_secret_[A-Za-z0-9]{16,}|eyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}' "${KEY_PATHS[@]}" 2>/dev/null); then
  report "Key material is hardcoded:" <<<"$hits"
fi

if [[ $status -eq 0 ]]; then
  echo "No service key and no hardcoded key material."
fi

exit $status

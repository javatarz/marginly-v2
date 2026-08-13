#!/usr/bin/env bash
#
# Build, serve and smoke-check the app against the local stack, in one process.
#
# The app's two settings are NEXT_PUBLIC_*, which Next **inlines at build time** — the
# middleware runs in the Edge runtime, where nothing reads process.env at request time.
# So they have to be present for `next build`, not just for `next start`, and a value
# exported in some earlier shell is no use at all.
#
# This reads them from the running stack itself and holds them for every step, so the
# procedure sets up its own pre-state instead of depending on the operator's shell.
#
# It also applies every pending migration before building — a launch command that skips
# this can serve a stale schema against current code, and the failure stays silent until
# someone happens to exercise the path that needed the missing table or grant.
#
# It stops and restarts the stack first, unconditionally — a long-lived edge-runtime
# container can keep serving an old function's code (e.g. one since renamed) after a
# `supabase functions` change, with no error until someone hits that path. Restarting
# is the only way to guarantee the container matches what's on disk.
#
#   npm run app:local
#
# Environment:
#   PORT   port to serve on (default 3000)

set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> supabase stop / start  (fresh containers, so edge functions can't be stale)"
supabase stop
supabase start

if ! status=$(supabase status --output json 2>/dev/null); then
  echo "The local stack did not come up after supabase start." >&2
  exit 1
fi

read_status() {
  node -e "process.stdout.write(String(JSON.parse(process.argv[1])['$1'] ?? ''))" "$status"
}

NEXT_PUBLIC_SUPABASE_URL="$(read_status API_URL)"
NEXT_PUBLIC_SUPABASE_ANON_KEY="$(read_status ANON_KEY)"
export NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY

if [[ -z "$NEXT_PUBLIC_SUPABASE_URL" || -z "$NEXT_PUBLIC_SUPABASE_ANON_KEY" ]]; then
  echo "The local stack reported no API_URL or ANON_KEY." >&2
  exit 1
fi

echo "==> supabase migration up  (every pending migration, against the running stack)"
supabase migration up

echo
echo "==> supabase db query --file supabase/seed.sql  (idempotent: re-applies seed.sql, which"
echo "    otherwise only runs on db reset — see seed.sql's own comment — so a migration that"
echo "    creates a role here, on a stack running since before that migration existed, would"
echo "    otherwise leave the role without the password seed.sql sets)"
supabase db query --local --file supabase/seed.sql

echo
echo "==> next build  (against $NEXT_PUBLIC_SUPABASE_URL)"
npm run build

echo
echo "==> restart"
bash scripts/restart-app.sh

echo
echo "==> smoke"
npm run smoke

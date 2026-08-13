#!/usr/bin/env bash
#
# The only path to a deployed change (ADR-0013).
#
# In order: the verify gate, the migrations, the Edge Functions, the production
# build, the restart. A human runs it today; a CI pipeline calls it unchanged —
# so it takes no input, prompts for nothing, and stops at the first failure.
#
# Environment:
#   SUPABASE_PROJECT_REF   linked project to push to (optional; falls back to the
#                          ref recorded by `supabase link`)
#   RESTART_CMD            how to restart the app after the build. Defaults to the
#                          local pid-file restart in scripts/restart-app.sh; a
#                          pipeline sets this to its own rollout command.
#   EDGE_DB_URL            the same connection string an operator already put in
#                          this Edge Function's secret via `supabase secrets set
#                          EDGE_DB_URL=...`. This script is the single place that
#                          reads it, so it is also the single place that can set
#                          the deployed `edge_functions` Postgres role's password
#                          to match — see the "sync edge_functions role password"
#                          step below and issue #40.

set -euo pipefail

cd "$(dirname "$0")/.."

step() {
  echo
  echo "==> $*"
}

PROJECT_REF_ARGS=()
if [[ -n "${SUPABASE_PROJECT_REF:-}" ]]; then
  PROJECT_REF_ARGS=(--project-ref "$SUPABASE_PROJECT_REF")
fi

step "verify"
npm run verify

step "supabase config push"
# The auth settings and the magic-link template live in supabase/config.toml, and
# `db push` does not carry them. Without this the linked project keeps the default
# template, whose link is a PKCE `?code=` that /auth/confirm refuses — so every magic
# link in production would fail, and ADR-0001's "no sign-up" would never be applied.
supabase config push "${PROJECT_REF_ARGS[@]}"

step "supabase db push"
supabase db push "${PROJECT_REF_ARGS[@]}" --yes

step "sync edge_functions role password"
# 20260813200001_upload_a_version.sql creates `edge_functions` with no password —
# correct, since `db push` sends a migration's SQL to production verbatim — but that
# leaves nothing setting a real one there. EDGE_DB_URL is the operator's own secret
# (never printed, never written to disk); reading its password out and pushing it
# into the role here means both sides come from the one value the operator already
# holds, so they cannot drift apart the way #40 found them (see docs/adr/0013).
if [[ -z "${EDGE_DB_URL:-}" ]]; then
  echo "EDGE_DB_URL is not set. It must hold the same connection string already set" >&2
  echo "on the Edge Function's EDGE_DB_URL secret, so this step can set a matching" >&2
  echo "password on the deployed edge_functions role." >&2
  exit 1
fi
EDGE_FUNCTIONS_PASSWORD="$(node -e '
  const password = new URL(process.argv[1]).password;
  if (!password) {
    console.error("EDGE_DB_URL has no password component.");
    process.exit(1);
  }
  process.stdout.write(decodeURIComponent(password));
' "$EDGE_DB_URL")"
EDGE_FUNCTIONS_PASSWORD_SQL="${EDGE_FUNCTIONS_PASSWORD//\'/\'\'}"
supabase db query --linked "alter role edge_functions with password '$EDGE_FUNCTIONS_PASSWORD_SQL';"
unset EDGE_FUNCTIONS_PASSWORD EDGE_FUNCTIONS_PASSWORD_SQL

step "supabase functions deploy"
supabase functions deploy "${PROJECT_REF_ARGS[@]}"

step "next build"
# Next inlines NEXT_PUBLIC_* at build time, and the middleware runs in the Edge runtime
# where nothing reads the environment per request. A build without these produces an app
# that throws on every request, so it is refused here rather than deployed.
for required in NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY; do
  if [[ -z "${!required:-}" ]]; then
    echo "$required is not set, and it is needed at build time, not just at run time." >&2
    exit 1
  fi
done
npm run build

step "restart"
eval "${RESTART_CMD:-bash scripts/restart-app.sh}"

step "smoke"
# Against a running app, so it belongs here rather than in verify: a deploy that builds
# and restarts and then cannot sign anyone in has not succeeded.
npm run smoke

echo
echo "Deployed."

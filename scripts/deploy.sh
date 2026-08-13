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

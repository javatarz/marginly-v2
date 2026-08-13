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

step "supabase db push"
supabase db push "${PROJECT_REF_ARGS[@]}" --yes

step "supabase functions deploy"
supabase functions deploy "${PROJECT_REF_ARGS[@]}"

step "next build"
npm run build

step "restart"
eval "${RESTART_CMD:-bash scripts/restart-app.sh}"

echo
echo "Deployed."

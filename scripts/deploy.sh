#!/usr/bin/env bash
# Деплой всех Edge Functions (нужен `npx supabase login`).
set -euo pipefail
cd "$(dirname "$0")/.."
npx -y supabase functions deploy --project-ref "${SUPABASE_PROJECT_REF:?set SUPABASE_PROJECT_REF}" --use-api "$@"

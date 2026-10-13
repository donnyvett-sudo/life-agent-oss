#!/usr/bin/env bash
# Использование: scripts/set-secret.sh GEMINI_API_KEY   (значение вводится скрыто)
set -euo pipefail
NAME=${1:?укажи имя секрета}
read -rsp "$NAME: " VAL; echo
npx -y supabase secrets set --project-ref "${SUPABASE_PROJECT_REF:?set SUPABASE_PROJECT_REF}" "$NAME=$VAL"

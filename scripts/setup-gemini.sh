#!/usr/bin/env bash
# Сохраняет ключ Gemini (Google AI Studio) в секреты Supabase.
# Ключ берётся из буфера обмена (или вводится скрыто), проверяется, нигде не печатается.
set -euo pipefail
cd "$(dirname "$0")/.."
REF=${SUPABASE_PROJECT_REF:?set SUPABASE_PROJECT_REF}
# Старые ключи — AIza…, новые — другого вида; формат проверяем мягко, валидность — запросом к Google.
KEY_RE='^[A-Za-z0-9._-]{30,}$'

KEY=$(pbpaste 2>/dev/null | tr -d '[:space:]' || true)
if [[ "$KEY" =~ $KEY_RE ]]; then
  echo "Ключ взят из буфера обмена."
else
  read -rsp "Gemini API key: " KEY || { echo "В буфере нет ключа, а ввести его здесь нельзя." >&2; exit 1; }
  echo
  KEY=$(printf %s "$KEY" | tr -d '[:space:]')
fi
[[ "$KEY" =~ $KEY_RE ]] || { echo "Это не похоже на ключ Gemini." >&2; exit 1; }

MODELS=$(curl -sS -m 20 -H "x-goog-api-key: $KEY" \
  "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200" \
  | grep -o '"name": *"models/gemini-[0-9.]*-flash[^"]*"' | sed 's/.*models\///; s/"$//' | sort -u)
[[ -n "$MODELS" ]] || { echo "Google не принял ключ (или нет доступа — VPN?)." >&2; exit 1; }
echo "Доступные flash-модели:"; echo "$MODELS" | sed 's/^/  /'

npx -y supabase secrets set --project-ref "$REF" GEMINI_API_KEY="$KEY"
printf '' | pbcopy 2>/dev/null || true
echo "Готово. Буфер обмена очищен."

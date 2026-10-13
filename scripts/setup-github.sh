#!/usr/bin/env bash
# Сохраняет personal access token GitHub в секреты Supabase (блок «Код» во вкладке «Дело»).
# Токен берётся из буфера обмена (или вводится скрыто), проверяется, нигде не печатается.
# Нужен classic token со scope read:user — граф контрибуций отдаётся только по нему.
set -euo pipefail
cd "$(dirname "$0")/.."
REF=${SUPABASE_PROJECT_REF:?set SUPABASE_PROJECT_REF}
TOKEN_RE='^(ghp_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})$'

TOKEN=$(pbpaste 2>/dev/null | tr -d '[:space:]' || true)
if [[ "$TOKEN" =~ $TOKEN_RE ]]; then
  echo "Токен взят из буфера обмена."
else
  read -rsp "GitHub token: " TOKEN || { echo "В буфере нет токена, а ввести его здесь нельзя." >&2; exit 1; }
  echo
  TOKEN=$(printf %s "$TOKEN" | tr -d '[:space:]')
fi
[[ "$TOKEN" =~ $TOKEN_RE ]] || { echo "Это не похоже на токен GitHub (ghp_… или github_pat_…)." >&2; exit 1; }

# Проверяем тем же запросом, которым ходит бот: viewer + граф контрибуций.
RESP=$(curl -sS -m 20 -X POST https://api.github.com/graphql \
  -H "authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{"query":"{ viewer { login contributionsCollection { contributionCalendar { totalContributions } } } }"}')
LOGIN=$(printf %s "$RESP" | grep -o '"login":"[^"]*"' | head -1 | sed 's/.*:"//; s/"$//')
TOTAL=$(printf %s "$RESP" | grep -o '"totalContributions":[0-9]*' | head -1 | sed 's/.*://')
[[ -n "$LOGIN" ]] || { echo "GitHub не принял токен: $(printf %s "$RESP" | head -c 300)" >&2; exit 1; }
echo "Аккаунт $LOGIN, контрибуций за год: ${TOTAL:-0}."

npx -y supabase secrets set --project-ref "$REF" GITHUB_TOKEN="$TOKEN"
printf '' | pbcopy 2>/dev/null || true
echo "Готово. Буфер обмена очищен."

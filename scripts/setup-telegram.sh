#!/usr/bin/env bash
# Сохраняет токен бота в секреты Supabase и привязывает webhook.
# Токен берётся из буфера обмена (скопируй его у @BotFather перед запуском),
# либо вводится скрыто. Нигде не печатается; буфер после этого очищается.
set -euo pipefail
cd "$(dirname "$0")/.."
REF=${SUPABASE_PROJECT_REF:?set SUPABASE_PROJECT_REF}
TOKEN_RE='^[0-9]+:[A-Za-z0-9_-]{30,}$'
# Окно терминала может закрыться сразу после выхода — держим его открытым.
trap 'rc=$?; [[ $rc -ne 0 ]] && echo "ОШИБКА (код $rc) на шаге: $STEP" >&2; read -rp "Enter — закрыть " _' EXIT
STEP="чтение токена"

TG=$(pbpaste 2>/dev/null | tr -d '[:space:]' || true)
if [[ "$TG" =~ $TOKEN_RE ]]; then
  echo "Токен взят из буфера обмена."
else
  read -rsp "Telegram bot token (от @BotFather): " TG; echo
  TG=$(printf %s "$TG" | tr -d '[:space:]')
fi
[[ "$TG" =~ $TOKEN_RE ]] || { echo "Это не похоже на токен бота." >&2; exit 1; }

STEP="проверка токена в Telegram (api.telegram.org доступен? VPN?)"
BOT=$(curl -sS -m 20 "https://api.telegram.org/bot$TG/getMe" | sed -n 's/.*"username":"\([^"]*\)".*/\1/p')
[[ -n "$BOT" ]] || { echo "Telegram не принял токен." >&2; exit 1; }
echo "Бот: @$BOT"

WH=$(openssl rand -hex 32)
STEP="сохранение секретов в Supabase"
npx -y supabase secrets set --project-ref "$REF" \
  TELEGRAM_BOT_TOKEN="$TG" TELEGRAM_WEBHOOK_SECRET="$WH"

STEP="установка webhook"
curl -sS -m 20 "https://api.telegram.org/bot$TG/setWebhook" \
  --data-urlencode "url=https://$REF.supabase.co/functions/v1/telegram-bot" \
  --data-urlencode "secret_token=$WH" \
  --data-urlencode 'allowed_updates=["message","callback_query"]' \
  --data-urlencode "drop_pending_updates=true"
echo
printf '' | pbcopy 2>/dev/null || true
echo "Готово. Буфер обмена очищен."

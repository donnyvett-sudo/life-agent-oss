#!/usr/bin/env bash
# Сохраняет личный токен (из /shortcut в боте) для tools/life_sync.py в Study Agent.
# Токен берётся из буфера обмена, не печатается; буфер после этого очищается.
set -euo pipefail
TOKEN=$(pbpaste 2>/dev/null | tr -d '[:space:]' || true)
[[ "$TOKEN" =~ ^[0-9a-f]{48}$ ]] || { echo "В буфере нет токена (48 символов 0-9a-f). Скопируй его из /shortcut." >&2; exit 1; }
mkdir -p ~/.config/life-agent
umask 077
printf '%s' "$TOKEN" > ~/.config/life-agent/token
chmod 600 ~/.config/life-agent/token
printf '' | pbcopy
echo "Токен сохранён в ~/.config/life-agent/token. Буфер обмена очищен."

#!/usr/bin/env bash
# Build the Mini App and publish the static files to a (public) GitHub Pages repo.
# Needs: MINIAPP_REPO=<user>/<pages-repo>, VITE_API_URL, and `gh auth login`.
# The build contains no secrets: auth is Telegram initData checked by the backend.
set -euo pipefail
cd "$(dirname "$0")/../miniapp"
REPO=${MINIAPP_REPO:?set MINIAPP_REPO=<user>/<pages-repo>}
: "${VITE_API_URL:?set VITE_API_URL=https://<ref>.supabase.co/functions/v1/api}"
export MINIAPP_BASE="/${REPO#*/}/"
SRC_SHA=$(git rev-parse --short HEAD 2>/dev/null || echo local)

npm ci --no-fund --no-audit >/dev/null 2>&1 || npm install --no-fund --no-audit >/dev/null
npm run build

OUT=$(mktemp -d)
cp -R dist/. "$OUT"
touch "$OUT/.nojekyll"
cp "$OUT/index.html" "$OUT/404.html"
cd "$OUT"
git init -q -b main
git add -A
git commit -q -m "Deploy life-agent@$SRC_SHA"
git -c credential.helper= -c 'credential.helper=!gh auth git-credential' \
  push -q -f "https://github.com/$REPO.git" main
rm -rf "$OUT"
echo "Published: https://${REPO%/*}.github.io/${REPO#*/}/"

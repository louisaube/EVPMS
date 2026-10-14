#!/usr/bin/env bash
# Tests de navigateur du lot en cours contre le studio construit (vite preview, port 5173) et l'API de test.
# Usage : bash scripts/e2e.sh   (lit E2E_FILES dans .run/lot.env ; sans fichier, tout acceptance/e2e)
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FILES=""
[ -f "$ROOT/.run/lot.env" ] && . "$ROOT/.run/lot.env" && for f in $E2E_FILES; do [ -f "$ROOT/acceptance/$f" ] && FILES="$FILES $f"; done
[ -f "$ROOT/.run/lot.env" ] && [ -z "$FILES" ] && { echo "no browser test for this lot"; exit 0; }
command -v fuser >/dev/null && fuser -k 5173/tcp >/dev/null 2>&1
(cd "$ROOT/studio" && pnpm -s build >/dev/null && (nohup npx vite preview --port 5173 --strictPort > "$ROOT/.run/preview.log" 2>&1 &)) || { echo "studio build failed"; exit 2; }
sleep 4
cd "$ROOT/acceptance" && npx playwright test -c e2e/playwright.config.ts $FILES

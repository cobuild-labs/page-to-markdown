#!/usr/bin/env bash
# Builds dist/page-to-markdown-vX.Y.Z.zip, ready to load unpacked or upload to the Chrome Web Store.
set -euo pipefail
cd "$(dirname "$0")/.."
node scripts/check.mjs
VERSION=$(node -p "require('./extension/manifest.json').version")
mkdir -p dist
OUT="dist/page-to-markdown-v${VERSION}.zip"
rm -f "$OUT"
(cd extension && zip -qr -X "../$OUT" . -x '.*' -x '__MACOSX')
echo "Built $OUT"

#!/usr/bin/env bash
# Build the packaged app and install it into /Applications on this Mac.
# Usage: npm run install:local [-- --launch]
set -euo pipefail
cd "$(dirname "$0")/.."
APP_NAME="MTGA Draft Assistant"
if pgrep -f "/Applications/${APP_NAME}.app/Contents/MacOS/" >/dev/null; then
  echo "${APP_NAME} is running; quit it first (menu bar → Quit)." >&2
  exit 1
fi
npm run typecheck
npm test
npm run build
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --arm64 --dir
OUT="release/mac-arm64/${APP_NAME}.app"
test -x "${OUT}/Contents/Resources/native/arena-window-watch"
test -f "${OUT}/Contents/Resources/draftfm/sets/index.json" || echo "warning: no set bundle index" >&2
test -f "${OUT}/Contents/Resources/app.asar.unpacked/node_modules/onnxruntime-node/bin/napi-v6/darwin/arm64/onnxruntime_binding.node"
rm -rf "/Applications/${APP_NAME}.app"
cp -R "${OUT}" /Applications/
echo "Installed /Applications/${APP_NAME}.app"
if [ "${1:-}" = "--launch" ]; then open "/Applications/${APP_NAME}.app"; fi

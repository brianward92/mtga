#!/usr/bin/env bash
set -euo pipefail

HOST="${MTGA_DEPLOY_HOST:-mbp}"
APP_NAME="MTGA Draft Assistant"
APP_PATH="/Applications/${APP_NAME}.app"
REMOTE_STAGE="/tmp/mtga-draft-assistant-update"
LAUNCH=false

if [[ "${1:-}" == "--launch" ]]; then
  LAUNCH=true
elif [[ $# -gt 0 ]]; then
  echo "usage: npm run deploy:mbp -- [--launch]" >&2
  exit 2
fi

# Updating a loaded asar/native module is deliberately unsupported. Quit with
# Cmd+Q first; this also makes the deployment failure obvious instead of
# producing a half-updated app that later requires Force Quit.
if ssh "$HOST" "pgrep -f '/Applications/MTGA Draft Assistant[.]app/Contents/MacOS/MTGA Draft Assistant' >/dev/null"; then
  echo "${APP_NAME} is running on ${HOST}; quit it with Cmd+Q before deploying." >&2
  exit 1
fi

npm run typecheck
npm test
npm run build
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --arm64 --dir

APP_OUT="release/mac-arm64/${APP_NAME}.app"
ASAR="${APP_OUT}/Contents/Resources/app.asar"
INFO="${APP_OUT}/Contents/Info.plist"
ICON_PNG="${APP_OUT}/Contents/Resources/icon.png"
ICON_ICNS="${APP_OUT}/Contents/Resources/icon.icns"
NATIVE="node_modules/better-sqlite3/build/Release/better_sqlite3.node"
STAGE="$(mktemp -d)"

# The canonical binary lives at Electron's ABI (postinstall electron-rebuild;
# vitest uses the better-sqlite3-node alias instead), so "restore" means
# putting the Electron-ABI binary back — keeping `npm run dev` working even
# if the deploy aborts mid-flip.
restore_host_native() {
  rm -rf "$STAGE"
  npx electron-rebuild --force --only better-sqlite3 >/dev/null 2>&1 || true
}
trap restore_host_native EXIT

# electron-builder's cross-architecture output can share hardlinks with the
# host node_modules tree. Stage a separately verified arm64 binary, then
# restore the host binary for local tests.
npx electron-rebuild --force --only better-sqlite3 --arch arm64
file "$NATIVE" | grep -q 'arm64' || {
  echo "Expected an arm64 better-sqlite3 binary." >&2
  exit 1
}
cp "$NATIVE" "$STAGE/better_sqlite3.node"
# On the arm64 host the staged binary IS the host Electron-ABI binary, so no
# restore rebuild is needed; narrow the trap to stage cleanup only (the full
# trap's forced rebuild exists for aborts before this point).
if [ "$(uname -m)" != "arm64" ]; then
  npx electron-rebuild --force --only better-sqlite3 >/dev/null
fi
trap 'rm -rf "$STAGE"' EXIT

ssh "$HOST" "rm -rf '$REMOTE_STAGE' && mkdir -p '$REMOTE_STAGE'"
scp "$ASAR" "$INFO" "$ICON_PNG" "$ICON_ICNS" "$STAGE/better_sqlite3.node" "$HOST:$REMOTE_STAGE/"
ssh "$HOST" \
  "install -m 0644 '$REMOTE_STAGE/app.asar' '$APP_PATH/Contents/Resources/app.asar' &&
   install -m 0644 '$REMOTE_STAGE/Info.plist' '$APP_PATH/Contents/Info.plist' &&
   install -m 0644 '$REMOTE_STAGE/icon.png' '$APP_PATH/Contents/Resources/icon.png' &&
   install -m 0644 '$REMOTE_STAGE/icon.icns' '$APP_PATH/Contents/Resources/icon.icns' &&
   install -m 0755 '$REMOTE_STAGE/better_sqlite3.node' '$APP_PATH/Contents/Resources/app.asar.unpacked/node_modules/better-sqlite3/build/Release/better_sqlite3.node' &&
   file '$APP_PATH/Contents/Resources/app.asar.unpacked/node_modules/better-sqlite3/build/Release/better_sqlite3.node' | grep -q arm64 &&
   touch '$APP_PATH' &&
   /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f '$APP_PATH'"

echo "Updated ${APP_PATH} in place on ${HOST}; Dock identity preserved."

if $LAUNCH; then
  ssh "$HOST" "open -a '$APP_PATH'"
  echo "Launched ${APP_NAME}."
else
  echo "Left the app closed. Pass --launch only for an intentional interactive test."
fi

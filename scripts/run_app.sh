#!/bin/bash
# Build app data, run server, and cleanup on exit

set -e

# Get script directory and repo root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
APP_DIR="$REPO_ROOT/app"
DATA_DIR="$APP_DIR/data"

# Cleanup function
cleanup() {
    echo
    echo "Cleaning up generated data..."
    rm -f "$DATA_DIR/cards.js"
    rm -rf "$DATA_DIR/exports"
    echo "Done. Goodbye!"
}

# Set trap to cleanup on exit or interrupt
trap cleanup EXIT INT TERM

# Build app data
echo "Building app data..."
cd "$REPO_ROOT"
python scripts/build_app_data.py

# Get local IP for LAN access
LOCAL_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "unknown")

# Start server
echo
echo "Starting web server..."
echo "  Local:   http://localhost:8000"
if [ "$LOCAL_IP" != "unknown" ]; then
    echo "  Network: http://$LOCAL_IP:8000"
fi
echo
echo "Press Ctrl+C to stop and cleanup"
echo
cd "$APP_DIR"
python3 -m http.server 8000 --bind 0.0.0.0

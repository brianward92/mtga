#!/bin/bash
# Build app data, run server, and cleanup on exit.
# Runs inside a detached `screen` session named "mtga" so it survives
# terminal close. Re-running while it's up will restart the session.

set -e

# Get script directory and repo root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
APP_DIR="$REPO_ROOT/app"
DATA_DIR="$APP_DIR/data"

SESSION="mtga"

# cron's PATH is minimal (/usr/bin:/bin); ensure system sbin tools like
# lsof and screen are reachable.
export PATH="/usr/sbin:/usr/bin:/bin:$PATH"

# Pin the interpreter: cron runs with a minimal PATH where `python` is
# absent and the system `python3` lacks pandas. Override via MTGA_PYTHON.
PYTHON="${MTGA_PYTHON:-/opt/sbwco/envs/prod/bin/python}"

# build_app_data.py reads /opt/$USER/dat/mtga/processed; cron doesn't set
# USER, which would resolve the path to /opt/unknown. Guarantee it.
export USER="${USER:-$(id -un)}"

# If we're not already inside our screen session, (re)launch detached.
if [ -z "$STY" ]; then
    # Stop any existing session first (its cleanup trap runs on quit).
    if screen -ls | grep -q "\.${SESSION}[[:space:]]"; then
        echo "Restarting existing '$SESSION' session..."
        screen -S "$SESSION" -X quit
        sleep 1
    fi
    # Quitting screen doesn't always reap the http.server child, which then
    # keeps holding the port and makes the new server fail to bind. Free it.
    PORT_PIDS=$(lsof -ti TCP:8000 -sTCP:LISTEN 2>/dev/null || true)
    if [ -n "$PORT_PIDS" ]; then
        echo "Freeing port 8000 (orphaned pids: $PORT_PIDS)..."
        kill $PORT_PIDS 2>/dev/null || true
        sleep 1
    fi
    screen -dmS "$SESSION" bash "${BASH_SOURCE[0]}"
    echo "Started '$SESSION' in a detached screen session."
    echo "  App:       http://localhost:8000"
    echo "  Reattach:  screen -r $SESSION"
    echo "  Stop:      screen -S $SESSION -X quit   (runs cleanup)"
    exit 0
fi

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
"$PYTHON" scripts/build_app_data.py

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
echo "Stop with: screen -S $SESSION -X quit  (runs cleanup)"
echo
cd "$APP_DIR"
"$PYTHON" -m http.server 8000 --bind 0.0.0.0

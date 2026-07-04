#!/bin/bash
# Run the draft assistant API on :8100 inside a detached `screen` session
# named "mtga-draft". Re-running restarts the session. Clone of run_app.sh's
# idiom; no build steps — the API reads data/models live off disk.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

SESSION="mtga-draft"
PORT=8100

# cron's PATH is minimal (/usr/bin:/bin); ensure lsof and screen are reachable.
export PATH="/usr/sbin:/usr/bin:/bin:$PATH"

# The ML venv (torch-free serving: onnxruntime + pandas + duckdb).
PYTHON="${MTGA_DRAFT_PYTHON:-$REPO_ROOT/.venv-ml/bin/python}"

# Data paths key off /opt/$USER/dat/mtga; cron doesn't set USER.
export USER="${USER:-$(id -un)}"

if [ -z "$STY" ]; then
    if screen -ls | grep -q "\.${SESSION}[[:space:]]"; then
        echo "Restarting existing '$SESSION' session..."
        screen -S "$SESSION" -X quit
        sleep 1
    fi
    PORT_PIDS=$(lsof -ti TCP:$PORT -sTCP:LISTEN 2>/dev/null || true)
    if [ -n "$PORT_PIDS" ]; then
        echo "Freeing port $PORT (orphaned pids: $PORT_PIDS)..."
        kill $PORT_PIDS 2>/dev/null || true
        sleep 1
    fi
    screen -dmS "$SESSION" bash "${BASH_SOURCE[0]}"
    LOCAL_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "unknown")
    echo "Started '$SESSION' in a detached screen session."
    echo "  API:       http://localhost:$PORT/api/v1/health"
    if [ "$LOCAL_IP" != "unknown" ]; then
        echo "  Network:   http://$LOCAL_IP:$PORT/api/v1/health"
    fi
    echo "  Reattach:  screen -r $SESSION"
    echo "  Stop:      screen -S $SESSION -X quit"
    exit 0
fi

cd "$REPO_ROOT"
exec "$PYTHON" scripts/serve_draft_api.py --host 0.0.0.0 --port "$PORT"

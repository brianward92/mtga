#!/bin/bash
# Nightly 17Lands pipeline: sync data -> card store -> curate -> metrics ->
# retrain-if-new-data (gated promotion). Intended crontab entries:
#
#   30 2 * * * /Users/bward/src/mtga/scripts/daily_17lands.sh >> /tmp/cron_17lands.log 2>&1
#   15 4 * * * /Users/bward/src/mtga/scripts/run_draft_api.sh >> /tmp/cron_draft_api.log 2>&1
#
# 02:30 local: 17Lands' daily aggregate job (00:00 UTC, "takes a few hours")
# has finished, and we stay clear of the midnight Scryfall/app jobs. Most
# nights the S3 sync is a no-op (ETag match) and training is skipped
# (--if-new-data); when a new dump lands, the whole chain runs (~30-60 min).

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

export PATH="/usr/sbin:/usr/bin:/bin:$PATH"
export USER="${USER:-$(id -un)}"

PYTHON="${MTGA_DRAFT_PYTHON:-$REPO_ROOT/.venv-ml/bin/python}"

# Prevent overlapping runs (a slow download + the next night's cron). The
# lock records its holder's PID so a crash/SIGKILL can't wedge the pipeline:
# a lock whose holder is dead gets stolen instead of blocking forever.
LOCK="/tmp/mtga_17lands.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
    OTHER_PID="$(cat "$LOCK/pid" 2>/dev/null)"
    if [ -n "$OTHER_PID" ] && kill -0 "$OTHER_PID" 2>/dev/null; then
        echo "$(date '+%F %T') another run (pid $OTHER_PID) holds $LOCK; exiting"
        exit 0
    fi
    echo "$(date '+%F %T') removing stale $LOCK (holder ${OTHER_PID:-unknown} not running)"
    rm -rf "$LOCK"
    mkdir "$LOCK" || exit 1
fi
echo $$ > "$LOCK/pid"
trap 'rm -rf "$LOCK"' EXIT INT TERM

echo "$(date '+%F %T') 17lands daily: download"
"$PYTHON" "$REPO_ROOT/scripts/run_17lands_download.py"

echo "$(date '+%F %T') 17lands daily: card store"
"$PYTHON" "$REPO_ROOT/scripts/build_card_store.py"

echo "$(date '+%F %T') 17lands daily: etl"
"$PYTHON" "$REPO_ROOT/scripts/run_17lands_etl.py"

echo "$(date '+%F %T') 17lands daily: metrics"
"$PYTHON" "$REPO_ROOT/scripts/run_17lands_metrics.py"

echo "$(date '+%F %T') 17lands daily: train (if new data)"
"$PYTHON" "$REPO_ROOT/scripts/train_pick_model.py" --all-tracked --if-new-data --promote

echo "$(date '+%F %T') 17lands daily: done"

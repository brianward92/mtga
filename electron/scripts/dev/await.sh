#!/usr/bin/env bash
# Wait until the engine asks us something, then say what.
#
# Reads the guard's journal rather than the game log. The old version spawned
# `tsx match.ts` every two seconds, and each spawn re-read and re-replayed the
# whole 17MB Player.log — roughly 600ms of work per poll to discover that
# nothing had changed. The guard is already tailing the log incrementally and
# writing one line per state change, so waiting is now a `tail` on a small text
# file, and the full state is printed once at the end when it is actually
# wanted.
#
#   await.sh          wait up to 80s
#   await.sh 20       wait up to 20s
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd -P)"
touch /tmp/mtga-acting 2>/dev/null || true
JOURNAL=${GUARD_JOURNAL:-/tmp/mtga-guard.log}
deadline=$(( $(date +%s) + ${1:-80} ))
if [ ! -f "$JOURNAL" ]; then
  echo "await: no guard journal at $JOURNAL — is guard.ts running?" >&2
  exec npx tsx "$here/match.ts"
fi
# If the engine is ALREADY waiting on us, say so now. Watching only for new
# lines meant a decision that arrived before this script started was invisible,
# and the wait ran its full 90s while the game sat there wanting an answer.
last=$(grep -E "OURS|FINISHED" "$JOURNAL" 2>/dev/null | tail -1)
latest=$(tail -1 "$JOURNAL" 2>/dev/null)
case "$latest" in *OURS*|*FINISHED*) echo "$latest"; exec npx tsx "$here/match.ts" ;; esac
start=$(wc -l < "$JOURNAL")
while [ "$(date +%s)" -lt "$deadline" ]; do
  # Keep the guard standing down: waiting IS driving, and a stale lock let the
  # guard pass priority out from under a wait that was about to return.
  touch /tmp/mtga-acting 2>/dev/null || true
  new=$(tail -n +$(( start + 1 )) "$JOURNAL" 2>/dev/null | grep -E "OURS|FINISHED" | tail -1)
  if [ -n "$new" ]; then echo "$new"; exec npx tsx "$here/match.ts"; fi
  sleep 0.7
done
echo "await: nothing asked of us within ${1:-80}s"
exec npx tsx "$here/match.ts"

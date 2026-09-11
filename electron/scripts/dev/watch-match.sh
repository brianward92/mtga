#!/usr/bin/env bash
# Emit one line whenever the match state changes in a way that needs a hand.
#
# Meant to sit behind a monitor during play, so a decision that is ours arrives
# as a notification within a second of the engine asking, rather than whenever
# someone next thinks to look. A game with a human opponent has a rope; the
# ones lost before were lost to nobody looking, not to anything on the board.
set -uo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
last=""
while :; do
  s=$(npx tsx "$here/match.ts" 2>/dev/null)
  key=$(echo "$s" | grep -E "^decision|^FINISHED|^seat" | tr '\n' ' ')
  if [ "$key" != "$last" ]; then
    echo "$s" | grep -E "^seat|^life|^decision|^FINISHED|may block|divides|best:" | tr '\n' ' '
    echo
    last="$key"
  fi
  sleep 1.2
done

#!/usr/bin/env bash
# Wait for the mulligan prompt and answer it on the usual heuristic.
#
# Keep two to five lands in seven; mulligan anything outside that. It is the
# one decision in a game that is genuinely mechanical, it happens in every
# game, and having it cost a model round trip is pure overhead. Anything the
# heuristic is not sure about it leaves alone and says so.
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd -P)"
touch /tmp/mtga-acting 2>/dev/null || true
deadline=$(( $(date +%s) + ${1:-120} ))
while [ "$(date +%s)" -lt "$deadline" ]; do
  touch /tmp/mtga-acting 2>/dev/null || true
  s=$(npx tsx "$here/match.ts" 2>/dev/null)
  case "$s" in *"decision: mulligan"*) break ;; esac
  sleep 2
done
case "$s" in
  *"decision: mulligan"*) ;;
  *) echo "mull: no mulligan prompt within ${1:-120}s"; exit 1 ;;
esac
hand=$(echo "$s" | grep '^hand')
n=$(echo "$hand" | grep -o -E '[0-9]+ Land' | grep -o -E '^[0-9]+'); n=${n:-0}
size=$(echo "$hand" | sed -E 's/^hand \(([0-9]+)\).*/\1/')
echo "mull: $hand"
if [ "$n" -ge 2 ] && [ "$n" -le 5 ]; then
  echo "mull: keeping ($n land in $size)"
  # Click until the prompt actually goes away. The log announces the mulligan
  # before the client finishes drawing the buttons, so the first click lands on
  # nothing roughly half the time — and a missed Keep is invisible until the
  # rope guard notices two minutes later.
  for try in 1 2 3 4 5; do
    bash "$here/btn.sh" "Keep" "0.3,0.65,0.7,0.30" 2 >/dev/null 2>&1
    sleep 1.2
    npx tsx "$here/match.ts" 2>/dev/null | grep -q "decision: mulligan" || { echo "mull: kept"; exit 0; }
  done
  echo "mull: could not make the Keep click land"; exit 3
else
  echo "mull: $n land in $size — NOT keeping automatically, decide by hand"
  exit 2
fi

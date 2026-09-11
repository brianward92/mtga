#!/usr/bin/env bash
# Start a practice game against Arena's AI, from the home screen.
set -uo pipefail
click() { macctl click MTGA "$1" "$2" >/dev/null 2>&1; sleep "${3:-2.5}"; }
# The bottom-right primary button is "Play" on the home screen, and again on the
# event panel once a deck is selected. The panel remembers the last event, so
# the second press starts the match rather than choosing one.
click 0.9039 0.9398 3     # Play -> opens the play panel
click 0.9039 0.9398 4     # Play -> start the match with the remembered deck
# Wait for a NEW game, not for any game traffic at all. The log is one file
# across every match, so a non-zero line count just means a game was played at
# some point today — the previous one, whose final state then looks live.
LOG=~/Library/Logs/Wizards\ of\ the\ Coast/MTGA/Player.log
before=$(grep -c "MulliganReq" "$LOG" 2>/dev/null || echo 0)
for i in $(seq 1 25); do
  now=$(grep -c "MulliganReq" "$LOG" 2>/dev/null || echo 0)
  [ "$now" -gt "$before" ] && { echo "new game started"; exit 0; }
  sleep 3
done
echo "no new game after 75s"; exit 1

#!/usr/bin/env bash
# Start a practice game against Arena's AI, from the home screen.
set -uo pipefail
click() { macctl click MTGA "$1" "$2" >/dev/null 2>&1; sleep "${3:-2.5}"; }
# The bottom-right primary button is "Play" on the home screen, and again on the
# event panel once a deck is selected. The panel remembers the last event, so
# the second press starts the match rather than choosing one.
click 0.9039 0.9398 3     # Play -> opens the play panel
click 0.9039 0.9398 4     # Play -> start the match with the remembered deck
for i in $(seq 1 20); do
  n=$(grep -c "greToClientMessages" ~/Library/Logs/Wizards\ of\ the\ Coast/MTGA/Player.log 2>/dev/null || echo 0)
  [ "$n" -gt 0 ] && { echo "match started ($n gre lines)"; exit 0; }
  sleep 3
done
echo "no game traffic after 60s"

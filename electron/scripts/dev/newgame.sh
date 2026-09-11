#!/usr/bin/env bash
# Start the next Bot Match with the deck already selected, and refuse if it is
# not the deck we meant.
#
# After a result screen the Play blade's Recently Played tab carries a tile for
# the last match — mode, deck and a Play button — so a rematch is one click.
# The check on the deck name is the point of the script: a gauntlet that runs
# one colour at a time has exactly one way to go silently wrong, which is
# playing the previous colour's deck for three games and counting the wins.
#
#   newgame.sh "Mono White"     start a bot match, insisting on that deck
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd -P)"
touch /tmp/mtga-acting 2>/dev/null || true
expect="${1:-}"
read_tile() { macctl read MTGA --region 0.78,0.78,0.22,0.22 --boxes 2>/dev/null | python3 -c "
import json,sys
print(' | '.join(b['text'].strip() for b in json.load(sys.stdin).get('boxes',[])))"; }

# Open the blade if it is not already showing a tile with a Play button.
# Decide "is the blade open?" on the tile's own words, not on the word "Play":
# the home screen's main Play button sits in the same corner and reads the same,
# so testing for it decided the blade was already open when it was not.
tile=$(read_tile)
case "$tile" in
  *"Bot Match"*|*"Best of"*) ;;
  *) bash "$here/btn.sh" "Play" "0.85,0.90,0.15,0.09" 3 >/dev/null 2>&1; sleep 2
     # The blade remembers whichever tab was last used, and a fresh client
     # opens it on Events — where there is no rematch tile at all. Select
     # Recently Played explicitly rather than hoping.
     bash "$here/btn.sh" "Recently" "0.90,0.14,0.10,0.10" 2 >/dev/null 2>&1; sleep 1.5
     tile=$(read_tile) ;;
esac
echo "newgame: tile = $tile"
case "$tile" in
  *"Bot Match"*) ;;
  *) echo "newgame: the recent tile is not a Bot Match — not starting"; exit 1 ;;
esac
if [ -n "$expect" ]; then
  # Check against the tile we already read. A second, narrower capture of just
  # the deck-name strip came back empty about as often as not — the name sits
  # right on the crop boundary — and an empty read is not evidence of a wrong
  # deck, so it must not be treated as one.
  deck="$tile"
  if ! python3 -c "
import sys
want=sys.argv[1].lower().replace(' ','')
got=sys.argv[2].lower().replace(' ','')
sys.exit(0 if want[:10] in got else 1)" "$expect" "$deck"; then
    echo "newgame: tile deck reads '$deck', expected '$expect' — not starting"; exit 1
  fi
fi
bash "$here/click-at.sh" 1309 736
date +%s > /tmp/game-start
echo "newgame: started"

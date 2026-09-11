#!/usr/bin/env bash
# Clear the post-game screens and land back on the Play blade.
#
# A finished match leaves a result screen, then sometimes a rewards screen,
# then "Waiting for the Server..." — each needing a click that is in a
# different place from the last. Find "Click to Continue" wherever it is,
# repeatedly, until the client settles.
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd -P)"
touch /tmp/mtga-acting 2>/dev/null || true
for i in 1 2 3 4 5 6; do
  touch /tmp/mtga-acting 2>/dev/null || true
  hit=$(macctl read MTGA --boxes 2>/dev/null | python3 -c "
import json,sys
try: bs=json.load(sys.stdin).get('boxes',[])
except Exception: sys.exit()
for b in bs:
    t=b['text'].lower()
    if 'continue' in t or 'claim' in t: print(b['at'][0], b['at'][1]); break
")
  if [ -n "$hit" ]; then bash "$here/click-at.sh" $hit; sleep 2.5; continue; fi
  if macctl read MTGA 2>/dev/null | grep -q "Waiting for the Server"; then sleep 3; continue; fi
  break
done
macctl read MTGA --region 0.0,0.05,1.0,0.08 --boxes 2>/dev/null | python3 -c "
import json,sys
print('finish: nav =', ' '.join(b['text'] for b in json.load(sys.stdin).get('boxes',[]))[:70])"

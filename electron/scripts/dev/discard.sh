#!/usr/bin/env bash
# Answer a cleanup discard: drop one card and submit.
#
# Prefers a duplicate, then the last card in the hand row. Crude, but this
# prompt arrives every turn once the hand is full and a stuck one stalls the
# game as surely as a missed block.
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd -P)"
touch /tmp/mtga-acting 2>/dev/null || true
rows=$(bash "$here/hand.sh" 0.62 0.38 2>/dev/null | grep -v -i -E "bmw2150|virtuous|submit|resolve|^ *[0-9]+ +[0-9]+ +[0-9/]+$")
pick=$(echo "$rows" | python3 -c "
import sys, collections
rows = [l.rstrip() for l in sys.stdin if l.strip()]
def name(r): return ' '.join(r.split()[2:]).lower()
counts = collections.Counter(name(r) for r in rows)
dupes = [r for r in rows if counts[name(r)] > 1]
pool = dupes or rows
print(pool[-1] if pool else '')
")
if [ -z "$pick" ]; then echo "discard: nothing readable in hand"; exit 1; fi
echo "discard: $pick"
bash "$here/click-at.sh" $(echo "$pick" | awk '{print $1, $2+20}')
sleep 1.0
lbl=$(macctl read MTGA --region 0.78,0.83,0.22,0.15 --boxes 2>/dev/null | python3 -c "
import json,sys; print(' / '.join(b['text'] for b in json.load(sys.stdin).get('boxes',[])))")
echo "discard: button = $lbl"
case "$lbl" in *Submit*) macctl click MTGA 0.9250 0.8890 >/dev/null 2>&1; echo "discard: submitted" ;; esac
sleep 1.2

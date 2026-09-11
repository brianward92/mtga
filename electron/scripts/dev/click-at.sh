#!/usr/bin/env bash
# Click a point in the Arena window, given SCREEN coordinates, the way Arena
# actually accepts a click on the battlefield.
#
# Hover first, then click. A cold click at a creature's exact centre is
# intermittent — it silently selected nothing on one Luminarch Aspirant trigger
# and worked on the next — while moving there, letting the hover register, and
# then clicking has not missed. Unity wants to see the pointer arrive before it
# will treat the press as landing on that object.
#
#   click-at.sh 561 455           hover, then click
#   click-at.sh 561 455 2         hover, then double-click (playing a card)
set -uo pipefail
touch /tmp/mtga-acting 2>/dev/null || true
x="$1"; y="$2"; count="${3:-1}"
read -r wx wy ww wh <<<"$(macctl window MTGA 2>/dev/null | python3 -c "
import json,sys; print(*json.load(sys.stdin)['window']['bounds'])")"
read -r fx fy <<<"$(python3 -c "print(f'{($x-$wx)/$ww:.4f} {($y-$wy)/$wh:.4f}')")"
macctl move MTGA "$fx" "$fy" >/dev/null 2>&1
sleep 0.55
macctl click MTGA "$fx" "$fy" --count "$count" >/dev/null 2>&1
sleep 0.4

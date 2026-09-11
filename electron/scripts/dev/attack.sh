#!/usr/bin/env bash
# Declare attackers and submit, but only after checking the count.
#
# Two games were lost to this exact step. Once because a helper treated the
# declaration-count button as a plain advance and shipped a three-creature
# attack that was meant to be one; once because the count was never read at all.
# So the count is read back and compared against what was asked for, and a
# mismatch submits nothing.
#
#   attack.sh all           attack with everything, submit whatever the count is
#   attack.sh all 2         attack with everything, but only if that is 2
#   attack.sh name Bodyguard Aspirant   click those creatures, then submit
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd -P)"
touch /tmp/mtga-acting 2>/dev/null || true
label() { macctl read MTGA --region 0.78,0.83,0.22,0.15 --boxes 2>/dev/null | python3 -c "
import json,sys; print(' / '.join(b['text'].strip() for b in json.load(sys.stdin).get('boxes',[])))"; }

mode="${1:-all}"; shift || true
if [ "$mode" = "all" ]; then
  expect="${1:-}"
  bash "$here/step.sh" "All Attack" >/dev/null 2>&1 || { echo "attack: no All Attack button"; exit 1; }
  sleep 1.3
else
  expect="$#"
  for nm in "$@"; do
    row=$(bash "$here/board.sh" mine | grep -i -- "$nm" | head -1)
    if [ -z "$row" ]; then echo "attack: '$nm' not on the battlefield"; exit 1; fi
    bash "$here/click-at.sh" $(echo "$row" | awk '{print $1, $2}')
    sleep 0.5
  done
fi
lbl=$(label)
n=$(echo "$lbl" | grep -o -E '[0-9]+' | head -1)
echo "attack: button reads '$lbl'"
if [ -z "${n:-}" ]; then echo "attack: no attacker count on the button — submitting nothing"; exit 1; fi
if [ -n "$expect" ] && [ "$n" != "$expect" ]; then
  echo "attack: declared $n, expected $expect — submitting nothing"; exit 1
fi
macctl click MTGA 0.9250 0.8890 >/dev/null 2>&1
echo "attack: submitted $n attacker(s)"
sleep 1.2

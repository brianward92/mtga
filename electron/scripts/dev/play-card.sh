#!/usr/bin/env bash
# Drag one card out of hand by name.
#
# The hand recentres after every play, so a position read before the previous
# card left is wrong. Re-scan, match the name, then drag — never reuse a
# coordinate across two plays.
set -uo pipefail
want="$1"; tx="${2:-700}"; ty="${3:-480}"
hit=$(bash "$(dirname "$0")/hand.sh" 0.78 0.22 2>/dev/null | grep -i -- "$want" | head -1)
if [ -z "$hit" ]; then echo "play-card: '$want' is not in hand"; exit 1; fi
x=$(echo "$hit" | awk '{print $1}'); y=$(echo "$hit" | awk '{print $2}')
echo "play-card: '$want' at $x,$y -> $tx,$ty"
read -r fx fy <<<"$(python3 -c "print(f'{($x-152)/1280:.4f} {($y+20-33)/748:.4f}')")"
read -r gx gy <<<"$(python3 -c "print(f'{($tx-152)/1280:.4f} {($ty-33)/748:.4f}')")"
# 30 steps of intermediate motion costs a full second and 12 is enough for the
# drag to register. Then wait on the engine actually moving rather than on a
# fixed sleep: it settles in a few hundred milliseconds, and the 2.2s guess it
# replaces was repeated half a dozen times a turn.
macctl drag MTGA "$fx" "$fy" "$gx" "$gy" --steps 12 >/dev/null 2>&1
npx tsx "$(dirname "$0")/settle.ts" 4000 >/dev/null 2>&1

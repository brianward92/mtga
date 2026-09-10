#!/usr/bin/env bash
# Drag one card out of hand by name.
#
# The hand recentres after every play, so a position read before the previous
# card left is wrong. Re-scan, match the name, then drag — never reuse a
# coordinate across two plays.
set -uo pipefail
want="$1"; tx="${2:-700}"; ty="${3:-480}"
hit=$(bash "$(dirname "$0")/hand.sh" 0.845 0.09 2>/dev/null | grep -i -- "$want" | head -1)
if [ -z "$hit" ]; then echo "play-card: '$want' is not in hand"; exit 1; fi
x=$(echo "$hit" | awk '{print $1}'); y=$(echo "$hit" | awk '{print $2}')
echo "play-card: '$want' at $x,$y -> $tx,$ty"
read -r fx fy <<<"$(python3 -c "print(f'{($x-152)/1280:.4f} {($y+20-33)/748:.4f}')")"
read -r gx gy <<<"$(python3 -c "print(f'{($tx-152)/1280:.4f} {($ty-33)/748:.4f}')")"
macctl drag MTGA "$fx" "$fy" "$gx" "$gy" --steps 30 >/dev/null 2>&1
sleep 3

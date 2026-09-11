#!/usr/bin/env bash
# Answer a "target a creature you control" trigger by clicking our biggest one.
#
# Luminarch Aspirant asks this every single combat, and the answer is nearly
# always "the creature that is about to attack", which is the biggest. Reads the
# board fresh each call because the row recentres as creatures come and go.
#
#   target-best.sh          our side, highest power
#   target-best.sh theirs   their side, highest power (removal, exile)
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd -P)"
touch /tmp/mtga-acting 2>/dev/null || true
side="${1:-mine}"
row=$(bash "$here/board.sh" "$side" | python3 -c "
import sys
best = None
for line in sys.stdin:
    f = line.split()
    if len(f) < 5 or '/' not in f[3]: continue
    try: power = int(f[3].split('/')[0])
    except ValueError: continue
    if best is None or power > best[0]: best = (power, f[0], f[1], ' '.join(f[4:]))
if best: print(best[1], best[2], best[0], best[3])
")
if [ -z "$row" ]; then echo "target-best: nothing readable on the $side board"; exit 1; fi
set -- $row
echo "target-best: $side power $3 — ${*:4} at $1,$2"
bash "$here/click-at.sh" "$1" "$2"
sleep 0.8

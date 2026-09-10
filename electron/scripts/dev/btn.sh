#!/usr/bin/env bash
# Click a button by its label. One capture, unmerged boxes.
#
# The merged read is useless for buttons: two side by side share a row, so
# "Mulligan" and "Keep" arrive as one string whose centre is the gap between
# them. --boxes keeps them apart, which is the whole point.
set -uo pipefail
want="$1"; region="${2:-0.0,0.70,1.0,0.30}"
hit=$(macctl read MTGA --region "$region" --boxes 2>/dev/null | python3 -c "
import json,sys,unicodedata
# Vision substitutes visually identical non-Latin letters: 'Keep' has come back
# as 'Kee\u0440 7' with a Cyrillic er, and as '\u041a\u0435\u0435p'. A plain
# string compare then fails on a button that is plainly on screen, which reads
# as 'the button is not there' and stalls everything. Fold to ASCII by shape
# before comparing.
HOMOGLYPHS = str.maketrans({
    '\u0430':'a','\u0435':'e','\u043e':'o','\u0440':'p','\u0441':'c','\u0443':'y','\u0445':'x','\u0456':'i',
    '\u0410':'A','\u0415':'E','\u041e':'O','\u0420':'P','\u0421':'C','\u0422':'T','\u0425':'X','\u041a':'K',
    '\u0412':'B','\u041c':'M','\u041d':'H','\u0391':'A','\u0392':'B','\u0395':'E','\u039f':'O','\u03a1':'P',
})
def fold(t):
    t = unicodedata.normalize('NFKC', t).translate(HOMOGLYPHS)
    return ''.join(ch for ch in t if ch.isascii()).strip().lower()
want=fold(sys.argv[1])
try: d=json.load(sys.stdin)
except Exception: sys.exit(1)
best=None
for b in d.get('boxes',[]):
    t=fold(b['text'])
    if want in t or t in want:
        score=abs(len(t)-len(want))
        if best is None or score<best[0]: best=(score,b)
if best: print(best[1]['at'][0], best[1]['at'][1], best[1]['text'])
" "$want")
if [ -z "$hit" ]; then echo "btn: '$want' not found"; exit 1; fi
read -r x y label <<<"$hit"
echo "btn: '$label' at $x,$y"
read -r fx fy <<<"$(python3 -c "print(f'{($x-152)/1280:.4f} {($y-33)/748:.4f}')")"
macctl click MTGA "$fx" "$fy" >/dev/null 2>&1
sleep "${3:-2}"

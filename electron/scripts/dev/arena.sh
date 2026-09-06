#!/usr/bin/env bash
# arena.sh — one entry point for driving MTG Arena and the overlay from a
# terminal (or an agent). Every desktop action goes through here so a single
# permission rule covers all of it.
#
#   arena.sh app launch|kill|restart|status   overlay app, with the state mirror on
#   arena.sh activate                          bring Arena to the front
#   arena.sh rect                              Arena window rect in screen points
#   arena.sh front                             name of the frontmost app
#   arena.sh shot [name]                       screenshot only if Arena is frontmost
#   arena.sh click X Y | dblclick X Y | move X Y | scroll X Y LINES | key CODE
#   arena.sh state [pos|cards|pool|json]       mirrored DraftState summary
#   arena.sh pick [top|<grpId>] [--dry-run]    one pick (wraps pick-next-card.sh)
#   arena.sh draft [SECONDS]                   pick on a loop until the draft completes
#   arena.sh log                               tail Player.log for draft events
#
# Coordinates are screen POINTS (what osascript/System Events report), not
# retina pixels. A screenshot scaled to 1800 px wide on a 3024 px display is
# 1.19 px/pt.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
cd "$here/../.."   # electron/
APP="/Applications/MTGA Draft Assistant.app"
export MTGA_STATE_FILE="${MTGA_STATE_FILE:-$HOME/.mtga-tracker/state.json}"
SHOTS="${MTGA_SHOT_DIR:-${TMPDIR:-/tmp}/arena-shots}"
BIN=build/dev

die() { echo "arena: $*" >&2; exit 1; }
helper() {  # build a Swift helper on first use
  [ -x "$BIN/$1" ] || { mkdir -p "$BIN"; swiftc -O -o "$BIN/$1" "scripts/dev/$1.swift"; }
  echo "$BIN/$1"
}
activate() { osascript -e 'tell application "MTGA" to activate' >/dev/null; sleep 0.4; }
front() { osascript -e 'tell application "System Events" to get name of first application process whose frontmost is true'; }
state_py() { python3 - "$MTGA_STATE_FILE" "$@" <<'EOF'
import json, sys
s = json.load(open(sys.argv[1])); what = sys.argv[2] if len(sys.argv) > 2 else "pos"
if what == "json": print(json.dumps(s)); sys.exit()
if what == "pos": print(f"P{s.get('pack')}P{s.get('pick')} phase={s.get('phase')} set={s.get('set')} fmt={s.get('format')} cards={len(s.get('cards',[]))} pool={len(s.get('pool',[]))} model={s.get('model',{}).get('state')}"); sys.exit()
rows = s.get("cards", []) if what == "cards" else s.get("pool", [])
key = (lambda c: (c.get("rank") or 99)) if what == "cards" else (lambda c: c.get("name") or "")
for c in sorted(rows, key=key):
    p = c.get("prob"); p = f"{p*100:3.0f}%" if isinstance(p, (int, float)) else "  - "
    print(f"{str(c.get('rank') or '-'):>2} {(c.get('grade') or '-'):<2} {p} {c.get('name')} [{c.get('colors','')}]")
EOF
}

cmd="${1:-}"; shift || true
case "$cmd" in
  app)
    sub="${1:-status}"
    case "$sub" in
      kill) pkill -f "$APP/Contents/MacOS" || true; echo "overlay app stopped" ;;
      launch) mkdir -p "$(dirname "$MTGA_STATE_FILE")"; open --env MTGA_STATE_FILE="$MTGA_STATE_FILE" --env MTGA_LAYER_DEBUG=1 -a "$APP"; sleep 6; "$0" app status ;;
      restart) "$0" app kill; sleep 2; "$0" app launch ;;
      status)
        if pgrep -f "$APP/Contents/MacOS" >/dev/null; then echo "overlay app: running (since $(ps -o lstart= -p "$(pgrep -f "$APP/Contents/MacOS" | head -1)"))"; else echo "overlay app: NOT running"; fi
        # The installed build can lag the repo: that is how a two-week-old
        # overlay ended up driving the 2026-09-06 draft. Say so loudly.
        if [ -f "$APP/Contents/Info.plist" ]; then
          built=$(stat -f %m "$APP/Contents/Info.plist"); head_at=$(git log -1 --format=%ct 2>/dev/null || echo 0)
          if [ "$built" -lt "$head_at" ]; then echo "WARNING: installed app ($(date -r "$built" '+%b %d %H:%M')) is OLDER than repo HEAD ($(git log -1 --format='%h %s' | cut -c1-60)); run: npm run install:local"; else echo "installed app: $(date -r "$built" '+%b %d %H:%M'), current with HEAD"; fi
        fi
        [ -f "$MTGA_STATE_FILE" ] && state_py pos || echo "no state mirror at $MTGA_STATE_FILE (launch via arena.sh app launch)" ;;
      *) die "app launch|kill|restart|status" ;;
    esac ;;
  activate) activate; echo "Arena frontmost" ;;
  front) front ;;
  rect) osascript -e 'tell application "System Events" to tell process "MTGA" to get {position, size} of window 1' | tr -d ' ' ;;
  shot)
    f="$(front)"; [ "$f" = "MTGA" ] || die "Arena is not frontmost ($f); not capturing"
    mkdir -p "$SHOTS"; out="$SHOTS/${1:-shot-$(date +%H%M%S)}.png"
    screencapture -x "$out" && sips -Z "${MTGA_SHOT_WIDTH:-1800}" "$out" >/dev/null && echo "$out" ;;
  click)    activate; "$(helper click)" "$1" "$2" ;;
  dblclick) activate; "$(helper dblclick)" "$1" "$2" ;;
  move)     "$(helper move-mouse)" "$1" "$2" ;;
  scroll)   activate; "$(helper scroll)" "$1" "$2" "$3" ;;
  key)      activate; osascript -e "tell application \"System Events\" to key code $1" ;;
  state)    [ -f "$MTGA_STATE_FILE" ] || die "no state mirror at $MTGA_STATE_FILE"; state_py "${1:-pos}" ;;
  pick)     bash scripts/dev/pick-next-card.sh "$@" ;;
  draft)
    end=$((SECONDS + ${1:-570})); last=""
    while [ $SECONDS -lt $end ]; do
      info="$(state_py pos 2>/dev/null || true)"
      case "$info" in *"phase=complete"*) echo "DRAFT COMPLETE"; exit 0 ;; esac
      pos="${info%% *}"; n="${info##*cards=}"; n="${n%% *}"
      if [ -n "$pos" ] && [ "$pos" != "$last" ] && [ "${n:-0}" -gt 0 ] 2>/dev/null; then
        sleep 1.5
        bash scripts/dev/pick-next-card.sh top 2>&1 | grep -E '^PICKED|abort|REFUS|not picked' | tail -1 || true
        last="$pos"
      fi
      sleep 1
    done
    echo "loop ended at $(state_py pos)" ;;
  log)
    tail -n0 -F "$HOME/Library/Logs/Wizards of the Coast/MTGA/Player.log" \
      | grep --line-buffered -E 'Draft\.Notify|EventJoin|EventPlayerDraftMakePick|CardsInPack|DraftStatus|SceneChange' \
      | while IFS= read -r line; do printf '%s %s\n' "$(date +%H:%M:%S)" "${line:0:300}"; done ;;
  ""|-h|--help) sed -n '2,20p' "$0" ;;
  *) die "unknown command: $cmd (try --help)" ;;
esac

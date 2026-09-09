#!/usr/bin/env bash
# arena.sh — one entry point for driving MTG Arena and the overlay from a
# terminal (or an agent). Every desktop action goes through here so a single
# permission rule covers all of it.
#
#   arena.sh app launch|kill|restart|status   overlay app, with the state mirror on
#   arena.sh activate                          bring Arena to the front
#   arena.sh rect                              Arena window rect in screen points
#   arena.sh front                             name of the frontmost app
#   arena.sh shot [name]                       capture Arena's window region only
#   arena.sh click X Y | move X Y | scroll X Y LINES | key CODE
#   arena.sh state [pos|cards|pool|json]       mirrored DraftState summary
#   arena.sh pick [top|<grpId>] [--dry-run]    one pick (wraps pick-next-card.sh)
#   arena.sh draft [SECONDS]                   pick on a loop until the draft completes
#   arena.sh log                               tail Player.log for draft events
#   arena.sh build [--dry-run|--read|--no-lands] build the advisor's deck in Arena's builder (never presses Done)
#   arena.sh build --verify [SECONDS]          after Done: diff Arena's submitted deck against the plan
#   arena.sh ocr <image.png>                   Vision OCR of an image, one JSON line per text box
#
# Coordinates are screen POINTS (what osascript/System Events report), not
# retina pixels. A screenshot scaled to 1800 px wide on a 3024 px display is
# 1.19 px/pt.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
cd "$here/../.."   # electron/
APP="/Applications/MTGA Draft Assistant.app"
export MTGA_STATE_FILE="${MTGA_STATE_FILE:-$HOME/.mtga-tracker/state.json}"
# Under build/dev/, which .gitignore covers. Note build/ itself is a tracked
# source directory (icons, tray images), so generated artefacts must not land
# there. Inside the repo rather than $TMPDIR because a screenshot is only
# useful if the tool that asked for it can read it back, and agent sandboxes
# are scoped to the working directory.
SHOTS="${MTGA_SHOT_DIR:-$PWD/build/dev/shots}"
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
if what == "rect":
    a = s.get("arena")
    if not a: sys.exit(1)
    print(f"{a['x']},{a['y']},{a['width']},{a['height']}"); sys.exit()
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
          # Compare against the last commit that touched shipped app code, not
          # against HEAD: a docs-only commit does not make the install stale.
          built=$(stat -f %m "$APP/Contents/Info.plist")
          head_at=$(git log -1 --format=%ct -- main shared renderer native resources package.json 2>/dev/null || echo 0)
          if [ "$built" -lt "$head_at" ]; then echo "WARNING: installed app ($(date -r "$built" '+%b %d %H:%M')) is OLDER than repo HEAD ($(git log -1 --format='%h %s' | cut -c1-60)); run: npm run install:local"; else echo "installed app: $(date -r "$built" '+%b %d %H:%M'), current with HEAD"; fi
        fi
        [ -f "$MTGA_STATE_FILE" ] && state_py pos || echo "no state mirror at $MTGA_STATE_FILE (launch via arena.sh app launch)" ;;
      *) die "app launch|kill|restart|status" ;;
    esac ;;
  activate) activate; echo "Arena frontmost" ;;
  front) front ;;
  rect)
    # The app publishes the rect it is actually drawing against, taken from the
    # bundled CGWindowList helper, which needs no Accessibility permission.
    # Prefer it: the AX rect below reports nonsense while Arena is full screen,
    # and the app deliberately avoids AX (see main/arena-geometry.ts).
    if [ -f "$MTGA_STATE_FILE" ] && state_py rect 2>/dev/null; then :
    else osascript -e 'tell application "System Events" to tell process "MTGA" to get {position, size} of window 1' | tr -d ' '; fi ;;
  shot)
    mkdir -p "$SHOTS"; out="$SHOTS/${1:-shot-$(date +%H%M%S)}.png"; rm -f "$out"
    # Capture only Arena's own rect. A bare `screencapture -x` takes the whole
    # desktop, which sweeps up every other window that happens to be open.
    # screenshot-arena.sh gets the region from the native helper.
    bash scripts/dev/screenshot-arena.sh "$out" >/dev/null
    sips -Z "${MTGA_SHOT_WIDTH:-1800}" "$out" >/dev/null && echo "$out" ;;
  click)    activate; "$(helper click)" "$1" "$2" ;;
  move)     "$(helper move-mouse)" "$1" "$2" ;;
  scroll)   activate; "$(helper scroll)" "$1" "$2" "$3" ;;
  key)      activate; osascript -e "tell application \"System Events\" to key code $1" ;;
  state)    [ -f "$MTGA_STATE_FILE" ] || die "no state mirror at $MTGA_STATE_FILE"; state_py "${1:-pos}" ;;
  pick)     bash scripts/dev/pick-next-card.sh "$@" ;;
  build)    [ -f "$MTGA_STATE_FILE" ] || die "no state mirror at $MTGA_STATE_FILE"; for t in click move-mouse scroll ocr; do helper $t >/dev/null; done; npx tsx scripts/dev/deckbuild.ts "$MTGA_STATE_FILE" "$@" ;;
  ocr)      "$(helper ocr)" "$@" ;;
  draft)
    end=$((SECONDS + ${1:-570})); maxpack="${2:-99}"; last=""
    while [ $SECONDS -lt $end ]; do
      info="$(state_py pos 2>/dev/null || true)"
      case "$info" in *"phase=complete"*) echo "DRAFT COMPLETE"; exit 0 ;; esac
      pos="${info%% *}"; n="${info##*cards=}"; n="${n%% *}"
      pack="${pos#P}"; pack="${pack%%P*}"
      if [ -n "$pack" ] && [ "$pack" != "None" ] && [ "$pack" -gt "$maxpack" ] 2>/dev/null; then
        echo "reached pack $pack (stop after $maxpack)"; exit 0
      fi
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

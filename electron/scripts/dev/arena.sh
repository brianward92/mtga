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
#   arena.sh state [pos|cards|pool|json|rect]  mirrored DraftState summary
#   arena.sh read X Y W H                      OCR an arbitrary screen region
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
# All state queries go through one TypeScript CLI, which shares the app's own
# card rules. The Python helper this replaced had its own basic-land test and
# quietly disagreed with the overlay about the same card.
state_py() { ./node_modules/.bin/tsx scripts/dev/state.ts "$MTGA_STATE_FILE" "$@"; }

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
        # overlay ended up driving the 2026-09-06 draft. Compare CONTENT, not
        # timestamps — committing after an install used to report the current
        # build as stale, and editing without committing reported a stale build
        # as current.
        stamp="$APP/Contents/Resources/.source-hash"
        if [ -f "$stamp" ]; then
          if [ "$(cat "$stamp")" = "$(bash scripts/dev/app-source-hash.sh)" ]; then
            echo "installed app: $(date -r "$(stat -f %m "$APP/Contents/Info.plist")" '+%b %d %H:%M'), matches the working tree"
          else
            echo "WARNING: installed app does not match the current app sources; run: npm run install:local"
          fi
        elif [ -f "$APP/Contents/Info.plist" ]; then
          echo "installed app: $(date -r "$(stat -f %m "$APP/Contents/Info.plist")" '+%b %d %H:%M'), built before content stamping; run: npm run install:local"
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
    else
      # AppleScript reports {x, y}, {w, h}; every consumer here expects four
      # bare comma-separated numbers, and the braces produced unparseable JSON
      # downstream. Normalise, so the fallback is a fallback rather than a
      # different, broken format.
      osascript -e 'tell application "System Events" to tell process "MTGA" to get {position, size} of window 1' \
        | tr -d ' {}' || die "no state mirror and Accessibility could not report Arena's window"
    fi ;;
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
  key)
    # A key CODE only. This used to paste $1 straight into AppleScript source,
    # which made the one allow-listed command a route to arbitrary AppleScript —
    # including menu items this must never touch, like Log Out and Exit Game.
    case "${1:-}" in
      ''|*[!0-9]*) die "key CODE (digits only)" ;;
    esac
    [ "$1" -le 255 ] || die "key code out of range: $1"
    activate; osascript -e "tell application \"System Events\" to key code $1" ;;
  type)
    # Type literal text into whatever Arena field has focus (card search). The
    # text is passed as an argument, never interpolated into the script source,
    # so quotes and backslashes in a card name cannot break out of the string.
    [ $# -ge 1 ] || die "type TEXT"
    activate
    osascript -e 'on run argv
  tell application "System Events" to keystroke (item 1 of argv)
end run' -- "$*" ;;
  clear)    # Select-all then delete: empties a focused text field.
            activate; osascript -e 'tell application "System Events" to keystroke "a" using command down' -e 'tell application "System Events" to key code 51' ;;
  state)    # Forward every argument: "state basic 12345" needs both, and passing
            # only the first silently answered "not a basic land".
            [ -f "$MTGA_STATE_FILE" ] || die "no state mirror at $MTGA_STATE_FILE"; state_py "${@:-pos}" ;;
  pick)     bash scripts/dev/pick-next-card.sh "$@" ;;
  build)    [ -f "$MTGA_STATE_FILE" ] || die "no state mirror at $MTGA_STATE_FILE"; for t in click move-mouse scroll ocr; do helper $t >/dev/null; done; npx tsx scripts/dev/deckbuild.ts "$MTGA_STATE_FILE" "$@" ;;
  ocr)      "$(helper ocr)" "$@" ;;
  read)
    # Read the text in an arbitrary screen region (points). The general form of
    # "what does the screen actually say here?", which is how a click is
    # verified before it is committed.
    [ $# -ge 4 ] || die "read X Y W H"
    helper ocr >/dev/null
    ./node_modules/.bin/tsx scripts/dev/read-region.ts "$1" "$2" "$3" "$4" ;;
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
        # Match what pick-next-card.sh actually prints. The old pattern missed
        # "WARNING: pick not confirmed", so a failed pick printed NOTHING and the
        # loop spun silently with the pack still open until the timer ran out.
        bash scripts/dev/pick-next-card.sh top 2>&1 | grep -E '^PICKED|^ABORTING|^NOT RETRYING|^WARNING|REFUS|abort' | tail -1 || true
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

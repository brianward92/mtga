#!/usr/bin/env bash
# arena.sh — Arena-flavoured wrapper over `macctl`.
#
# The generic macOS control that used to live here — the Swift helpers, the
# screenshot handshake, the AppleScript keystrokes — moved out to
# ~/src/macOS-computer-control and is installed as `macctl` on PATH. What is
# left is only the part that knows about Arena: the overlay app, the state
# mirror, picking, drafting and deck building.
#
#   arena.sh app launch|kill|restart|status   overlay app, with the state mirror on
#   arena.sh activate                          bring Arena to the front
#   arena.sh rect                              Arena window rect in screen points
#   arena.sh front                             name of the frontmost app
#   arena.sh shot [name]                       capture Arena's window region only
#   arena.sh click X Y | move X Y | scroll X Y LINES | key CODE
#   arena.sh drag X1 Y1 X2 Y2 [STEPS]        press, move, release (play a card)
#   arena.sh state [pos|cards|pool|json|rect]  mirrored DraftState summary
#   arena.sh read X Y W H                      OCR an arbitrary screen region
#   arena.sh pick [top|<grpId>] [--dry-run]    one pick (wraps pick-next-card.sh)
#   arena.sh draft [SECONDS]                   pick on a loop until the draft completes
#   arena.sh awake                             hold the display awake for this shell's lifetime
#   arena.sh log                               tail Player.log for draft events
#   arena.sh build [--dry-run|--read|--no-lands] build the advisor's deck in Arena's builder (never presses Done)
#   arena.sh build --verify [SECONDS]          after Done: diff Arena's submitted deck against the plan
#   arena.sh ocr <image.png>                   Vision OCR of an image, one JSON line per text box
#
# Coordinates here are screen POINTS, not Retina pixels. They are converted to
# fractions of Arena's window before reaching macctl, which reads the rect live
# on every call — there is deliberately no rect to cache.
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

# Hold the display awake for as long as this script runs.
#
# Not a nicety. A display that sleeps unattended comes back LOCKED, and a lock
# is the one failure nothing here can recover from: synthetic input goes to the
# password prompt and only a person at the machine can clear it. Losing a draft
# at pick 23 that way is far worse than losing it at pick 1. The assertion is
# tied to this shell's pid, so it is released however the script ends.
stay_awake() { macctl awake --while-pid $$ >/dev/null 2>&1 || true; }
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
  activate) macctl window MTGA >/dev/null && echo "Arena frontmost" ;;
  front)    macctl apps | python3 -c "import sys,json;print(json.load(sys.stdin)['apps'][0]['name'])" ;;
  rect)     macctl window MTGA | python3 -c "
import sys, json
b = json.load(sys.stdin)['window']['bounds']
print(','.join(str(int(v)) for v in b))
" ;;
  shot)     mkdir -p "$SHOTS"; out="$SHOTS/${1:-shot-$(date +%H%M%S)}.png"; rm -f "$out"
            macctl shot MTGA --out "$out" >/dev/null && echo "$out" ;;
  click)    # Points in, fractions out: macctl reads the rect live so nothing here can cache it.
            IFS=, read -r wx wy ww wh <<< "$("$0" rect)"
            macctl click MTGA "$(python3 -c "print(($1-$wx)/$ww)")" "$(python3 -c "print(($2-$wy)/$wh)")" ;;
  drag)     [ $# -ge 4 ] || die "drag fromX fromY toX toY [steps]"
            IFS=, read -r wx wy ww wh <<< "$("$0" rect)"
            f() { python3 -c "print(($1-$2)/$3)"; }
            macctl drag MTGA "$(f "$1" "$wx" "$ww")" "$(f "$2" "$wy" "$wh")" \
                             "$(f "$3" "$wx" "$ww")" "$(f "$4" "$wy" "$wh")" --steps "${5:-24}" ;;
  move)     IFS=, read -r wx wy ww wh <<< "$("$0" rect)"
            macctl move MTGA "$(python3 -c "print(($1-$wx)/$ww)")" "$(python3 -c "print(($2-$wy)/$wh)")" ;;
  scroll)   IFS=, read -r wx wy ww wh <<< "$("$0" rect)"
            macctl scroll MTGA "$(python3 -c "print(($1-$wx)/$ww)")" "$(python3 -c "print(($2-$wy)/$wh)")" "$3" ;;
  key)
    # A key NAME or chord, handed to macctl. Text and key names are passed as
    # arguments and never interpolated into a script, which is what once turned
    # this single allow-listed command into a route to arbitrary AppleScript.
    [ $# -ge 1 ] || die "key CHORD (e.g. return, escape, cmd+q)"
    macctl key "$1" ;;
  type)
    [ $# -ge 1 ] || die "type TEXT"
    macctl type "$*" ;;
  clear)    macctl key cmd+a; macctl key delete ;;
  state)    # Forward every argument: "state basic 12345" needs both, and passing
            # only the first silently answered "not a basic land".
            [ -f "$MTGA_STATE_FILE" ] || die "no state mirror at $MTGA_STATE_FILE"; state_py "${@:-pos}" ;;
  pick)     bash scripts/dev/pick-next-card.sh "$@" ;;
  awake)    macctl awake --while-pid "${1:-$PPID}" ;;
  build)    stay_awake; [ -f "$MTGA_STATE_FILE" ] || die "no state mirror at $MTGA_STATE_FILE"; npx tsx scripts/dev/deckbuild.ts "$MTGA_STATE_FILE" "$@" ;;
  ocr)      die "removed: use \`macctl read\` or \`macctl find\`" ;;
  read)     macctl read MTGA ;;
  draft)
    stay_awake
    end=$((SECONDS + ${1:-570})); maxpack="${2:-99}"; last=""; retries=0
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
        out=$(bash scripts/dev/pick-next-card.sh top 2>&1 | grep -E '^PICKED|^ABORTING|^NOT RETRYING|^WARNING|REFUS|abort' | tail -1 || true)
        echo "$out"
        # A refused pick leaves the position unchanged, and in a bot draft nothing
        # else ever changes it: there is no pick timer. Marking the position as
        # handled therefore parked the loop on pick 14 of a paid draft until its
        # own budget ran out. Leave it unmarked so the next iteration tries
        # again — a single OCR miss is not absence — but count, so a cell that
        # never verifies stops the loop instead of spinning on it.
        case "$out" in
          *PICKED*) last="$pos"; retries=0 ;;
          *) retries=$((retries + 1)); [ "$retries" -ge 6 ] && { echo "GIVING UP: $pos refused $retries times"; exit 5; }; sleep 2 ;;
        esac
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

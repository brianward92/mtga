#!/usr/bin/env bash
# Capture exactly the current MTG Arena window rectangle. Geometry comes from
# arena-window-watch (CGWindowList; no Accessibility) and screencapture receives
# only a -R region, never a full-screen destination.
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: screenshot-arena.sh [OUTPUT.png]

Capture the current on-screen MTG Arena window region as a PNG.
The default output is ./arena-screenshot-YYYYMMDD-HHMMSS.png.
An existing output file is never overwritten.

Options:
  -h, --help  Show this help.
EOF
}

die() {
  echo "screenshot-arena: $*" >&2
  exit 1
}

case "${1:-}" in
  -h|--help)
    usage
    exit 0
    ;;
  --)
    shift
    ;;
  -*)
    die "unknown option: $1 (use --help)"
    ;;
esac
[ "$#" -le 1 ] || die "expected at most one output path (use --help)"

platform="${MTGA_SCREENSHOT_PLATFORM:-$(uname -s)}"
[ "$platform" = "Darwin" ] || die "macOS is required (screencapture is a macOS tool)"

requested_output="${1:-arena-screenshot-$(date '+%Y%m%d-%H%M%S').png}"
case "$requested_output" in
  */*)
    output_dir_input=${requested_output%/*}
    output_name=${requested_output##*/}
    [ -n "$output_dir_input" ] || output_dir_input=/
    ;;
  *)
    output_dir_input=.
    output_name=$requested_output
    ;;
esac
[ -n "$output_name" ] && [ "$output_name" != "." ] && [ "$output_name" != ".." ] || \
  die "output path must include a file name"
output_dir=$(cd -- "$output_dir_input" 2>/dev/null && pwd -P) || \
  die "output directory does not exist: $output_dir_input"
output="$output_dir/$output_name"
[ -w "$output_dir" ] || die "output directory is not writable: $output_dir"
[ ! -e "$output" ] || die "output already exists: $output"

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
electron_dir=$(cd -- "$script_dir/../.." && pwd -P)

resolve_executable() {
  case "$1" in
    */*) [ -f "$1" ] && [ -x "$1" ] && printf '%s\n' "$1" ;;
    *) command -v "$1" 2>/dev/null ;;
  esac
}

helper=""
if [ -n "${MTGA_ARENA_WINDOW_WATCH:-}" ]; then
  helper=$(resolve_executable "$MTGA_ARENA_WINDOW_WATCH") || \
    die "configured arena-window-watch is not executable: $MTGA_ARENA_WINDOW_WATCH"
else
  for candidate in \
    "$electron_dir/build/native/arena-window-watch" \
    "/Applications/MTGA Draft Assistant.app/Contents/Resources/native/arena-window-watch" \
    "$HOME/Applications/MTGA Draft Assistant.app/Contents/Resources/native/arena-window-watch"
  do
    if [ -f "$candidate" ] && [ -x "$candidate" ]; then
      helper=$candidate
      break
    fi
  done
  [ -n "$helper" ] || die \
    "arena-window-watch not found; run 'npm run build:native' in electron/ or install the app"
fi

screencapture_command="${MTGA_SCREENCAPTURE:-screencapture}"
screencapture_bin=$(resolve_executable "$screencapture_command") || \
  die "screencapture is unavailable: $screencapture_command"

wait_seconds="${MTGA_ARENA_WAIT_SECONDS:-4}"
case "$wait_seconds" in
  ''|*[!0-9]*) die "MTGA_ARENA_WAIT_SECONDS must be a positive integer" ;;
esac
[ "$wait_seconds" -gt 0 ] || die "MTGA_ARENA_WAIT_SECONDS must be a positive integer"

umask 077
runtime_dir=$(mktemp -d "${TMPDIR:-/tmp}/screenshot-arena.XXXXXX") || \
  die "could not create a temporary directory"
control_fifo="$runtime_dir/control"
geometry_fifo="$runtime_dir/geometry"
helper_stderr="$runtime_dir/helper.stderr"
capture_tmp="$runtime_dir/capture.png"
helper_pid=""
control_fd_open=0
geometry_fd_open=0

cleanup() {
  status=$?
  trap - EXIT HUP INT TERM
  set +e
  if [ -n "$helper_pid" ]; then
    kill "$helper_pid" 2>/dev/null
    wait "$helper_pid" 2>/dev/null
  fi
  [ "$geometry_fd_open" = 0 ] || exec 8<&-
  [ "$control_fd_open" = 0 ] || exec 9>&-
  rm -f "$capture_tmp" "$helper_stderr" "$geometry_fifo" "$control_fifo"
  rmdir "$runtime_dir" 2>/dev/null
  exit "$status"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

mkfifo "$control_fifo" "$geometry_fifo"
# Holding the control FIFO open keeps the helper's stdin reader alive. The
# helper exits when this script closes it, and cleanup also sends TERM/waits.
exec 9<>"$control_fifo"
control_fd_open=1
"$helper" <"$control_fifo" >"$geometry_fifo" 2>"$helper_stderr" &
helper_pid=$!
exec 8<"$geometry_fifo"
geometry_fd_open=1

x=""; y=""; width=""; height=""; frontmost=""
saw_no_window=0
deadline=$((SECONDS + wait_seconds))
while [ "$SECONDS" -lt "$deadline" ]; do
  remaining=$((deadline - SECONDS))
  if ! IFS= read -r -t "$remaining" line <&8; then
    break
  fi
  line=${line%$'\r'}
  if [ "$line" = "G NOWIN" ]; then
    saw_no_window=1
    break
  fi
  if [[ "$line" =~ ^G[[:space:]]+(-?[0-9]+),(-?[0-9]+),([1-9][0-9]*),([1-9][0-9]*),([01])$ ]]; then
    x=${BASH_REMATCH[1]}
    y=${BASH_REMATCH[2]}
    width=${BASH_REMATCH[3]}
    height=${BASH_REMATCH[4]}
    frontmost=${BASH_REMATCH[5]}
    break
  fi
done

if [ -z "$width" ]; then
  if [ "$saw_no_window" = 1 ]; then
    die "Arena window not found; start Arena and make sure its window is on screen"
  fi
  if ! kill -0 "$helper_pid" 2>/dev/null; then
    helper_detail=$(sed -n '1p' "$helper_stderr" 2>/dev/null || true)
    [ -z "$helper_detail" ] || helper_detail=": $helper_detail"
    die "arena-window-watch exited before reporting geometry$helper_detail"
  fi
  die "timed out after ${wait_seconds}s waiting for Arena geometry"
fi

if [ "$frontmost" = 0 ]; then
  echo "screenshot-arena: warning: Arena is not frontmost; its region may contain overlapping windows" >&2
fi

region="$x,$y,$width,$height"
if ! "$screencapture_bin" -x -tpng "-R$region" "$capture_tmp"; then
  die "screencapture failed for Arena region $region (check Screen Recording permission)"
fi
[ -s "$capture_tmp" ] || die "screencapture produced no image for Arena region $region"
if ! mv -n "$capture_tmp" "$output"; then
  die "could not write screenshot to $output"
fi
[ ! -e "$capture_tmp" ] || die "output appeared while capturing; existing file was preserved: $output"
echo "Captured Arena region ${width}x${height} at $x,$y to $output"

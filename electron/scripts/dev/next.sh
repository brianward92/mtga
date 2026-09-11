#!/usr/bin/env bash
# Clear the result screen, queue the next bot match with the named deck, and
# answer the mulligan. The whole between-games loop in one command.
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd -P)"
deck="${1:?usage: next.sh <deck name>}"
bash "$here/finish.sh" 2>&1 | tail -1
bash "$here/newgame.sh" "$deck" 2>&1 | tail -1
python3 "$here/mull.py" 180 2>&1 | tail -2

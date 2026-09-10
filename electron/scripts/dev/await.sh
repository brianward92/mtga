#!/usr/bin/env bash
# Wait until the engine asks us something, then say what.
set -uo pipefail
for i in $(seq 1 "${1:-40}"); do
  out=$(npx tsx scripts/dev/match.ts 2>/dev/null)
  if echo "$out" | grep -q "OURS TO ANSWER"; then echo "$out"; exit 0; fi
  if echo "$out" | grep -q "^FINISHED"; then echo "$out"; exit 0; fi
  sleep 2
done
echo "no decision within $(( ${1:-40} * 2 ))s"; npx tsx scripts/dev/match.ts

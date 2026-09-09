#!/usr/bin/env bash
# Content hash of the sources that end up inside the packaged app.
#
# The staleness check used to compare the installed app's timestamp against the
# time of the last commit touching app code. That is wrong in both directions:
# committing after an install marks a current build stale, and editing without
# committing leaves a genuinely stale build looking current. Hash what actually
# ships instead, so the answer depends on content and nothing else.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
find main shared renderer native resources package.json -type f \
  \( -name '*.ts' -o -name '*.js' -o -name '*.json' -o -name '*.html' -o -name '*.css' -o -name '*.swift' \) \
  ! -path '*/node_modules/*' -print0 \
  | sort -z | xargs -0 shasum -a 256 | shasum -a 256 | cut -d' ' -f1

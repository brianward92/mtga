#!/usr/bin/env bash
# Claim the game for the model: refresh the guard's stand-down lock.
# Call this at the top of any ad-hoc command that drives Arena directly.
touch /tmp/mtga-acting 2>/dev/null || true

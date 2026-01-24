#!/usr/bin/env bash
# Add the MTGA repo to PYTHONPATH in the user's shell config.

set -euo pipefail

USER_SHELL=$(basename "${SHELL:-}")
if [[ "$USER_SHELL" == "zsh" ]]; then
    SHELL_CONFIG="${ZDOTDIR:-$HOME}/.zshrc"
elif [[ "$USER_SHELL" == "bash" ]]; then
    SHELL_CONFIG="$HOME/.bashrc"
else
    echo "Unsupported shell ($USER_SHELL). Please run with bash or zsh."
    exit 1
fi

RC_MARKER_START="# BEGIN MTGA ENV CONFIG"
RC_MARKER_END="# END MTGA ENV CONFIG"

read -r -d '' DESIRED_BLOCK <<'EOF' || true

# BEGIN MTGA ENV CONFIG
export PYTHONPATH="$HOME/src/mtga:${PYTHONPATH:-}"
# END MTGA ENV CONFIG
EOF

if [ -f "$SHELL_CONFIG" ] && grep -q "$RC_MARKER_START" "$SHELL_CONFIG"; then
    EXISTING_BLOCK=$(sed -n "/$RC_MARKER_START/,/$RC_MARKER_END/p" "$SHELL_CONFIG")
    if [ "$EXISTING_BLOCK" = "$DESIRED_BLOCK" ]; then
        echo "MTGA shell block already present and up to date in $SHELL_CONFIG"
    else
        echo "Updating MTGA shell block in $SHELL_CONFIG"
        sed -i.bak "/$RC_MARKER_START/,/$RC_MARKER_END/d" "$SHELL_CONFIG" && rm -f "$SHELL_CONFIG.bak"
        echo "$DESIRED_BLOCK" >> "$SHELL_CONFIG"
    fi
else
    echo "Adding MTGA shell block to $SHELL_CONFIG"
    mkdir -p "$(dirname "$SHELL_CONFIG")"
    touch "$SHELL_CONFIG"
    echo "$DESIRED_BLOCK" >> "$SHELL_CONFIG"
fi

echo
echo "Done. Restart your shell or run: source \"$SHELL_CONFIG\""

#!/bin/bash

# Source, Globals
source "$HOME/.zshrc"
CURRENT_DATE=$(date +%Y-%m-%d)
SUBJECT="Daily for $CURRENT_DATE"
THIS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Script Paths
SCRYFALL_SCRIPT="$THIS_DIR/run_scryfall_download.py"
PROCESSOR_SCRIPT="$THIS_DIR/run_scryfall_processor.py"

# Scryfall Update
python "$SCRYFALL_SCRIPT"

# Process into parquet (depends on download completing first)
python "$PROCESSOR_SCRIPT"

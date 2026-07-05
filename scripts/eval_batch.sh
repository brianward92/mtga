#!/bin/bash
# Evaluate every trained checkpoint on the dev trio (zero-shot) — run on n42
# after the training queues drain. Fine-tuned models are additionally noted:
# their predictions cover the full set; comparisons against per-set ceilings
# must filter to crc32 val drafts in analysis (the predictions parquets carry
# draft_id, so evalproto-side filtering stays deterministic).
set -e
export MTGA_DATA_ROOT=$HOME/dat/mtga
cd ~/src/mtga

RUNS=$HOME/dat/mtga/foundation/runs
for dir in "$RUNS"/*/; do
    name=$(basename "$dir")
    [ -f "$dir/best.pt" ] || continue
    [ -f "$dir/zeroshot/summary.json" ] && { echo "skip $name (evaluated)"; continue; }
    case "$name" in
        *smoke*) echo "skip $name (smoke)"; continue ;;
        *ft_sos*) sets="SOS" ;;
        *ft_bro*) sets="BRO" ;;
        *ft_tmt*) sets="TMT" ;;
        *) sets="BRO,TMT,SOS" ;;
    esac
    echo "=== eval $name on $sets ($(date +%H:%M)) ==="
    .venv-fm/bin/python scripts/eval_draftfm.py --run "$dir" --sets "$sets" --device mps
done
echo EVAL-BATCH-DONE

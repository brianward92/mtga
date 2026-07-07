#!/usr/bin/env python
"""Paired-difference CIs for the ablation deltas quoted in
paper/sections/analysis.tex ("The licensed-IP shift" paragraph).

Table~\\ref{tab:ablations}'s caption promises "paired-difference CIs
accompany the deltas in the text," but the deltas (A-notext vs. Full,
A-noUB vs. A-noctx) were originally reported as plain cell-to-cell
arithmetic with no CI of their own -- only the per-cell single-model CIs
in the table. This script computes the real thing:
evalproto.paired_bootstrap_diff on each pair's cached zero-shot predictions
for the same dev-trio set, which shares draft resamples across the two
models and so is the correct CI for a difference, not a wider/narrower
proxy from two independent per-cell CIs.

Frozen-eval discipline: reads only already-cached zero-shot prediction
parquets (mtga/foundation/predict.py output, expert slice); never re-runs
a model, never touches MSH.

Usage:
  .venv-ml/bin/python scripts/eval_ablation_deltas.py
"""

import json
from pathlib import Path

import pandas as pd

from mtga.foundation import evalproto

DEV_SETS = ["BRO", "TMT", "SOS"]
REPO = Path(__file__).resolve().parent.parent

# (run_dir, label) pairs. Prefer the durable data root; fall back to the
# repo's paper/data mirror, matching make_paper_tables.py's discover order.
RUN_DIRS = {
    "full": [Path("/opt/bward/dat/mtga/foundation/runs/20260704_135822_f_dev")],
    "a_notext": [
        Path("/opt/bward/dat/mtga/foundation/runs/20260704_135710_a_notext"),
        REPO / "paper/data/runs/20260704_135710_a_notext",
    ],
    "a_noctx": [
        Path("/opt/bward/dat/mtga/foundation/runs/20260704_160422_a_noctx"),
        REPO / "paper/data/runs/20260704_160422_a_noctx",
    ],
    "a_noub": [
        Path("/opt/bward/dat/mtga/foundation/runs/20260705_164029_a_noUB"),
        REPO / "paper/data/runs/20260705_164029_a_noUB",
    ],
}

# (name_a, name_b, label) -- delta reported is A minus B, matching the
# existing prose ("A-notext vs. Full", "A-noUB vs. A-noctx").
DELTAS = [
    ("full", "a_notext", "text_penalty"),   # Full - A-notext = cost of dropping text
    ("a_noctx", "a_noub", "ub_penalty"),    # A-noctx - A-noUB = cost of dropping licensed-IP training sets
]


def resolve_run_dir(candidates):
    for c in candidates:
        if (c / "zeroshot").is_dir():
            return c
    raise FileNotFoundError(f"no zeroshot/ dir found in any of {candidates}")


def load_expert(run_dir, set_code):
    path = run_dir / "zeroshot" / f"{set_code}.PremierDraft.parquet"
    frame = evalproto.validate(pd.read_parquet(path))
    return evalproto.expert_slice(frame)


def main():
    resolved = {name: resolve_run_dir(dirs) for name, dirs in RUN_DIRS.items()}
    for name, path in resolved.items():
        print(f"{name}: {path}")

    report = {}
    for name_a, name_b, label in DELTAS:
        print(f"\n== {label}: {name_a} - {name_b} ==")
        report[label] = {}
        for s in DEV_SETS:
            frame_a = load_expert(resolved[name_a], s)
            frame_b = load_expert(resolved[name_b], s)
            point, lo, hi = evalproto.paired_bootstrap_diff(
                frame_a, frame_b, evalproto.top1)
            report[label][s] = {"point": point, "ci": [lo, hi]}
            sig = "outside 0" if (lo > 0 or hi < 0) else "CONTAINS 0"
            print(f"  {s}: {point:+.4f} ({100 * point:+.1f}pp) "
                  f"CI [{lo:+.4f}, {hi:+.4f}] ({sig})")
        dev_mean = sum(report[label][s]["point"] for s in DEV_SETS) / 3
        print(f"  dev-mean: {dev_mean:+.4f} ({100 * dev_mean:+.1f}pp)")
        report[label]["dev_mean"] = dev_mean

    out_path = REPO / "experiments" / "ablation_deltas.json"
    out_path.write_text(json.dumps(report, indent=2, default=str))
    print(f"\nwrote {out_path}")


if __name__ == "__main__":
    main()

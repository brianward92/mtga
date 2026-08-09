#!/usr/bin/env python
"""Train the win-probability v2 CROSS-SET models + card-value economics.

The v1 model (scripts/train_winprob.py) fits one set (DSK). This is the
DraftFM-style extension: fit ONE V(state) = P(win | turn state) model across
every available set's replay_turns data, and report zero-shot calibration on
sets the model never trained on -- that zero-shot number is the headline
result. See mtga/winprob/train.py's module docstring and
DEFAULT_TRAIN_SETS/DEFAULT_HOLDOUT_SETS for which sets and why.

Usage:
    .venv-ml/bin/python scripts/train_winprob_v2.py
    .venv-ml/bin/python scripts/train_winprob_v2.py --tag v2-crossset \
        --train-sets DSK,BLB,MOM --holdout-sets MH3,OTJ
"""

import argparse
import json

import numpy as np

from mtga.winprob import data as wdata
from mtga.winprob import economics
from mtga.winprob import train as wtrain


def create_parser():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--format", dest="limited_type", default="PremierDraft")
    parser.add_argument(
        "--train-sets",
        default=",".join(wtrain.DEFAULT_TRAIN_SETS),
        help="comma set codes to train on",
    )
    parser.add_argument(
        "--holdout-sets",
        default=",".join(wtrain.DEFAULT_HOLDOUT_SETS),
        help="comma set codes held out entirely (zero-shot eval)",
    )
    parser.add_argument(
        "--per-set-row-cap",
        type=int,
        default=wtrain.DEFAULT_PER_SET_ROW_CAP,
        help="cap on training rows per set (0 = no cap)",
    )
    parser.add_argument("--epochs", type=int, default=8)
    parser.add_argument("--batch-size", type=int, default=8192)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--seed", type=int, default=17)
    parser.add_argument("--patience", type=int, default=2)
    parser.add_argument("--val-permille", type=int, default=wtrain.VAL_PERMILLE)
    parser.add_argument(
        "--tag",
        default="v2-crossset",
        help="artifact dir name under <MODELS_DIR>/_winprob/",
    )
    return parser


def main():
    args = create_parser().parse_args()
    train_sets = [s.strip().upper() for s in args.train_sets.split(",") if s.strip()]
    holdout_sets = [
        s.strip().upper() for s in args.holdout_sets.split(",") if s.strip()
    ]
    overlap = set(train_sets) & set(holdout_sets)
    if overlap:
        raise SystemExit(f"sets in both --train-sets and --holdout-sets: {overlap}")

    models, report, context = wtrain.train_multiset(
        train_sets,
        holdout_sets,
        limited_type=args.limited_type,
        per_set_row_cap=args.per_set_row_cap or None,
        epochs=args.epochs,
        batch_size=args.batch_size,
        lr=args.lr,
        seed=args.seed,
        patience=args.patience,
        val_permille=args.val_permille,
    )
    out_dir = wtrain.save_version_multiset(models, report, context, tag=args.tag)

    mean, std = context["_scaler"]
    data = context["_data"]
    val_idx = context["_val_idx"]

    # Pooled cross-set economics (the new headline, directly comparable to
    # v1's DSK-only economics.json).
    econ = economics.compute(models["mlp"], mean, std, data, val_idx, seed=args.seed)
    economics.save(econ, out_dir)

    # Per-set breakdown: does the exchange rate hold across sets, or is it a
    # DSK-specific artifact? Training sets from the within-training val
    # split; holdout sets from their own full (zero-shot) data.
    by_set = economics.compute_by_set(
        models["mlp"], mean, std, data, val_idx, train_sets, seed=args.seed
    )
    for set_code in holdout_sets:
        z = report["zero_shot"].get(set_code)
        if z is None:
            continue
        hdata = wdata.load_dataset(set_code, args.limited_type)
        by_set[set_code] = economics.compute(
            models["mlp"], mean, std, hdata, np.arange(hdata.n_rows), seed=args.seed
        )

    with open(out_dir / "economics_by_set.json", "w") as fh:
        json.dump(by_set, fh, indent=2)

    record = wtrain.ledger_run_multiset(report, context, out_dir, economics=econ)
    print(f"saved {out_dir}")
    print(f"ledgered {record['run_id']}")
    print(f"train_sets ({len(train_sets)}): {train_sets}")
    print(f"holdout_sets: {holdout_sets}")
    print(
        json.dumps(
            {
                "n_rows": report["n_rows"],
                "n_games": report["n_games"],
                "n_train": report["n_train"],
                "n_val": report["n_val"],
                "models": report["models"],
                "nonlinearity_gap": report["nonlinearity_gap"],
                "zero_shot_mlp_auc_mean": report["zero_shot_mlp_auc_mean"],
            },
            indent=2,
        )
    )
    print()
    for set_code, z in report["zero_shot"].items():
        print(
            f"-- zero-shot {set_code} ({z['n_rows']:,} rows / "
            f"{z['n_games']:,} games) --"
        )
        print(json.dumps(z["models"]["mlp"]["pooled"], indent=2))
    print()
    print(economics.render_table(econ))
    print()
    print(economics.render_by_set_table(by_set))


if __name__ == "__main__":
    main()

#!/usr/bin/env python
"""Train the win-probability v1 models + card-value economics for one set/format.

Fits all three comparison heads (life-diff logistic, full logistic, MLP) on
turn-level replay states, evaluates per turn bucket, derives the card-value
economics from the MLP, and persists everything under
<MODELS_DIR>/_winprob/<tag>/. The run is ledgered via mtga.foundation.runlog.

Usage:
    .venv-ml/bin/python scripts/train_winprob.py --set DSK
"""

import argparse
import json

from mtga.models import draftnet
from mtga.winprob import economics
from mtga.winprob import train as wtrain


def create_parser():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--set", dest="set_code", required=True)
    parser.add_argument("--format", dest="limited_type", default="PremierDraft")
    parser.add_argument("--epochs", type=int, default=8)
    parser.add_argument("--batch-size", type=int, default=8192)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--seed", type=int, default=17)
    parser.add_argument("--patience", type=int, default=2)
    parser.add_argument("--val-permille", type=int, default=draftnet.VAL_PERMILLE)
    parser.add_argument(
        "--subsample",
        type=int,
        default=3_000_000,
        help="cap on training rows (0 = all)",
    )
    parser.add_argument(
        "--tag", default=None, help="artifact dir name (default: v1-<set>)"
    )
    return parser


def main():
    args = create_parser().parse_args()
    models, report, context = wtrain.train(
        args.set_code.upper(),
        args.limited_type,
        epochs=args.epochs,
        batch_size=args.batch_size,
        lr=args.lr,
        seed=args.seed,
        patience=args.patience,
        val_permille=args.val_permille,
        subsample=args.subsample or None,
    )
    out_dir = wtrain.save_version(models, report, context, tag=args.tag)

    mean, std = context["_scaler"]
    econ = economics.compute(
        models["mlp"], mean, std, context["_data"], context["_val_idx"], seed=args.seed
    )
    economics.save(econ, out_dir)

    record = wtrain.ledger_run(report, context, out_dir, economics=econ)
    print(f"saved {out_dir}")
    print(f"ledgered {record['run_id']}")
    print(
        json.dumps(
            {
                "anchors": report["anchors"],
                "models": report["models"],
                "nonlinearity_gap": report["nonlinearity_gap"],
            },
            indent=2,
        )
    )
    print()
    print(economics.render_table(econ))


if __name__ == "__main__":
    main()

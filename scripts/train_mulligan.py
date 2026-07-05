#!/usr/bin/env python
"""Train, evaluate, and persist the mulligan v1 model for one set/format.

P(win | opening hand, on_play, deck, hand_size) on kept replay decisions,
plus the empirical continuation table for the keep/mull decision rule.
Artifacts land in <MODELS_DIR>/_mulligan/<tag>/ and the run is ledgered via
mtga.foundation.runlog.

Usage:
    .venv-ml/bin/python scripts/train_mulligan.py --set DSK
"""

import argparse
import json

from mtga.models import draftnet
from mtga.mulligan import train as mtrain
from mtga.mulligan.model import DEFAULT_DROPOUT


def create_parser():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--set", dest="set_code", required=True)
    parser.add_argument("--format", dest="limited_type", default="PremierDraft")
    parser.add_argument("--epochs", type=int, default=8)
    parser.add_argument("--batch-size", type=int, default=4096)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--hidden", default="128,64",
                        help="comma widths of the MLP hidden layers")
    parser.add_argument("--dropout", type=float, default=DEFAULT_DROPOUT)
    parser.add_argument("--seed", type=int, default=17)
    parser.add_argument("--patience", type=int, default=2)
    parser.add_argument("--val-permille", type=int,
                        default=draftnet.VAL_PERMILLE)
    parser.add_argument("--subsample", type=int, default=None,
                        help="cap on training rows (default: all kept rows)")
    parser.add_argument("--tag", default=None,
                        help="artifact dir name (default: v1-<set>)")
    return parser


def main():
    args = create_parser().parse_args()
    hidden = tuple(int(w) for w in args.hidden.split(",") if w.strip())
    model, report, context = mtrain.train(
        args.set_code.upper(), args.limited_type, epochs=args.epochs,
        batch_size=args.batch_size, lr=args.lr, hidden=hidden,
        dropout=args.dropout, seed=args.seed, patience=args.patience,
        val_permille=args.val_permille, subsample=args.subsample,
    )
    out_dir = mtrain.save_version(model, report, context, tag=args.tag)
    record = mtrain.ledger_run(report, context, out_dir)
    print(f"saved {out_dir}")
    print(f"ledgered {record['run_id']}")
    print(json.dumps({k: report[k] for k in
                      ["anchors", "outcome_head", "sanity", "decision"]},
                     indent=2))


if __name__ == "__main__":
    main()

#!/usr/bin/env python
"""Train, evaluate, and persist the mulligan model: v1 (one set) or v2
(--sets, cross-set with an optional --held-out zero-shot leg).

P(win | opening hand, on_play, deck, hand_size) on kept replay decisions,
plus the empirical continuation table for the keep/mull decision rule.
Artifacts land in <MODELS_DIR>/_mulligan/<tag>/ and the run is ledgered via
mtga.foundation.runlog.

Usage:
    .venv-ml/bin/python scripts/train_mulligan.py --set DSK
    .venv-ml/bin/python scripts/train_mulligan.py \\
        --sets BLB,DFT,DMU,DSK,ECL,EOE,HBG,KTK,LCI,MH3,MOM,OTJ,PIO,SIR,SNC,SOS,TDM,TLA,TMT,WOE \\
        --held-out LTR,MKM --tag v2-crossset
"""

import argparse
import json

from mtga.models import draftnet
from mtga.mulligan import train as mtrain
from mtga.mulligan.model import DEFAULT_DROPOUT


def create_parser():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--set", dest="set_code", help="v1: single set to train on")
    parser.add_argument(
        "--sets",
        dest="train_sets",
        help="v2: comma-separated sets to train on (cross-set)",
    )
    parser.add_argument(
        "--held-out",
        dest="held_out_sets",
        default="",
        help="v2: comma-separated sets excluded from " "training, scored zero-shot",
    )
    parser.add_argument("--format", dest="limited_type", default="PremierDraft")
    parser.add_argument("--epochs", type=int, default=8)
    parser.add_argument("--batch-size", type=int, default=4096)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument(
        "--hidden", default="128,64", help="comma widths of the MLP hidden layers"
    )
    parser.add_argument("--dropout", type=float, default=DEFAULT_DROPOUT)
    parser.add_argument("--seed", type=int, default=17)
    parser.add_argument("--patience", type=int, default=2)
    parser.add_argument("--val-permille", type=int, default=draftnet.VAL_PERMILLE)
    parser.add_argument(
        "--subsample",
        type=int,
        default=None,
        help="cap on training rows (default: all kept rows)",
    )
    parser.add_argument(
        "--tag",
        default=None,
        help="artifact dir name (default: v1-<set> / " "v2-crossset)",
    )
    return parser


def _split(arg):
    return [s.strip().upper() for s in arg.split(",") if s.strip()]


def main():
    args = create_parser().parse_args()
    if not args.set_code and not args.train_sets:
        raise SystemExit("pass --set (v1) or --sets (v2, cross-set)")
    hidden = tuple(int(w) for w in args.hidden.split(",") if w.strip())

    if args.train_sets:
        model, report, context = mtrain.train_crossset(
            _split(args.train_sets),
            args.limited_type,
            held_out_sets=_split(args.held_out_sets),
            epochs=args.epochs,
            batch_size=args.batch_size,
            lr=args.lr,
            hidden=hidden,
            dropout=args.dropout,
            seed=args.seed,
            patience=args.patience,
            val_permille=args.val_permille,
            subsample=args.subsample,
        )
        out_dir = mtrain.save_crossset_version(
            model, report, context, tag=args.tag or "v2-crossset"
        )
        record = mtrain.ledger_run_crossset(report, context, out_dir)
        summary_keys = ["anchors", "outcome_head", "decision", "held_out"]
    else:
        model, report, context = mtrain.train(
            args.set_code.upper(),
            args.limited_type,
            epochs=args.epochs,
            batch_size=args.batch_size,
            lr=args.lr,
            hidden=hidden,
            dropout=args.dropout,
            seed=args.seed,
            patience=args.patience,
            val_permille=args.val_permille,
            subsample=args.subsample,
        )
        out_dir = mtrain.save_version(model, report, context, tag=args.tag)
        record = mtrain.ledger_run(report, context, out_dir)
        summary_keys = ["anchors", "outcome_head", "sanity", "decision"]

    print(f"saved {out_dir}")
    print(f"ledgered {record['run_id']}")
    print(json.dumps({k: report[k] for k in summary_keys if k in report}, indent=2))


if __name__ == "__main__":
    main()

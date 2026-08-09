#!/usr/bin/env python
"""Train a DraftFM foundation model over corpus shards.

train_draftfm.py --name f_dev --holdout BRO,TMT,SOS
train_draftfm.py --name s1 --sets NEO
train_draftfm.py --name a_notext --holdout BRO,TMT,SOS --no-text
train_draftfm.py --name a_extras --holdout BRO,TMT,SOS --extras VOW.QuickDraft
"""

import argparse

from mtga.foundation.train import TrainConfig, train
from mtga.lands import corpus


def create_parser():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--name", required=True)
    parser.add_argument(
        "--sets", default=None, help="comma set codes (default: full training corpus)"
    )
    parser.add_argument(
        "--extras",
        default="",
        help="comma-separated corpus.EXTRAS keys to append "
        "(opt-in ablation, e.g. VOW.QuickDraft; never "
        "included by default)",
    )
    parser.add_argument(
        "--holdout", default="", help="comma set codes excluded from training"
    )
    parser.add_argument("--seed", type=int, default=17)
    parser.add_argument("--batch-size", type=int, default=8192)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--epochs", type=float, default=4.0)
    parser.add_argument("--max-steps", type=int, default=0)
    parser.add_argument("--warmup-steps", type=int, default=2000)
    parser.add_argument("--d-model", type=int, default=256)
    parser.add_argument("--dropout", type=float, default=0.1)
    parser.add_argument("--no-set-ctx", dest="set_ctx", action="store_false")
    parser.add_argument(
        "--no-text",
        action="store_true",
        help="ablation: structured features only (391-d)",
    )
    parser.add_argument(
        "--skill-filter",
        action="store_true",
        help="ablation: train on expert picks only",
    )
    parser.add_argument(
        "--init-from", default="", help="checkpoint path: fine-tune from these weights"
    )
    parser.add_argument("--sampling-alpha", type=float, default=0.5)
    parser.add_argument("--val-every", type=int, default=2000)
    parser.add_argument("--patience", type=int, default=3)
    parser.add_argument("--device", default="mps")
    parser.add_argument("--no-parity-check", dest="parity_check", action="store_false")
    return parser


def main():
    args = create_parser().parse_args()
    if args.sets:
        requested = [s.strip().upper() for s in args.sets.split(",")]
        pairs = corpus.corpus_jobs(requested)
    else:
        pairs = corpus.corpus_jobs(None)
    if args.extras:
        extra_keys = [e.strip() for e in args.extras.split(",") if e.strip()]
        pairs += corpus.extras_jobs(extra_keys)
    holdout = {s.strip().upper() for s in args.holdout.split(",") if s.strip()}
    pairs = [(s, f) for s, f in pairs if s not in holdout]

    config = TrainConfig(
        name=args.name,
        sets=pairs,
        seed=args.seed,
        batch_size=args.batch_size,
        lr=args.lr,
        epochs=args.epochs,
        max_steps=args.max_steps,
        warmup_steps=args.warmup_steps,
        d_model=args.d_model,
        dropout=args.dropout,
        set_ctx=args.set_ctx,
        sampling_alpha=args.sampling_alpha,
        val_every=args.val_every,
        patience=args.patience,
        device=args.device,
        parity_check=args.parity_check,
        no_text=args.no_text,
        skill_filter=args.skill_filter,
        init_from=args.init_from,
    )
    record = train(config)
    print(
        f"run {record['run_id']}: best val top1 {record['best_val_top1']:.4f} "
        f"at step {record['best_step']} "
        f"({record['n_params']:,} params, {record['wall_clock_s']}s)"
    )


if __name__ == "__main__":
    main()

#!/usr/bin/env python
"""Train, evaluate, export, and (gated) promote a DraftNet pick model.

Cron mode: --all-tracked --if-new-data --promote retrains only when the
curated draft data's source ETag differs from the latest model's data_etag.
"""

import argparse
import json

from mtga.lands import config, corpus, paths
from mtga.models import draftnet


def create_parser():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--set", dest="set_code")
    parser.add_argument("--format", dest="limited_type", default="PremierDraft")
    parser.add_argument("--epochs", type=int, default=20)
    parser.add_argument("--batch-size", type=int, default=1024)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--hidden", default="512,512",
                        help="comma widths; empty string = logistic baseline")
    parser.add_argument("--dropout", type=float, default=draftnet.DEFAULT_DROPOUT)
    parser.add_argument("--min-wr-bucket", type=float,
                        default=draftnet.DEFAULT_MIN_WR_BUCKET)
    parser.add_argument("--min-games-bucket", type=int,
                        default=draftnet.DEFAULT_MIN_GAMES_BUCKET)
    parser.add_argument("--seed", type=int, default=17)
    parser.add_argument("--tag", default=None)
    parser.add_argument("--promote", action="store_true")
    parser.add_argument("--force-promote", action="store_true")
    parser.add_argument("--all-tracked", action="store_true")
    parser.add_argument("--if-new-data", action="store_true")
    return parser


def data_is_new(set_code, limited_type):
    curated_meta = paths.meta_path(paths.curated_path("draft", set_code, limited_type))
    if not curated_meta.exists():
        return False
    with open(curated_meta) as file:
        etag = json.load(file).get("source_etag")
    latest_meta = paths.MODELS_DIR / set_code / limited_type / "latest" / "meta.json"
    if not latest_meta.exists():
        return True
    with open(latest_meta) as file:
        return json.load(file).get("data_etag") != etag


def run_one(args, set_code, limited_type):
    if not paths.curated_path("draft", set_code, limited_type).exists():
        print(f"skip {set_code} {limited_type}: no curated draft data")
        return
    if args.if_new_data and not data_is_new(set_code, limited_type):
        print(f"skip {set_code} {limited_type}: model already trained on this data")
        return

    hidden = [int(w) for w in args.hidden.split(",") if w.strip()] or []
    model, report, context = draftnet.train(
        set_code, limited_type, epochs=args.epochs, batch_size=args.batch_size,
        lr=args.lr, hidden=hidden, dropout=args.dropout,
        min_wr_bucket=args.min_wr_bucket, min_games_bucket=args.min_games_bucket,
        seed=args.seed,
    )
    out_dir = draftnet.save_version(model, report, context, tag=args.tag)
    print(f"saved {out_dir}")
    print(json.dumps({k: report[k] for k in ["val", "val_top_quartile", "baselines"]},
                     indent=2))
    if args.promote or args.force_promote:
        draftnet.promote(out_dir, force=args.force_promote)


def main():
    args = create_parser().parse_args()
    if args.all_tracked:
        for set_code in config.TRACKED_SETS:
            # corpus.EVAL_ONLY sets are held out of training by protocol; the
            # serving list may still carry them (they are draftable), so the
            # gate lives here too, not only in corpus.corpus_jobs.
            if set_code.upper() in corpus.EVAL_ONLY:
                print(f"skip {set_code}: EVAL_ONLY holdout (never train)")
                continue
            run_one(args, set_code, "PremierDraft")
    else:
        if not args.set_code:
            raise SystemExit("--set required (or --all-tracked)")
        run_one(args, args.set_code.upper(), args.limited_type)


if __name__ == "__main__":
    main()

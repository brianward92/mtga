#!/usr/bin/env python
"""Zero-shot evaluation of a DraftFM checkpoint on held-out sets.

  eval_draftfm.py --run <run_dir> --sets BRO,TMT,SOS [--device mps]
                  [--wr-id 33] [--out-dir ...]

Writes one predictions parquet per (set, format) plus a summary json.
Dev sets only — MSH goes through scripts/run_frozen_eval.py, never this.
"""

import argparse
import json
from pathlib import Path

import torch

from mtga.foundation import evalproto, predict
from mtga.foundation.model import DraftFM
from mtga.lands import corpus, paths


def create_parser():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", required=True, help="run dir containing best.pt")
    parser.add_argument("--sets", required=True)
    parser.add_argument("--formats", default="PremierDraft")
    parser.add_argument("--device", default="cpu")
    parser.add_argument(
        "--wr-id",
        type=int,
        default=33,
        help="deployment-mode skill bucket id (33 ~ 0.66 wr)",
    )
    parser.add_argument("--games-id", type=int, default=6, help="1000-games bucket")
    parser.add_argument("--out-dir", default=None)
    return parser


def load_model(run_dir):
    checkpoint = torch.load(
        Path(run_dir) / "best.pt", map_location="cpu", weights_only=False
    )
    config = checkpoint["config"]
    # feat dim from any shard is constant; infer from state dict instead.
    feat_dim = checkpoint["model"]["card_encoder.net.0.weight"].shape[0]
    model = DraftFM(feat_dim, config["d_model"], config["dropout"], config["set_ctx"])
    model.load_state_dict(checkpoint["model"])
    return model, checkpoint


def main():
    args = create_parser().parse_args()
    sets = [s.strip().upper() for s in args.sets.split(",")]
    if set(sets) & corpus.EVAL_ONLY:
        raise SystemExit("MSH is frozen-eval only (scripts/run_frozen_eval.py)")
    formats = [f.strip() for f in args.formats.split(",")]
    model, checkpoint = load_model(args.run)
    out_dir = Path(args.out_dir or (Path(args.run) / "zeroshot"))
    out_dir.mkdir(parents=True, exist_ok=True)

    summaries = {}
    for set_code in sets:
        for fmt in formats:
            frame = predict.foundation_predictions(
                model,
                set_code,
                fmt,
                device=args.device,
                condition_wr_id=args.wr_id,
                condition_games_id=args.games_id,
            )
            frame.to_parquet(out_dir / f"{set_code}.{fmt}.parquet", index=False)
            expert = evalproto.expert_slice(frame)
            summaries[f"{set_code}.{fmt}"] = {
                "expert": evalproto.summarize(expert, f"{set_code} expert"),
                "all_users_top1": evalproto.top1(frame),
                "n_all": len(frame),
            }
            e = summaries[f"{set_code}.{fmt}"]["expert"]
            print(
                f"{set_code} {fmt}: expert top1 {e['top1']:.4f} "
                f"(CI {e['top1_ci'][0]:.4f}-{e['top1_ci'][1]:.4f}) "
                f"top3 {e['top3']:.4f} n={e['n_picks']:,}",
                flush=True,
            )

    dev_mean = sum(
        s["expert"]["top1"] for k, s in summaries.items() if k.endswith("PremierDraft")
    ) / max(sum(1 for k in summaries if k.endswith("PremierDraft")), 1)
    result = {
        "run": str(args.run),
        "best_step": checkpoint.get("step"),
        "wr_id": args.wr_id,
        "dev_mean_expert_top1": dev_mean,
        "summaries": summaries,
    }
    (out_dir / "summary.json").write_text(json.dumps(result, indent=2, default=str))
    print(f"dev-trio mean (Premier, expert): {dev_mean:.4f}")


if __name__ == "__main__":
    main()

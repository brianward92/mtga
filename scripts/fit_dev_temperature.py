#!/usr/bin/env python
"""Fit the frozen dev-only softmax temperature for DraftFM (eval-protocol-v1).

docs/eval_protocol.md section 3 ("Metrics"): "top-label ECE, 15 equal-mass
bins (no post-hoc temperature on MSH; optional temperature fit on dev only,
frozen into the battery config)". This script performs that fit -- on
{BRO, TMT, SOS} ONLY, never MSH -- and reports the frozen choice. It fills
only the dev-side half of analysis.tex's \\pending{temperature decision +
MSH ECE}; the MSH half stays pending until the frozen eval runs.

Method
------
1. One real inference pass per dev set (F-dev checkpoint, expert slice,
   deployment condition wr_id=33/games_id=6 -- the same condition used for
   every other number in the paper) produces the raw per-candidate logits
   [n_picks, 16] BEFORE softmax. These are cached to
   <run-dir>/temperature_fit/logits_cache/<SET>.<fmt>.npz for reuse/audit,
   since the cached zeroshot/*.parquet files only carry post-softmax summary
   columns (pick_prob/top_prob) and cannot be rescaled after the fact.
2. A grid of temperatures T is swept OVER THE CACHED LOGITS (no re-running
   the network per T -- T only rescales an already-computed logit vector):
   probs = softmax(logits / T). ECE/log-loss/top-1 are recomputed at each T
   with the frozen evalproto.py functions.
3. Two sanity checks run at every T: (a) per-row probabilities sum to 1;
   (b) target_rank recomputed from the T-scaled logits is bit-identical to
   the T=1 rank (dividing by a positive constant is monotonic, so WHICH
   candidate is argmax cannot change -- only confidence does). An
   AssertionError here means the temperature application is wrong.
4. The frozen T is chosen by the unweighted mean over the dev trio (the
   same aggregation eval_protocol.md section 2 uses for every other dev
   decision), of mean log-loss (NLL) -- not ECE directly. This mirrors the
   standard temperature-scaling method (Guo et al. 2017): NLL is a smooth,
   proper scoring rule; directly minimizing binned ECE is not (it can
   overfit bin edges and eval_protocol.md's own tie-break convention for
   every other dev decision already prefers mean log-loss over a
   thresholded/binned statistic). The ECE-minimizing T is reported alongside
   for transparency; the script flags if the two disagree.

IMPORTANT deviation from the brief, flagged rather than smoothed over
------------------------------------------------------------------------
The F-dev training checkpoint
(/opt/bward/dat/mtga/foundation/runs/20260704_135822_f_dev/best.pt) is NOT
present on this machine (record.json and the cached zeroshot/ parquets are;
best.pt is not, and no copy was found anywhere under /opt/bward or /opt).
In its place this script uses the already-exported, already-parity-validated
ONNX graphs at /opt/bward/dat/mtga/models/_foundation/fdev-20260704/
(card_encoder.onnx + set_encoder.onnx + scorer.onnx, produced by
mtga.foundation.export.export_graphs). That export's meta.json records
checkpoint_step=34000, checkpoint_val_top1=0.6842710620146123, seed=17, and
the identical 53-shard training config -- matching record.json's
best_step/best_val_top1 to full float precision -- and export_version()
only ever writes meta.json after validating ONNX-vs-torch parity to
< 1e-4 (see export.validate_export). This script re-validates that the T=1
numbers it reproduces from ONNX match the already-published
\\FdevBroEce/\\FdevTmtEce/\\FdevSosEce macros (computed from the torch model's
own cached predictions) as a live parity cross-check, and hard-fails if they
don't.

Usage
-----
  .venv-ml/bin/python scripts/fit_dev_temperature.py --sets BRO
  .venv-ml/bin/python scripts/fit_dev_temperature.py --sets BRO,TMT,SOS \\
      --temps 0.3:3.0:0.02
"""

import argparse
import json
import time
from pathlib import Path

import numpy as np
import onnxruntime
import pandas as pd
import torch

from mtga.foundation import evalproto
from mtga.foundation.dataset import shard_dir
from mtga.foundation.export import onnx_logits
from mtga.foundation.model import position_features
from mtga.foundation.predict import _pick_meta

DEFAULT_MODEL_DIR = "/opt/bward/dat/mtga/models/_foundation/fdev-20260704"
DEFAULT_RUN_DIR = "/opt/bward/dat/mtga/foundation/runs/20260704_135822_f_dev"
BATCH = 8192

# Already-published T=1 dev-trio ECE macros (paper/tables/numbers.tex),
# computed from the torch model's own cached zeroshot predictions -- used
# below as a hard parity gate on the ONNX substitute.
PUBLISHED_T1_ECE = {"BRO": 0.102, "TMT": 0.071, "SOS": 0.093}
PUBLISHED_ECE_TOL = 0.0006  # rounding tolerance on the 3-decimal macros


def create_parser():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--model-dir", default=DEFAULT_MODEL_DIR,
                        help="dir with card_encoder/set_encoder/scorer .onnx + constants.npz")
    parser.add_argument("--run-dir", default=DEFAULT_RUN_DIR,
                        help="F-dev run dir (for record.json cross-check + cache/summary output)")
    parser.add_argument("--sets", default="BRO,TMT,SOS")
    parser.add_argument("--format", default="PremierDraft")
    parser.add_argument("--wr-id", type=int, default=33)
    parser.add_argument("--games-id", type=int, default=6)
    parser.add_argument("--batch-size", type=int, default=BATCH)
    parser.add_argument("--temps", default="0.30:3.00:0.02",
                        help="start:stop:step (inclusive) grid of temperatures")
    parser.add_argument("--cache-dir", default=None,
                        help="default <run-dir>/temperature_fit/logits_cache")
    parser.add_argument("--out", default=None,
                        help="default <run-dir>/temperature_fit/summary.json")
    parser.add_argument("--force", action="store_true",
                        help="recompute logits cache even if present")
    return parser


def parse_temps(spec):
    start, stop, step = (float(x) for x in spec.split(":"))
    n = int(round((stop - start) / step)) + 1
    return np.round(start + step * np.arange(n), 6)


def _load_sessions(model_dir):
    model_dir = Path(model_dir)
    providers = ["CPUExecutionProvider"]
    card = onnxruntime.InferenceSession(str(model_dir / "card_encoder.onnx"), providers=providers)
    set_enc = onnxruntime.InferenceSession(str(model_dir / "set_encoder.onnx"), providers=providers)
    scorer = onnxruntime.InferenceSession(str(model_dir / "scorer.onnx"), providers=providers)
    pool_null_input = np.load(model_dir / "constants.npz")["pool_null_input"]
    return (card, set_enc, scorer), pool_null_input


def _cross_check_meta(model_dir, run_dir):
    """Confirm the ONNX export really is this run's checkpoint (best.pt is
    missing from disk -- see module docstring)."""
    meta = json.loads((Path(model_dir) / "meta.json").read_text())
    record_path = Path(run_dir) / "record.json"
    if not record_path.exists():
        print(f"WARNING: no record.json at {record_path}; cannot cross-check "
              f"the ONNX export against the training run.")
        return
    record = json.loads(record_path.read_text())
    ok = (meta.get("checkpoint_step") == record.get("best_step")
          and meta.get("checkpoint_val_top1") == record.get("best_val_top1"))
    status = "OK" if ok else "MISMATCH"
    print(f"meta.json vs record.json cross-check: {status} "
          f"(step {meta.get('checkpoint_step')} vs {record.get('best_step')}, "
          f"val_top1 {meta.get('checkpoint_val_top1')} vs {record.get('best_val_top1')})")
    if not ok:
        raise RuntimeError(
            "ONNX export meta.json does not match record.json for this run -- "
            "refusing to treat it as a stand-in for the missing best.pt")


def compute_expert_logits(set_code, fmt, sessions, pool_null_input,
                          wr_id, games_id, batch_size):
    """One true inference pass -> per-pick raw candidate logits (pre-softmax)
    for every EXPERT-SLICE pick in (set_code, fmt), under the deployment
    condition. Returns a dict of numpy arrays, one row per expert pick."""
    d = shard_dir(set_code, fmt)
    assets = np.load(d / "features.npz")
    features = assets["features"].astype(np.float32)
    rarity_ids = assets["rarity_ids"].astype(np.int64)
    meta_json = json.loads((d / "meta.json").read_text())
    ppp = meta_json["picks_per_pack"] or 14
    vocab_size = meta_json["vocab_size"]
    set_scalars_row = np.array(
        [vocab_size / 400.0, float(ppp == 13), float(ppp == 14), float(ppp == 15)],
        dtype=np.float32)

    pool_slots = np.load(d / "pool_slots.npy", mmap_mode="r")
    pool_counts = np.load(d / "pool_counts.npy", mmap_mode="r")
    pack_slots = np.load(d / "pack_slots.npy", mmap_mode="r")
    pick_pos = np.load(d / "pick_pos.npy", mmap_mode="r")
    context = np.load(d / "context.npy", mmap_mode="r")

    meta = _pick_meta(set_code, fmt)
    if len(meta) != meta_json["rows"]:
        raise RuntimeError(
            f"{set_code}: shard/parquet row mismatch: "
            f"{meta_json['rows']} vs {len(meta)}")

    expert_mask = ((meta["user_game_win_rate_bucket"].to_numpy() >= evalproto.EXPERT_WR_BUCKET)
                   & (meta["user_n_games_bucket"].to_numpy() >= evalproto.EXPERT_GAMES_BUCKET))
    rows = np.flatnonzero(expert_mask)
    m = len(rows)
    print(f"{set_code}: {meta_json['rows']:,} total picks, {m:,} expert-slice picks")

    k = pack_slots.shape[1]  # 16
    out_logits = np.empty((m, k), dtype=np.float32)
    out_pick_pos = np.empty(m, dtype=np.int16)

    t_start = time.time()
    for start in range(0, m, batch_size):
        chunk = rows[start:start + batch_size]
        context_chunk = context[chunk].astype(np.int64)
        position = position_features(torch.from_numpy(context_chunk), ppp) \
            .numpy().astype(np.float32)
        batch = {
            "pool_slots": pool_slots[chunk].astype(np.int64),
            "pool_counts": pool_counts[chunk].astype(np.int64),
            "pack_slots": pack_slots[chunk].astype(np.int64),
            "position": position,
            "wr_id": np.full(len(chunk), wr_id, dtype=np.int64),
            "games_id": np.full(len(chunk), games_id, dtype=np.int64),
            "format_id": context_chunk[:, 4].astype(np.int64),
            "set_scalars": np.tile(set_scalars_row, (len(chunk), 1)),
        }
        logits, _pack_mask = onnx_logits(sessions, pool_null_input, features,
                                         rarity_ids, batch)
        out_logits[start:start + len(chunk)] = logits
        out_pick_pos[start:start + len(chunk)] = pick_pos[chunk].astype(np.int16)
        if (start // batch_size) % 20 == 0:
            elapsed = time.time() - t_start
            rate = (start + len(chunk)) / max(elapsed, 1e-9)
            print(f"  {set_code}: {start + len(chunk):,}/{m:,} "
                  f"({rate:,.0f} picks/s)", flush=True)
    print(f"{set_code}: inference done in {time.time() - t_start:.1f}s")

    return {
        "logits": out_logits,
        "pick_pos": out_pick_pos,
        "draft_id": meta["draft_id"].to_numpy()[rows],
        "pack_number": meta["pack_number"].to_numpy()[rows].astype(np.int32),
        "pick_number": meta["pick_number"].to_numpy()[rows].astype(np.int32),
        "wr_bucket": meta["user_game_win_rate_bucket"].to_numpy()[rows].astype(np.float64),
        "n_games_bucket": meta["user_n_games_bucket"].to_numpy()[rows].astype(np.int32),
    }


def load_or_compute(set_code, fmt, sessions, pool_null_input, wr_id, games_id,
                    batch_size, cache_dir, force):
    cache_dir = Path(cache_dir)
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache_path = cache_dir / f"{set_code}.{fmt}.npz"
    if cache_path.exists() and not force:
        print(f"{set_code}: loading cached logits from {cache_path}")
        with np.load(cache_path, allow_pickle=True) as z:
            return {k: z[k] for k in z.files}
    cache = compute_expert_logits(set_code, fmt, sessions, pool_null_input,
                                  wr_id, games_id, batch_size)
    np.savez_compressed(cache_path, **cache)
    print(f"{set_code}: wrote logits cache to {cache_path}")
    return cache


def _base_rank(logits, pick_pos):
    idx = np.arange(len(logits))
    target = logits[idx, pick_pos]
    return (logits > target[:, None]).sum(axis=1) + 1


def frame_at_temperature(cache, temperature, base_rank):
    """evalproto-contract DataFrame at a given softmax temperature, with the
    two required sanity checks run inline."""
    logits = cache["logits"]
    pick_pos = cache["pick_pos"].astype(np.int64)
    idx = np.arange(len(logits))

    scaled = logits / temperature
    # Sanity check 1: target_rank is invariant to a monotonic rescale.
    rank = _base_rank(scaled, pick_pos)
    if not np.array_equal(rank, base_rank):
        n_diff = int((rank != base_rank).sum())
        raise AssertionError(
            f"target_rank changed at T={temperature} for {n_diff} picks -- "
            f"temperature application is broken, stop and debug")

    peak = scaled.max(axis=1, keepdims=True)
    exps = np.exp(scaled - peak)
    sums = exps.sum(axis=1, keepdims=True)
    probs = exps / sums
    # Sanity check 2: rows sum to 1 (padded slots are -inf -> exp 0).
    row_sums = probs.sum(axis=1)
    if not np.allclose(row_sums, 1.0, atol=1e-5):
        bad = np.abs(row_sums - 1.0).max()
        raise AssertionError(
            f"softmax rows don't sum to 1 at T={temperature} (max |sum-1|={bad:.3e})")

    pick_prob = probs[idx, pick_pos]
    top_prob = probs.max(axis=1)
    pack_size = np.isfinite(logits).sum(axis=1)

    return pd.DataFrame({
        "draft_id": cache["draft_id"],
        "pack_number": cache["pack_number"],
        "pick_number": cache["pick_number"],
        "pack_size": pack_size,
        "wr_bucket": cache["wr_bucket"],
        "n_games_bucket": cache["n_games_bucket"],
        "target_rank": rank,
        "pick_prob": pick_prob,
        "top_prob": top_prob,
    })


def main():
    args = create_parser().parse_args()
    sets = [s.strip().upper() for s in args.sets.split(",")]
    if "MSH" in sets:
        raise SystemExit("MSH is frozen-eval only; this script is dev-trio only")
    temps = parse_temps(args.temps)

    run_dir = Path(args.run_dir)
    cache_dir = Path(args.cache_dir) if args.cache_dir else run_dir / "temperature_fit" / "logits_cache"
    out_path = Path(args.out) if args.out else run_dir / "temperature_fit" / "summary.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)

    best_pt = run_dir / "best.pt"
    if not best_pt.exists():
        print(f"NOTE: {best_pt} not found on this machine; using the "
              f"parity-validated ONNX export at {args.model_dir} instead "
              f"(see module docstring).")
    _cross_check_meta(args.model_dir, args.run_dir)
    sessions, pool_null_input = _load_sessions(args.model_dir)

    caches = {}
    for set_code in sets:
        caches[set_code] = load_or_compute(
            set_code, args.format, sessions, pool_null_input,
            args.wr_id, args.games_id, args.batch_size, cache_dir, args.force)

    base_ranks = {s: _base_rank(caches[s]["logits"], caches[s]["pick_pos"].astype(np.int64))
                 for s in sets}

    # T=1 parity gate against the already-published macros (computed from the
    # torch model's own cached predictions) -- confirms the ONNX stand-in for
    # the missing best.pt reproduces the same numbers.
    print("\n--- T=1.0 parity check vs published macros (numbers.tex) ---")
    for set_code in sets:
        frame1 = frame_at_temperature(caches[set_code], 1.0, base_ranks[set_code])
        ece1 = evalproto.ece(frame1)
        top1_1 = evalproto.top1(frame1)
        published = PUBLISHED_T1_ECE.get(set_code)
        flag = ""
        if published is not None:
            diff = abs(ece1 - published)
            flag = "OK" if diff <= PUBLISHED_ECE_TOL else "MISMATCH"
            if flag == "MISMATCH":
                raise RuntimeError(
                    f"{set_code}: ONNX-reproduced T=1 ECE {ece1:.5f} does not "
                    f"match published {published} (diff {diff:.5f} > tol "
                    f"{PUBLISHED_ECE_TOL}) -- do not trust this run")
        print(f"{set_code}: ECE(T=1)={ece1:.5f} (published {published}) [{flag}] "
              f"top1={top1_1:.5f}")

    print(f"\n--- sweeping T over {temps[0]:.3f}..{temps[-1]:.3f} "
         f"({len(temps)} points) ---")
    rows = []
    for temperature in temps:
        row = {"T": float(temperature)}
        for set_code in sets:
            frame = frame_at_temperature(caches[set_code], temperature, base_ranks[set_code])
            row[f"{set_code}_ece"] = evalproto.ece(frame)
            row[f"{set_code}_logloss"] = evalproto.log_loss(frame)
            row[f"{set_code}_top1"] = evalproto.top1(frame)
        row["mean_ece"] = float(np.mean([row[f"{s}_ece"] for s in sets]))
        row["mean_logloss"] = float(np.mean([row[f"{s}_logloss"] for s in sets]))
        row["mean_top1"] = float(np.mean([row[f"{s}_top1"] for s in sets]))
        rows.append(row)
    grid = pd.DataFrame(rows)

    # top1 must be exactly flat across T (rank invariance) -- an extra,
    # cheap, global version of the per-T assertion already run above.
    top1_spread = grid["mean_top1"].max() - grid["mean_top1"].min()
    if top1_spread > 1e-12:
        raise AssertionError(
            f"mean_top1 varies across T by {top1_spread:.3e}; should be exactly "
            f"constant since temperature cannot change argmax")

    i_ece = int(grid["mean_ece"].idxmin())
    i_nll = int(grid["mean_logloss"].idxmin())
    t_ece = float(grid.loc[i_ece, "T"])
    t_nll = float(grid.loc[i_nll, "T"])

    print(f"\nT minimizing mean dev-trio ECE:     T={t_ece:.3f}  "
         f"(mean ECE {grid.loc[i_ece, 'mean_ece']:.5f})")
    print(f"T minimizing mean dev-trio log-loss: T={t_nll:.3f}  "
         f"(mean log-loss {grid.loc[i_nll, 'mean_logloss']:.5f}, "
         f"ECE at this T = {grid.loc[i_nll, 'mean_ece']:.5f})")

    frozen_t = t_nll  # see module docstring for the NLL-vs-ECE rationale
    i_frozen = i_nll
    i_t1 = int(np.argmin(np.abs(grid["T"].to_numpy() - 1.0)))

    print(f"\n=== FROZEN CHOICE: T={frozen_t:.3f} (NLL-minimizing on dev trio) ===")
    print(f"{'set':6s} {'ECE(T=1)':>10s} {'ECE(T*)':>10s} {'logloss(T=1)':>13s} "
         f"{'logloss(T*)':>12s}")
    for set_code in sets:
        print(f"{set_code:6s} "
             f"{grid.loc[i_t1, f'{set_code}_ece']:10.5f} "
             f"{grid.loc[i_frozen, f'{set_code}_ece']:10.5f} "
             f"{grid.loc[i_t1, f'{set_code}_logloss']:13.5f} "
             f"{grid.loc[i_frozen, f'{set_code}_logloss']:12.5f}")
    print(f"{'mean':6s} "
         f"{grid.loc[i_t1, 'mean_ece']:10.5f} "
         f"{grid.loc[i_frozen, 'mean_ece']:10.5f} "
         f"{grid.loc[i_t1, 'mean_logloss']:13.5f} "
         f"{grid.loc[i_frozen, 'mean_logloss']:12.5f}")

    summary = {
        "sets": sets,
        "format": args.format,
        "wr_id": args.wr_id,
        "games_id": args.games_id,
        "model_dir": args.model_dir,
        "run_dir": str(run_dir),
        "best_pt_present": best_pt.exists(),
        "temps_grid": args.temps,
        "frozen_temperature": frozen_t,
        "frozen_criterion": "argmin mean dev-trio log-loss (NLL)",
        "alt_temperature_ece_argmin": t_ece,
        "t1_row": grid.loc[i_t1].to_dict(),
        "frozen_row": grid.loc[i_frozen].to_dict(),
        "published_t1_ece_macros": PUBLISHED_T1_ECE,
        "grid": grid.to_dict(orient="records"),
    }
    out_path.write_text(json.dumps(summary, indent=2, default=str))
    print(f"\nwrote {out_path}")


if __name__ == "__main__":
    main()

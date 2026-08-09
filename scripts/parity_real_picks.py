#!/usr/bin/env python
"""Train-vs-serve parity for DraftFM on REAL held-out picks, as a durable record.

The export's own validation (mtga.foundation.export.validate_export) compares
the torch model against the ONNX graphs on RANDOM inputs. This script runs the
same comparison on actual held-out draft picks pulled from the training shards,
which is the claim the paper makes: the serving path returns the training
path's scores on real data, not merely on synthetic tensors.

Row selection is deterministic (fixed seed, fixed shards, sorted indices), so
re-running reproduces the numbers exactly.

  parity_real_picks.py --version-dir <export dir> --run-dir <training run dir>
"""

import argparse
import hashlib
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import torch

from mtga.foundation import export
from mtga.foundation.dataset import Shard, shard_dir
from mtga.foundation.model import position_features

REPO_ROOT = Path(__file__).resolve().parents[1]

# Frozen audit selection: one in-training set, the EVAL_ONLY set, and a
# TradDraft shard, so the check spans formats and set provenance.
SHARDS = [("SOS", "PremierDraft"), ("MSH", "PremierDraft"), ("BRO", "TradDraft")]
ROWS_PER_SHARD = 512
SELECTION_SEED = 7
TOLERANCE = 1e-4


def create_parser():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version-dir", type=Path, required=True)
    parser.add_argument("--run-dir", type=Path, required=True)
    parser.add_argument("--checkpoint", default="best.pt")
    parser.add_argument(
        "--out",
        type=Path,
        default=None,
        help="default: <version-dir>/parity_real_picks.json",
    )
    return parser


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def git_revision():
    try:
        out = subprocess.run(
            ["git", "-C", str(REPO_ROOT), "rev-parse", "HEAD"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        return out.stdout.strip() or None
    except OSError:
        return None


def git_dirty():
    try:
        out = subprocess.run(
            ["git", "-C", str(REPO_ROOT), "status", "--porcelain"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        return [line for line in out.stdout.splitlines() if line.strip()]
    except OSError:
        return None


def shard_batch(set_code, limited_type):
    """Deterministic 512-row sample of one shard's held-out validation picks."""
    directory = shard_dir(set_code, limited_type)
    assets = np.load(directory / "features.npz")
    features = assets["features"].astype(np.float32)
    rarity_ids = assets["rarity_ids"].astype(np.int64)
    shard = Shard(set_code, limited_type, torch.from_numpy(features))

    rng = np.random.default_rng(SELECTION_SEED)
    rows = np.sort(rng.choice(shard.val_idx, size=ROWS_PER_SHARD, replace=False))
    raw = shard.gather(rows)
    context = raw["context"].astype(np.int64)
    ppp = shard.meta.get("picks_per_pack") or 14
    batch = {
        "pool_slots": raw["pool_slots"].astype(np.int64),
        "pool_counts": raw["pool_counts"].astype(np.int64),
        "pack_slots": raw["pack_slots"].astype(np.int64),
        "position": position_features(torch.from_numpy(context), ppp).numpy(),
        "wr_id": context[:, 2],
        "games_id": context[:, 3],
        "format_id": context[:, 4],
        "set_scalars": np.tile(
            np.array(
                [
                    shard.meta["vocab_size"] / 400.0,
                    float(ppp == 13),
                    float(ppp == 14),
                    float(ppp == 15),
                ],
                dtype=np.float32,
            ),
            (len(rows), 1),
        ),
    }
    truth = raw["pick_pos"].astype(np.int64)
    return features, rarity_ids, batch, truth


def main(argv=None):
    args = create_parser().parse_args(argv)
    import onnxruntime

    version_dir = args.version_dir
    checkpoint = args.run_dir / args.checkpoint
    out_path = args.out or (version_dir / "parity_real_picks.json")

    model, _ = export.load_checkpoint(checkpoint)
    model.eval()
    providers = ["CPUExecutionProvider"]
    sessions = (
        onnxruntime.InferenceSession(
            str(version_dir / "card_encoder.onnx"), providers=providers
        ),
        None,
        onnxruntime.InferenceSession(
            str(version_dir / "scorer.onnx"), providers=providers
        ),
    )
    pool_null = np.load(version_dir / "constants.npz")["pool_null_input"]

    per_shard = []
    worst = 0.0
    rows_total = agree_total = 0
    for set_code, limited_type in SHARDS:
        features, rarity_ids, batch, truth = shard_batch(set_code, limited_type)
        want = export._torch_logits(model, features, rarity_ids, batch)
        got, pack_mask = export.onnx_logits(
            sessions, pool_null, features, rarity_ids, batch
        )
        valid = ~pack_mask
        diff = float(np.abs(want[valid] - got[valid]).max())
        agree = int((want.argmax(1) == got.argmax(1)).sum())
        per_shard.append(
            {
                "shard": f"{set_code}.{limited_type}",
                "rows": int(len(truth)),
                "max_abs_diff": diff,
                "argmax_agreement": agree,
                "argmax_agreement_fraction": agree / len(truth),
                "torch_top1_accuracy": float((want.argmax(1) == truth).mean()),
                "onnx_top1_accuracy": float((got.argmax(1) == truth).mean()),
            }
        )
        worst = max(worst, diff)
        rows_total += len(truth)
        agree_total += agree

    now_utc = datetime.now(timezone.utc)
    onnx_hashes = {
        p.name: sha256_file(p)
        for p in sorted(version_dir.iterdir())
        if p.suffix in {".onnx", ".data", ".npz"} or p.name.endswith(".onnx.data")
    }
    record = {
        "check": "draftfm-train-vs-serve-parity-real-picks",
        "what": (
            "Torch training-path logits vs ONNX serving-path logits on real "
            "held-out draft picks. Complements the export's synthetic-input "
            "validation."
        ),
        "generated_at_utc": now_utc.isoformat(timespec="seconds"),
        "generated_at_local": now_utc.astimezone().isoformat(timespec="seconds"),
        "row_selection_rule": (
            f"For each shard: numpy default_rng(seed={SELECTION_SEED}).choice("
            f"shard.val_idx, size={ROWS_PER_SHARD}, replace=False), then "
            "np.sort. val_idx is the deterministic draft-level holdout "
            "(crc32(draft_id) % 1000 < 50). Fixed seed and fixed shard list "
            "make the selection reproduce exactly."
        ),
        "shards": [f"{s}.{f}" for s, f in SHARDS],
        "rows_per_shard": ROWS_PER_SHARD,
        "tolerance": TOLERANCE,
        "device": "cpu (CPUExecutionProvider)",
        "per_shard": per_shard,
        "overall": {
            "max_abs_diff": worst,
            "rows": rows_total,
            "argmax_agreement": agree_total,
            "argmax_agreement_fraction": agree_total / rows_total,
            "passed": bool(worst < TOLERANCE and agree_total == rows_total),
        },
        "checkpoint": {
            "name": checkpoint.name,
            "sha256": sha256_file(checkpoint),
        },
        "onnx_artifacts_sha256": onnx_hashes,
        "code_git_revision": git_revision(),
        "code_uncommitted_files": git_dirty(),
        "torch_version": torch.__version__,
        "onnxruntime_version": onnxruntime.__version__,
        "reproduce": (
            "MTGA_DATA_ROOT=<data root> python scripts/parity_real_picks.py "
            "--version-dir <data root>/models/_foundation/"
            f"{version_dir.name} --run-dir <data root>/foundation/runs/"
            f"{args.run_dir.name}"
        ),
    }
    out_path.write_text(json.dumps(record, indent=2, sort_keys=True) + "\n")
    for entry in per_shard:
        print(
            f"{entry['shard']:20s} rows={entry['rows']} "
            f"max|torch-ort|={entry['max_abs_diff']:.3e} "
            f"argmax={entry['argmax_agreement']}/{entry['rows']}"
        )
    print(
        f"OVERALL max|torch-ort| = {worst:.3e} (tol {TOLERANCE:.0e}), "
        f"argmax {agree_total}/{rows_total}, "
        f"passed={record['overall']['passed']}"
    )
    print(f"wrote {out_path}")
    return 0 if record["overall"]["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())

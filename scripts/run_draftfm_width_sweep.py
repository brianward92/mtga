#!/usr/bin/env python
"""Run a from-scratch DraftFM width sweep sequentially on one machine.

The sweep keeps the data, architecture, optimizer, seed, and training budget
fixed. Only ``d_model`` changes. Each child process writes its ordinary run
record/checkpoints below ``$MTGA_DATA_ROOT/foundation/runs``; this launcher
also writes a compact plan and one log per width below
``$MTGA_DATA_ROOT/foundation/width_sweeps/<name>``.
"""

import argparse
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
TRAIN_SCRIPT = REPO_ROOT / "scripts" / "train_draftfm.py"
DEFAULT_HOLDOUT = ("BRO", "FDN", "MSH")


def create_parser():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-root", type=Path, required=True)
    parser.add_argument("--name", default="hob_rebuild_widths")
    parser.add_argument("--widths", default="128,256,512")
    parser.add_argument("--holdout", default=",".join(DEFAULT_HOLDOUT))
    parser.add_argument("--seed", type=int, default=17)
    parser.add_argument("--batch-size", type=int, default=8192)
    parser.add_argument("--epochs", type=float, default=4.0)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--dry-run", action="store_true")
    return parser


def parse_ints(value):
    widths = [int(part.strip()) for part in value.split(",") if part.strip()]
    if not widths or any(width <= 0 or width % 4 for width in widths):
        raise SystemExit("--widths must be positive multiples of four")
    return widths


def validate_assets(data_root, expected_holdout):
    manifest_path = data_root / "17lands" / "features" / "featurizer_manifest.json"
    if not manifest_path.exists():
        raise SystemExit(f"missing feature manifest: {manifest_path}")
    manifest = json.loads(manifest_path.read_text())
    trained = set(manifest.get("training_sets", []))
    leaked = trained & set(expected_holdout)
    if leaked:
        raise SystemExit(
            f"held-out sets leaked into feature manifest: {sorted(leaked)}"
        )

    shard_root = data_root / "foundation" / "shards"
    missing_features = []
    stale_features = []
    for shard in sorted(path for path in shard_root.iterdir() if path.is_dir()):
        feature_path = shard / "features.npz"
        if not feature_path.exists():
            missing_features.append(shard.name)
            continue
        import numpy as np

        with np.load(feature_path, allow_pickle=True) as assets:
            asset_hash = str(assets.get("manifest_hash", ""))
        if asset_hash != manifest["content_hash"]:
            stale_features.append(shard.name)
    if missing_features or stale_features:
        raise SystemExit(
            f"shard feature preflight failed; missing={missing_features[:5]}, "
            f"stale={stale_features[:5]}"
        )
    return manifest


def parameter_count(width):
    from mtga.foundation.model import DraftFM

    model = DraftFM(775, d=width, set_ctx=False)
    return sum(parameter.numel() for parameter in model.parameters())


def stream_command(command, env, log_path):
    with log_path.open("w") as log:
        process = subprocess.Popen(
            command,
            cwd=REPO_ROOT,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
        assert process.stdout is not None
        for line in process.stdout:
            print(line, end="", flush=True)
            log.write(line)
            log.flush()
        return process.wait()


def main(argv=None):
    args = create_parser().parse_args(argv)
    data_root = args.data_root.expanduser().resolve()
    widths = parse_ints(args.widths)
    holdout = tuple(
        code.strip().upper() for code in args.holdout.split(",") if code.strip()
    )

    # mtga.lands.paths reads this environment variable at import time. Set it
    # before importing any project module in this process or its children.
    os.environ["MTGA_DATA_ROOT"] = str(data_root)
    manifest = validate_assets(data_root, holdout)

    sweep_dir = data_root / "foundation" / "width_sweeps" / args.name
    sweep_dir.mkdir(parents=True, exist_ok=True)
    plan = {
        "name": args.name,
        "created_utc": datetime.now(timezone.utc).isoformat(),
        "data_root": str(data_root),
        "holdout_sets": list(holdout),
        "training_manifest_hash": manifest["content_hash"],
        "training_manifest_sets": manifest["training_sets"],
        "seed": args.seed,
        "batch_size": args.batch_size,
        "epochs": args.epochs,
        "learning_rate": args.lr,
        "set_context_tower": False,
        "runs": [
            {"d_model": width, "n_params": parameter_count(width)} for width in widths
        ],
    }
    (sweep_dir / "plan.json").write_text(json.dumps(plan, indent=2) + "\n")
    print(json.dumps(plan, indent=2), flush=True)
    if args.dry_run:
        return 0

    env = os.environ.copy()
    # MSH is registry-gated and therefore absent from the ordinary corpus
    # expansion already. Passing all three names remains explicit in records.
    holdout_arg = ",".join(holdout)
    for width in widths:
        run_name = f"{args.name}_d{width}"
        command = [
            sys.executable,
            str(TRAIN_SCRIPT),
            "--name",
            run_name,
            "--holdout",
            holdout_arg,
            "--seed",
            str(args.seed),
            "--batch-size",
            str(args.batch_size),
            "--epochs",
            str(args.epochs),
            "--lr",
            str(args.lr),
            "--d-model",
            str(width),
            "--no-set-ctx",
        ]
        print(f"\n=== starting d={width}: {' '.join(command)} ===", flush=True)
        status = stream_command(command, env, sweep_dir / f"d{width}.log")
        if status:
            raise SystemExit(f"d={width} failed with exit status {status}")
    print("\nwidth sweep complete", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

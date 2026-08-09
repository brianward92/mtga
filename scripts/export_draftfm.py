#!/usr/bin/env python
"""Export a trained DraftFM checkpoint to a servable ONNX version dir.

  export_draftfm.py --run <run_dir> --tag v20260706 [--wr-id 33] [--games-id 6]
                    [--out-root .../models/_foundation] [--promote]

Writes card_encoder.onnx + scorer.onnx (+ set_encoder.onnx if the checkpoint
has set_ctx=True) + constants.npz + meta.json under <out-root>/<tag>/ and
validates the graphs against the torch model (max |diff| < 1e-4 — hard fail,
no meta.json on failure). --promote repoints <out-root>/latest at the new
version (the registry's DraftFM tier).

Run on n42 (torch 2.12, dynamo export); never on the torch-2.2 serving box.
"""

import argparse
import json
import sys
from pathlib import Path

from mtga.foundation import export
from mtga.lands import paths


def create_parser():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--run", required=True, help="training run dir containing best.pt"
    )
    parser.add_argument("--checkpoint", default="best.pt")
    parser.add_argument("--tag", required=True, help="version dir name")
    parser.add_argument(
        "--out-root", default=None, help=f"default: {paths.MODELS_DIR / '_foundation'}"
    )
    parser.add_argument(
        "--wr-id", type=int, default=33, help="serving skill bucket id (33 ~ 0.66 wr)"
    )
    parser.add_argument(
        "--games-id",
        type=int,
        default=6,
        help="serving games bucket id (6 = 1000 games)",
    )
    parser.add_argument(
        "--manifest-hash",
        default=None,
        help="featurizer manifest content hash "
        "(default: read from the data root's manifest)",
    )
    parser.add_argument(
        "--promote",
        action="store_true",
        help="repoint <out-root>/latest at this version",
    )
    return parser


def resolve_manifest_hash(explicit):
    if explicit:
        return explicit
    if paths.FEATURIZER_MANIFEST.exists():
        return json.loads(paths.FEATURIZER_MANIFEST.read_text())["content_hash"]
    sys.exit(f"no {paths.FEATURIZER_MANIFEST} on this host; pass --manifest-hash")


def promote(out_dir):
    latest = out_dir.parent / "latest"
    tmp = latest.parent / ".latest.tmp"
    if tmp.is_symlink() or tmp.exists():
        tmp.unlink()
    tmp.symlink_to(out_dir.name)
    tmp.replace(latest)
    return latest


def main():
    args = create_parser().parse_args()
    checkpoint = Path(args.run) / args.checkpoint
    if not checkpoint.exists():
        sys.exit(f"no checkpoint at {checkpoint}")
    out_root = (
        Path(args.out_root) if args.out_root else (paths.MODELS_DIR / "_foundation")
    )
    out_dir = out_root / args.tag
    manifest_hash = resolve_manifest_hash(args.manifest_hash)

    meta = export.export_version(
        checkpoint, out_dir, args.wr_id, args.games_id, manifest_hash
    )
    report = meta["validation"]
    print(f"exported {meta['model_id']} -> {out_dir}")
    print(
        f"  checkpoint {meta['checkpoint_sha256'][:12]} "
        f"(step {meta['checkpoint_step']}, "
        f"val_top1 {meta['checkpoint_val_top1']})"
    )
    print(f"  serving condition: wr_id {args.wr_id}, games_id {args.games_id}")
    print(
        f"  validation max |torch - ort| = {report['max_abs_diff']:.3e} "
        f"< {report['tolerance']:.0e}  {report['cases']}"
    )
    if args.promote:
        latest = promote(out_dir)
        print(f"  promoted: {latest} -> {out_dir.name}")


if __name__ == "__main__":
    main()

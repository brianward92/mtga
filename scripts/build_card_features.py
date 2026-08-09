"""Build the frozen DraftFM card-feature table: manifest + cardfeats parquet.

Joins the union of the given sets' curated vocab names to Scryfall
(names.norm_17lands; in-expansion printing preferred, else newest paper,
else newest digital), freezes the featurizer manifest from those TRAINING
sets only, and writes a name-keyed parquet of 391 float32 feature columns
plus join provenance. Any unmatched name is a hard failure (exit 2) — fix
names.ALIASES_17L or the parquet, never exclude.

Usage:
    .venv-ml/bin/python scripts/build_card_features.py --sets SOS
    .venv-ml/bin/python scripts/build_card_features.py            # all curated vocabs
    .venv-ml/bin/python scripts/build_card_features.py --sets SOS --embed
"""

import argparse
import hashlib
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from mtga.foundation import featurize, textemb
from mtga.lands import corpus, names, paths

REPO_ROOT = Path(__file__).resolve().parents[1]


def create_parser():
    parser = argparse.ArgumentParser(
        description="Build the frozen DraftFM card feature table."
    )
    parser.add_argument(
        "--sets",
        nargs="+",
        metavar="SET",
        help="Set codes to build from (default: every curated vocab on disk).",
    )
    parser.add_argument(
        "--holdout",
        nargs="*",
        default=[],
        metavar="SET",
        help="Encode these sets into the output table but exclude them from "
        "manifest vocabulary fitting (for whole-set evaluation).",
    )
    parser.add_argument(
        "--manifest-out",
        type=Path,
        default=None,
        help=f"Manifest path (default: {paths.FEATURIZER_MANIFEST}).",
    )
    parser.add_argument(
        "--features-out",
        type=Path,
        default=None,
        help=f"Features parquet path (default: {paths.CARDFEATS_PARQUET}).",
    )
    parser.add_argument(
        "--embed",
        action="store_true",
        help="Also extend the text-embedding cache (needs .venv-embed).",
    )
    return parser


def discover_sets():
    """Set codes with at least one curated vocab sidecar on disk."""
    vocab_dir = paths.CURATED_DIR / "draft"
    return sorted({p.name.split(".")[0] for p in vocab_dir.glob("*.vocab.json")})


def vocab_names(set_code):
    """Union of names across every format's vocab sidecar for one set."""
    found = sorted((paths.CURATED_DIR / "draft").glob(f"{set_code}.*.vocab.json"))
    if not found:
        raise FileNotFoundError(
            f"no curated vocab for {set_code} under {paths.CURATED_DIR / 'draft'}"
        )
    union = set()
    for path in found:
        with open(path) as fh:
            union.update(json.load(fh)["names"])
    return sorted(union)


def _sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _git_describe():
    try:
        out = subprocess.run(
            ["git", "-C", str(REPO_ROOT), "describe", "--always", "--dirty"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        return out.stdout.strip() or "unknown"
    except OSError:
        return "unknown"


def main(argv=None):
    args = create_parser().parse_args(argv)
    manifest_out = args.manifest_out or paths.FEATURIZER_MANIFEST
    features_out = args.features_out or paths.CARDFEATS_PARQUET

    set_codes = args.sets or discover_sets()
    # Normalize case BEFORE the EVAL_ONLY ban: corpus.EVAL_ONLY is upper-case
    # ({"MSH"}), so a lower-case `--sets msh` would otherwise slip past the ban
    # and, on a case-insensitive filesystem, still glob MSH's vocab sidecar and
    # build features from held-out data (T3.6 — the ban must not depend on glob
    # case-sensitivity). Mirrors corpus.corpus_jobs, which upper-cases too.
    set_codes = [c.strip().upper() for c in set_codes]
    if not set_codes:
        print(f"no curated vocabs under {paths.CURATED_DIR / 'draft'}", file=sys.stderr)
        sys.exit(2)
    holdout = {c.strip().upper() for c in args.holdout}
    unknown_holdout = holdout - set(set_codes)
    if unknown_holdout:
        print(
            f"holdout sets are not in --sets/on disk: " f"{sorted(unknown_holdout)}",
            file=sys.stderr,
        )
        sys.exit(2)
    training_codes = [c for c in set_codes if c not in holdout]
    if not training_codes:
        print(
            "at least one non-holdout set is required to fit the manifest",
            file=sys.stderr,
        )
        sys.exit(2)
    banned = set(training_codes) & corpus.EVAL_ONLY
    if banned:
        print(
            f"{sorted(banned)} are EVAL_ONLY: the featurizer manifest is "
            f"built from training sets only; pass them via --holdout to "
            f"encode without fitting",
            file=sys.stderr,
        )
        sys.exit(2)

    output_names_by_set = {code: vocab_names(code) for code in set_codes}
    names_by_set = {code: output_names_by_set[code] for code in training_codes}
    prefer = {}
    for code, set_names in output_names_by_set.items():
        for name in set_names:
            prefer.setdefault(name, []).append(code)
    all_names = sorted(prefer, key=names.norm_17lands)
    print(f"sets: {', '.join(set_codes)} -> {len(all_names)} unique names")

    cards, faces = featurize.load_scryfall()
    try:
        manifest = featurize.build_manifest(names_by_set, cards, faces)
        matrix, provenance = featurize.featurize(
            all_names, manifest, cards, faces, prefer_sets_by_name=prefer
        )
    except featurize.UnmatchedNamesError as err:
        print(f"UNMATCHED NAMES — hard fail:\n{err}", file=sys.stderr)
        sys.exit(2)

    featurize.save_manifest(manifest, manifest_out)
    print(
        f"manifest: {manifest_out} (hash {manifest['content_hash'][:12]}, "
        f"{len(manifest['subtype_vocab'])} subtypes, "
        f"{len(manifest['keyword_vocab'])} keywords)"
    )

    columns = featurize.manifest_columns(manifest)
    frame = pd.DataFrame(matrix, columns=columns)
    prov = pd.DataFrame(provenance).rename(columns={"name": "name_display"})
    prov.insert(2, "gid", range(len(prov)))
    frame = pd.concat([prov, frame], axis=1)
    features_out.parent.mkdir(parents=True, exist_ok=True)
    frame.to_parquet(features_out, index=False)
    print(f"features: {features_out} [{frame.shape[0]} x {len(columns)}]")

    meta = {
        "version": manifest["version"],
        "created": datetime.now(timezone.utc).isoformat(),
        "sets": set_codes,
        "manifest_sets": training_codes,
        "holdout_sets": sorted(holdout),
        "n_names": len(all_names),
        "n_features": manifest["n_features"],
        "manifest_path": str(manifest_out),
        "manifest_hash": manifest["content_hash"],
        "scryfall_cards_sha256": _sha256(paths.SCRYFALL_CARDS_PARQUET),
        "git_describe": _git_describe(),
        "unmatched": 0,
    }
    with open(paths.meta_path(features_out), "w") as fh:
        json.dump(meta, fh, indent=2)
    print(f"meta: {paths.meta_path(features_out)}")

    if args.embed:
        try:
            vectors = textemb.embed_names(all_names, paths.TEXT_EMB_CACHE)
            print(
                f"embeddings: {paths.TEXT_EMB_CACHE} "
                f"[{vectors.shape[0]} x {vectors.shape[1]}]"
            )
        except RuntimeError as err:
            print(f"WARNING: embeddings not built — {err}", file=sys.stderr)


if __name__ == "__main__":
    main()

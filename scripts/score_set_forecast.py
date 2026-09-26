#!/usr/bin/env python
"""Prepare and score a new set with the frozen HOB model, without refitting.

Run ``prepare`` in .venv-embed, then ``score`` in the ONNX environment.
Inputs are an explicit Scryfall JSON array (including selected bonus cards),
the frozen feature manifest, and the sealed model export. No ratings are read.
The original score_hob_forecast.py and its published outputs are untouched.
"""

import argparse
from collections import Counter
from datetime import datetime, timezone
import json
from pathlib import Path

import numpy as np
import pandas as pd

from mtga.foundation import featurize, textemb
from mtga.lands.names import norm_17lands
from run_scryfall_processor import process_cards
from score_hob_forecast import LADDER, band_counts, score, sha256_file


def canonical_records(records, set_code):
    """Prefer main-set base printings to promotional rarity upgrades."""

    def key(r):
        number = r["collector_number"]
        return (
            r["set"].upper() != set_code,
            not number.isdigit(),
            int(number) if number.isdigit() else 999999,
            number,
            r["id"],
        )

    chosen = {}
    for row in sorted(records, key=key):
        if row.get("lang") != "en":
            raise ValueError("input must contain English card records only")
        chosen.setdefault(norm_17lands(row["name"]), row)
    return [chosen[n] for n in sorted(chosen)]


def verify_model(args):
    manifest = json.loads(args.manifest.read_text())
    meta = json.loads((args.version_dir / "meta.json").read_text())
    seal = json.loads(args.reference_seal.read_text())
    expected = seal["provenance"]
    if featurize.content_hash(manifest) != expected["feature_manifest_content_hash"]:
        raise ValueError("feature manifest differs from the HOB seal")
    if meta["manifest_hash"] != manifest["content_hash"]:
        raise ValueError("export and feature manifest do not match")
    if meta["checkpoint_sha256"] != expected["model_checkpoint_sha256"]:
        raise ValueError("export is not the sealed HOB checkpoint")
    if sha256_file(args.checkpoint) != expected["model_checkpoint_sha256"]:
        raise ValueError("checkpoint bytes differ from the HOB seal")
    if args.set_code in {s for s, _ in meta["config"]["sets"]}:
        raise ValueError("target set is in the training corpus")
    return manifest, meta


def prepare(args):
    manifest, meta = verify_model(args)
    raw = json.loads(args.cards.read_text())
    canonical = canonical_records(raw, args.set_code)
    if len(canonical) < 2:
        raise ValueError("need at least two unique cards")
    tables = process_cards(canonical)
    cards = tables["cards"]
    cards["released_at"] = [r["released_at"] for r in canonical]
    names = [r["name"] for r in canonical]
    struct, provenance = featurize.featurize(
        names, manifest, cards, tables["card_faces"]
    )
    inputs = featurize.embed_inputs(names, cards, tables["card_faces"])
    texts = {n: textemb.normalize_oracle(**spec) for n, spec in inputs.items()}
    # Fresh per-snapshot cache: an old name-only cache can hide oracle changes.
    cache = args.out_dir / f"text_{sha256_file(args.cards)[:16]}.npz"
    vectors = textemb.embed_names(names, cache, texts_by_name=texts)
    table = np.concatenate([struct, vectors], axis=1).astype(np.float16)
    if table.shape != (len(names), 775) or not np.isfinite(table).all():
        raise ValueError("invalid feature matrix")
    np.savez(args.out_dir / "features.npz", names=names, features=table)
    counts = Counter(norm_17lands(r["name"]) for r in raw)
    rows = []
    for r in canonical:
        rows.append(
            {
                "name": r["name"],
                "set": r["set"].upper(),
                "collector_number": r["collector_number"],
                "rarity": r["rarity"],
                "colors": "".join(r.get("colors", [])),
                "mana_cost": r.get("mana_cost", ""),
                "type_line": r["type_line"],
                "display_only_basic": "Basic Land" in r["type_line"],
                "n_printings": counts[norm_17lands(r["name"])],
            }
        )
    pd.DataFrame(rows).to_csv(args.out_dir / "cards.csv", index=False)
    known = {k.casefold() for k in manifest["keyword_vocab"]}
    unknown = sorted(
        {
            k
            for r in canonical
            for k in r.get("keywords", [])
            if k.casefold() not in known
        }
    )
    info = {
        "set": args.set_code,
        "cards_sha256": sha256_file(args.cards),
        "feature_manifest_content_hash": manifest["content_hash"],
        "checkpoint_sha256": meta["checkpoint_sha256"],
        "features_sha256": sha256_file(args.out_dir / "features.npz"),
        "card_table_sha256": sha256_file(args.out_dir / "cards.csv"),
        "n_records": len(raw),
        "n_unique": len(names),
        "n_by_set": dict(Counter(r["set"] for r in canonical)),
        "unmatched_keywords": unknown,
        "canonical_printing_rule": "main set first, then lowest numeric collector number, then id",
        "provenance": provenance,
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
    }
    (args.out_dir / "features_manifest.json").write_text(
        json.dumps(info, indent=2) + "\n"
    )
    print(json.dumps({k: v for k, v in info.items() if k != "provenance"}, indent=2))


def run_score(args):
    manifest, meta = verify_model(args)
    info = json.loads((args.out_dir / "features_manifest.json").read_text())
    for key, path in [
        ("cards_sha256", args.cards),
        ("features_sha256", args.out_dir / "features.npz"),
        ("card_table_sha256", args.out_dir / "cards.csv"),
    ]:
        if sha256_file(path) != info[key]:
            raise ValueError(f"prepared input changed: {path}")
    if info["feature_manifest_content_hash"] != manifest["content_hash"]:
        raise ValueError("prepared features use a different manifest")
    frame = pd.read_csv(args.out_dir / "cards.csv", keep_default_na=False)
    with np.load(args.out_dir / "features.npz", allow_pickle=False) as z:
        if list(z["names"]) != frame["name"].tolist():
            raise ValueError("feature names are misaligned")
        table = z["features"].astype(np.float32)
    logits = score(args.version_dir, table, None)
    if not np.isfinite(logits).all():
        raise ValueError("non-finite scores")
    order = np.argsort(-logits, kind="stable")
    frame["score"] = logits
    frame = frame.iloc[order].reset_index(drop=True)
    n = len(frame)
    frame.insert(0, "rank", np.arange(1, n + 1))
    frame["percentile"] = (100 * (n - frame["rank"]) / (n - 1)).round(4)
    frame["letter"] = [
        g for (g, _), count in zip(LADDER, band_counts(n)) for _ in range(count)
    ]
    frame["score"] = frame["score"].round(6)
    csv = args.out_dir / f"{args.set_code.lower()}_p1p1_forecast.csv"
    frame.to_csv(csv, index=False, lineterminator="\n")
    parquet = csv.with_suffix(".parquet")
    frame.to_parquet(parquet, index=False)
    graph_hashes = {
        p.name: sha256_file(p)
        for p in sorted(args.version_dir.iterdir())
        if p.name.endswith((".onnx", ".onnx.data", ".npz"))
    }
    result = {
        **{k: v for k, v in info.items() if k != "provenance"},
        "status": "local candidate; not publicly sealed",
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "conditioning": {
            "wr_id": 28,
            "games_id": 4,
            "format_id": 0,
            "pack_number": 0,
            "pick_number": 0,
            "pool": "empty",
            "picks_per_pack": 14,
            "set_scalars": [n / 400, 0, 1, 0],
        },
        "ladder_percent": dict(LADDER),
        "band_counts": dict(zip(dict(LADDER), band_counts(n))),
        "letter_scope": "all unique names including display-only basics; presentation only",
        "export_sha256": graph_hashes,
        "scorer_sha256": sha256_file(Path(__file__)),
        "reference_scorer_sha256": sha256_file(
            Path(__file__).with_name("score_hob_forecast.py")
        ),
        "outputs": {p.name: sha256_file(p) for p in (csv, parquet)},
    }
    (args.out_dir / "forecast_manifest.json").write_text(
        json.dumps(result, indent=2) + "\n"
    )
    print(frame.head(10)[["rank", "name", "letter", "score"]].to_string(index=False))


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("stage", choices=["prepare", "score"])
    p.add_argument("--set", dest="set_code", required=True, type=str.upper)
    for arg in [
        "cards",
        "manifest",
        "version-dir",
        "checkpoint",
        "reference-seal",
        "out-dir",
    ]:
        p.add_argument("--" + arg, required=True, type=Path)
    args = p.parse_args()
    args.out_dir.mkdir(parents=True, exist_ok=True)
    (prepare if args.stage == "prepare" else run_score)(args)


if __name__ == "__main__":
    main()

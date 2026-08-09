#!/usr/bin/env python
"""Score every HOB card at pack 1 pick 1 through the frozen DraftFM export.

Deterministic, CPU-only, no-network. Reproduces the serving composition in
mtga.models.draftfm.OnnxDraftFMModel.score_pack exactly (empty pool -> the
learned null token; the whole set list as one P1P1 "pack"), so the published
forecast is the score the deployed model would give.

Run it twice and diff the outputs: nothing here reads a clock, a hostname,
or an RNG, so the CSV/Parquet must be byte-identical across runs.

  score_hob_forecast.py --version-dir <export> --out-dir <staging>
"""

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import pandas as pd

from mtga.foundation import featurize
from mtga.lands import names as names_mod
from mtga.lands import paths

SET_CODE = "HOB"
PICKS_PER_PACK = 14
PACK_NUMBER = 0  # pack 1, zero-indexed
PICK_NUMBER = 0  # pick 1, zero-indexed
FORMAT_ID = 0  # PremierDraft (dataset.FORMAT_IDS)
WR_ID = 28  # expert slice: round(0.55 * 50), the >= 0.55 win-rate bucket
GAMES_ID = 4  # expert slice: index of 1000-game bucket list at 100 games

# 13-level ladder, top-down, with its frozen percentile widths.
LADDER = [
    ("A+", 2.0),
    ("A", 3.0),
    ("A-", 5.0),
    ("B+", 8.0),
    ("B", 12.0),
    ("B-", 12.0),
    ("C+", 13.0),
    ("C", 15.0),
    ("C-", 12.0),
    ("D+", 8.0),
    ("D", 5.0),
    ("D-", 3.0),
    ("F", 2.0),
]


def create_parser():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version-dir", type=Path, required=True)
    parser.add_argument("--out-dir", type=Path, required=True)
    return parser


def sha256_bytes(blob):
    return hashlib.sha256(blob).hexdigest()


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def band_counts(n):
    """Largest-remainder (Hamilton) apportionment of n cards over the ladder.

    Floor every ideal share, then hand the leftover seats to the largest
    fractional remainders, ties broken by ladder order (better grade first).
    Guarantees the counts sum to n exactly for any n.
    """
    ideals = [(pct / 100.0) * n for _, pct in LADDER]
    counts = [int(np.floor(x)) for x in ideals]
    leftover = n - sum(counts)
    order = sorted(range(len(LADDER)), key=lambda i: (-(ideals[i] - counts[i]), i))
    for i in order[:leftover]:
        counts[i] += 1
    return counts


def hob_records(cards):
    """Every Scryfall printing in the HOB expansion, deterministically ordered."""
    rows = cards[cards["set"].str.lower() == SET_CODE.lower()].copy()
    rows["name_norm"] = [names_mod.norm_17lands(n) for n in rows["name"]]
    return rows.sort_values(["name_norm", "id"], kind="mergesort").reset_index(
        drop=True
    )


def feature_table(unique_norms, manifest):
    """fp16-rounded [N, 775] features + rarity ids, as the serving assets store them."""
    columns = featurize.manifest_columns(manifest)
    feats = pd.read_parquet(paths.CARDFEATS_PARQUET).set_index("name_norm")
    struct = feats.loc[unique_norms, columns].to_numpy(np.float32)

    with np.load(paths.TEXT_EMB_CACHE, allow_pickle=False) as cache:
        emb_of = {str(n): i for i, n in enumerate(cache["names"])}
        vectors = cache["vectors"].astype(np.float32)
    text = np.stack([vectors[emb_of[n]] for n in unique_norms])

    rarity_block = next(b for b in manifest["blocks"] if b["name"] == "rarity")
    start = rarity_block["start"]
    rarity_ids = struct[:, start : start + len(rarity_block["columns"])].argmax(axis=1)
    # Serving assets are stored fp16 and widened at load; match that exactly.
    table = np.concatenate([struct, text], axis=1).astype(np.float16).astype(np.float32)
    return table, rarity_ids.astype(np.int64)


def position_features(pack_number, pick_number, picks_per_pack):
    """Numpy twin of foundation.model.position_features for a single pick."""
    ppp = float(picks_per_pack)
    pool_size = pack_number * ppp + pick_number
    return np.array(
        [
            [
                float(pack_number == 0),
                float(pack_number == 1),
                float(pack_number == 2),
                pick_number / ppp,
                max(ppp - 1 - pick_number, 0.0) / ppp,
                pool_size / 45.0,
                min(pool_size / (3 * ppp), 1.0),
            ]
        ],
        dtype=np.float32,
    )


def score(version_dir, table, rarity_ids):
    """One P1P1 logit per card: the whole set list as a single pack, empty pool."""
    import onnxruntime

    providers = ["CPUExecutionProvider"]
    card = onnxruntime.InferenceSession(
        str(version_dir / "card_encoder.onnx"), providers=providers
    )
    scorer = onnxruntime.InferenceSession(
        str(version_dir / "scorer.onnx"), providers=providers
    )
    if (version_dir / "set_encoder.onnx").exists():
        raise SystemExit("set_ctx=True exports are not part of this forecast")

    embeddings = card.run(["card_emb"], {"features": table})[0]
    pool_null = np.load(version_dir / "constants.npz")["pool_null_input"]
    n = len(table)
    feed = {
        "pool_emb": pool_null[None, None].astype(np.float32),
        "pool_counts": np.zeros((1, 1), dtype=np.int64),
        "pool_mask": np.zeros((1, 1), dtype=bool),
        "pack_emb": embeddings[None],
        "pack_mask": np.zeros((1, n), dtype=bool),
        "wr_id": np.array([WR_ID], dtype=np.int64),
        "games_id": np.array([GAMES_ID], dtype=np.int64),
        "format_id": np.array([FORMAT_ID], dtype=np.int64),
        "position": position_features(PACK_NUMBER, PICK_NUMBER, PICKS_PER_PACK),
        "set_scalars": np.array(
            [[n / 400.0, 0.0, float(PICKS_PER_PACK == 14), 0.0]], dtype=np.float32
        ),
    }
    return scorer.run(["logits"], feed)[0][0].astype(np.float64)


def main(argv=None):
    args = create_parser().parse_args(argv)
    out_dir = args.out_dir
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest = featurize.load_manifest()

    cards, _ = featurize.load_scryfall()
    records = hob_records(cards)
    unique_norms = sorted(set(records["name_norm"]))
    table, rarity_ids = feature_table(unique_norms, manifest)
    logits = score(args.version_dir, table, rarity_ids)

    order = np.argsort(-logits, kind="stable")
    n = len(unique_norms)
    counts = band_counts(n)
    letters = [letter for (letter, _), c in zip(LADDER, counts) for _ in range(c)]

    display = {}
    is_basic = {}
    for row in records.itertuples():
        display.setdefault(row.name_norm, row.name)
        is_basic[row.name_norm] = "basic land" in str(row.type_line).lower()

    rows = []
    for rank0, idx in enumerate(order):
        norm = unique_norms[idx]
        rows.append(
            {
                "rank": rank0 + 1,
                "name": display[norm],
                "score": float(logits[idx]),
                "percentile": 100.0 * (n - (rank0 + 1)) / (n - 1),
                "letter": letters[rank0],
                "n_printings": int((records["name_norm"] == norm).sum()),
                "display_only_basic": bool(is_basic[norm]),
            }
        )
    frame = pd.DataFrame(rows)
    frame["score"] = frame["score"].round(6)
    frame["percentile"] = frame["percentile"].round(4)

    csv_path = out_dir / "hob_p1p1_forecast.csv"
    parquet_path = out_dir / "hob_p1p1_forecast.parquet"
    frame.to_csv(csv_path, index=False, lineterminator="\n")
    frame.to_parquet(parquet_path, index=False)

    # Per-printing scores, to prove identical printings share a score.
    per_printing = records[["name", "name_norm", "id"]].copy()
    score_of = dict(zip(unique_norms, logits))
    per_printing["score"] = [score_of[x] for x in per_printing["name_norm"]]
    spread = per_printing.groupby("name_norm")["score"].agg(lambda s: s.max() - s.min())

    summary = {
        "n_records": int(len(records)),
        "n_unique_names": n,
        "max_within_name_score_spread": float(spread.max()),
        "score_min": float(logits.min()),
        "score_max": float(logits.max()),
        "score_mean": float(logits.mean()),
        "score_std": float(logits.std(ddof=0)),
        "n_distinct_scores": int(len(np.unique(logits))),
        "n_nonfinite": int((~np.isfinite(logits)).sum()),
        "band_counts": {letter: c for (letter, _), c in zip(LADDER, counts)},
        "card_list_sha256": sha256_bytes(
            "\n".join(unique_norms).encode("utf-8") + b"\n"
        ),
        "printing_list_sha256": sha256_bytes(
            "\n".join(f"{r.name_norm}\t{r.id}" for r in records.itertuples()).encode(
                "utf-8"
            )
            + b"\n"
        ),
        "outputs": {
            csv_path.name: sha256_file(csv_path),
            parquet_path.name: sha256_file(parquet_path),
        },
    }
    (out_dir / "scoring_summary.json").write_text(
        json.dumps(summary, indent=2, sort_keys=True) + "\n"
    )
    print(json.dumps(summary, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python
"""Assemble DraftFM training data: per-set feature tables + memmap shards.

For every (set, format) shard: gather the set's vocab rows from the frozen
cardfeats table, concatenate the cached text embeddings (fp16 [N, 775]),
derive rarity ids from the manifest's rarity block, write features.npz into
the shard dir, then build the memmap shard from the curated parquet.
"""

import argparse
import json

import numpy as np

from mtga.foundation import dataset
from mtga.lands import corpus, names, paths


def create_parser():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sets", default=None, help="comma list; default corpus")
    parser.add_argument("--force", action="store_true")
    return parser


def load_feature_lookup():
    import pandas as pd

    manifest = json.loads(paths.FEATURIZER_MANIFEST.read_text())
    feats = pd.read_parquet(paths.CARDFEATS_PARQUET)
    feature_cols = [c for b in manifest["blocks"] for c in b["columns"]]
    struct = feats[feature_cols].to_numpy(dtype=np.float32)
    row_of = {n: i for i, n in enumerate(feats["name_norm"])}

    emb = np.load(paths.TEXT_EMB_CACHE, allow_pickle=True)
    emb_names = list(emb["names"])
    emb_matrix = emb["embeddings"].astype(np.float32)
    emb_of = {n: i for i, n in enumerate(emb_names)}

    rarity_block = next(b for b in manifest["blocks"] if b["name"] == "rarity")
    r0 = rarity_block["start"]
    n_rarity = len(rarity_block["columns"])

    def table_for(vocab):
        missing = [n for n in vocab if names.norm_17lands(n) not in row_of]
        emb_missing = [n for n in vocab if names.norm_17lands(n) not in emb_of]
        if missing or emb_missing:
            raise SystemExit(
                f"missing features for {missing[:5]} / embeddings for {emb_missing[:5]}"
            )
        rows = [row_of[names.norm_17lands(n)] for n in vocab]
        erows = [emb_of[names.norm_17lands(n)] for n in vocab]
        struct_part = struct[rows]
        text_part = emb_matrix[erows]
        features = np.concatenate([struct_part, text_part], axis=1).astype(np.float16)
        rarity_ids = struct_part[:, r0:r0 + n_rarity].argmax(axis=1).astype(np.uint8)
        return features, rarity_ids

    return manifest, table_for


def main():
    args = create_parser().parse_args()
    if args.sets:
        requested = [s.strip().upper() for s in args.sets.split(",")]
        pairs = corpus.corpus_jobs(requested)
    else:
        pairs = corpus.corpus_jobs(None)

    manifest, table_for = load_feature_lookup()
    for set_code, fmt in pairs:
        vocab_file = paths.vocab_path(set_code, fmt)
        if not vocab_file.exists():
            print(f"skip {set_code} {fmt}: no curated vocab")
            continue
        vocab = json.loads(vocab_file.read_text())["names"]
        features, rarity_ids = table_for(vocab)
        out = dataset.shard_dir(set_code, fmt)
        out.mkdir(parents=True, exist_ok=True)
        np.savez(out / "features.npz", features=features, rarity_ids=rarity_ids,
                 names=np.array(vocab, dtype=object),
                 manifest_hash=manifest["content_hash"])
        result = dataset.build_shard(set_code, fmt, force=args.force)
        print(f"{set_code} {fmt}: {result['status']} "
              f"({result.get('rows', '-')} rows, vocab {len(vocab)})")


if __name__ == "__main__":
    main()

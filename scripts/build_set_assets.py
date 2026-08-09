#!/usr/bin/env python
"""Build per-set DraftFM serving assets: <data root>/foundation/set_assets/<SET>.npz.

The assets pin everything OnnxDraftFMModel needs to score one set: the
frozen-manifest feature matrix (391 struct + 384 text = 775 fp16 dims per
card), rarity ids, names, and every grpId alias per name (alt arts and
bonus-sheet printings, so any pack grpId resolves).

Name/grpId universe, sourced the way draft_api.DataHub.cards does:
  - curated vocab sidecars (training sets; already include bonus sheets)
  - card store rows for the expansion + global per-name aliases
  - cached 17Lands card_ratings mtga_id fallback (the day-1 path for a set
    whose grpIds haven't reached cards.csv yet — i.e. MSH at hour zero)

Features come from the frozen CARDFEATS_PARQUET when the name is there;
anything else (MSH day-1) is featurized on the fly through the frozen
manifest — the zero-shot contract. Text embeddings are served from the
TEXT_EMB_CACHE (extended in-process if sentence-transformers is importable);
--allow-missing-text zero-fills instead of failing, for hour-zero serving
before the embed step has run.

  build_set_assets.py --set MSH
  build_set_assets.py --set SOS --out /tmp/SOS.npz
"""

import argparse
import datetime
import json
import sys

import numpy as np

from mtga.foundation import featurize, textemb
from mtga.lands import config, corpus, names as names_mod, paths


def create_parser():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--set", required=True, dest="set_code")
    parser.add_argument(
        "--out", default=None, help="default: paths.set_assets_path(SET)"
    )
    parser.add_argument(
        "--allow-missing-text",
        action="store_true",
        help="zero-fill text embeddings that are not in the "
        "cache instead of failing",
    )
    return parser


# ---------------------------------------------------------------------------
# Universe: name -> [grp_ids].


def universe(set_code):
    """Ordered {name: [grp_ids]} for one set's draftable card universe."""
    grp_lists = {}

    # Names: curated vocab, then card store expansion rows, then the cached
    # 17Lands card_ratings (the only source that knows a brand-new set).
    for vocab_file in sorted(
        (paths.CURATED_DIR / "draft").glob(f"{set_code}.*.vocab.json")
    ):
        for name in json.loads(vocab_file.read_text())["names"]:
            grp_lists.setdefault(name, [])

    if paths.CARD_STORE_PARQUET.exists():
        from mtga.lands import cardstore

        store = cardstore.load_card_store()
        for name in store.loc[store["expansion"] == set_code, "name"]:
            grp_lists.setdefault(name, [])

    rated = []
    for fmt in config.FORMATS:
        link = paths.latest_symlink(paths.card_ratings_path(set_code, fmt, "x"))
        if not link.exists():
            continue
        with open(link) as fh:
            for row in json.load(fh):
                grp_id, name = row.get("mtga_id"), row.get("name")
                if not grp_id or not name:
                    continue
                grp_lists.setdefault(name, [])
                rated.append((name, int(grp_id)))
        break

    # grpIds: every store printing sharing the name (alt arts, bonus sheets
    # under other expansion codes), plus the ratings-cache mtga_id fallback.
    if paths.CARD_STORE_PARQUET.exists():
        from mtga.lands import cardstore

        _, aliases, _ = cardstore.name_resolution(set_code)
        for name, grps in grp_lists.items():
            for grp_id in aliases.get(name, []):
                if int(grp_id) not in grps:
                    grps.append(int(grp_id))
    for name, grp_id in rated:
        if grp_id not in grp_lists[name]:
            grp_lists[name].append(grp_id)

    return grp_lists


# ---------------------------------------------------------------------------
# Features through the frozen manifest.


def feature_table(set_code, names, allow_missing_text=False):
    """(features fp16 [N, 775], rarity_ids uint8 [N], manifest, text_missing).

    Rows align with `names`. Structured features come from the frozen
    cardfeats parquet when present, else on-the-fly featurization through
    the frozen manifest (never a rebuilt manifest — zero-shot contract).
    """
    manifest = featurize.load_manifest()
    columns = featurize.manifest_columns(manifest)
    norms = [names_mod.norm_17lands(n) for n in names]

    struct = np.zeros((len(names), manifest["n_features"]), dtype=np.float32)
    have = set()
    if paths.CARDFEATS_PARQUET.exists():
        import pandas as pd

        feats = pd.read_parquet(paths.CARDFEATS_PARQUET)
        matrix = feats[columns].to_numpy(dtype=np.float32)
        row_of = {n: i for i, n in enumerate(feats["name_norm"])}
        for i, norm in enumerate(norms):
            if norm in row_of:
                struct[i] = matrix[row_of[norm]]
                have.add(i)

    fresh = [names[i] for i in range(len(names)) if i not in have]
    if fresh:
        prefer = {n: [set_code] for n in fresh}
        matrix, _ = featurize.featurize(fresh, manifest, prefer_sets_by_name=prefer)
        for row, name in zip(matrix, fresh):
            struct[names.index(name)] = row

    text_missing = []
    try:
        text = textemb.embed_names(names)
    except RuntimeError:
        if not allow_missing_text:
            raise
        cache = textemb._read_cache(paths.TEXT_EMB_CACHE)
        text = np.zeros((len(names), textemb.EMBED_DIM), dtype=np.float32)
        for i, norm in enumerate(norms):
            if norm in cache:
                text[i] = cache[norm]
            else:
                text_missing.append(names[i])

    rarity_block = next(b for b in manifest["blocks"] if b["name"] == "rarity")
    r0, width = rarity_block["start"], len(rarity_block["columns"])
    rarity_ids = struct[:, r0 : r0 + width].argmax(axis=1).astype(np.uint8)

    features = np.concatenate([struct, text], axis=1).astype(np.float16)
    return features, rarity_ids, manifest, text_missing


def picks_per_pack_for(set_code):
    if set_code in corpus.CORPUS:
        return corpus.CORPUS[set_code].picks_per_pack
    for fmt in config.FORMATS:
        meta = paths.meta_path(paths.curated_path("draft", set_code, fmt))
        if meta.exists():
            recorded = json.loads(meta.read_text()).get("picks_per_pack")
            if recorded:
                return int(recorded)
    return 14


def build(set_code, out_path=None, allow_missing_text=False):
    grp_lists = universe(set_code)
    if not grp_lists:
        raise FileNotFoundError(
            f"no card universe for {set_code}: need a curated vocab, card "
            f"store rows, or a cached card_ratings JSON"
        )
    names = list(grp_lists)
    features, rarity_ids, manifest, text_missing = feature_table(
        set_code, names, allow_missing_text=allow_missing_text
    )

    out_path = out_path or paths.set_assets_path(set_code)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    np.savez(
        out_path,
        features=features,
        rarity_ids=rarity_ids,
        names=np.array(names),
        grp_ids=json.dumps(grp_lists),
        manifest_hash=manifest["content_hash"],
        picks_per_pack=picks_per_pack_for(set_code),
        set=set_code,
        text_missing=json.dumps(text_missing),
        built_at=datetime.datetime.now().isoformat(timespec="seconds"),
    )
    return {
        "path": out_path,
        "n_cards": len(names),
        "n_grp_ids": sum(len(g) for g in grp_lists.values()),
        "manifest_hash": manifest["content_hash"],
        "text_missing": text_missing,
    }


def main(argv=None):
    args = create_parser().parse_args(argv)
    set_code = args.set_code.strip().upper()
    from pathlib import Path

    out = Path(args.out) if args.out else None
    try:
        result = build(set_code, out, allow_missing_text=args.allow_missing_text)
    except (FileNotFoundError, featurize.UnmatchedNamesError, RuntimeError) as err:
        print(f"FAILED: {err}", file=sys.stderr)
        sys.exit(2)
    print(
        f"{set_code}: {result['n_cards']} cards, "
        f"{result['n_grp_ids']} grpIds -> {result['path']} "
        f"(manifest {result['manifest_hash'][:12]})"
    )
    if result["text_missing"]:
        print(
            f"WARNING: {len(result['text_missing'])} name(s) zero-filled "
            f"text embeddings: {result['text_missing'][:5]} ...",
            file=sys.stderr,
        )


if __name__ == "__main__":
    main()

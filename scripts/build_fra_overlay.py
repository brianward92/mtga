#!/usr/bin/env python
"""Package the frozen FRA forecast features for the offline Arena overlay.

Uses the saved September 20 forecast inputs, a current Scryfall snapshot for
display metadata, and Arena's installed card database for day-zero grpIds.
The five display-only basics are omitted, as in other overlay set bundles.
"""

import argparse
import csv
import hashlib
import json
import sqlite3
from pathlib import Path

import numpy as np

from mtga.lands.names import norm_17lands
from scripts.build_app_bundle import (
    DEFAULT_OUT,
    Snapshot,
    _write_json,
    _now,
    build_cards,
    load_model,
    resolve_model_dir,
    snapshot_updated_at,
)
from scripts.build_arena_mapping import clean_name, find_arena_db

ROOT = Path(__file__).resolve().parents[1]
FORECAST_DIR = ROOT / "data/forecast_20260919/fra"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scryfall", type=Path, required=True)
    parser.add_argument("--arena-db", type=Path, default=None)
    parser.add_argument("--forecast-dir", type=Path, default=FORECAST_DIR)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args()

    forecast = args.forecast_dir
    recorded = json.loads((forecast / "forecast_manifest.json").read_text())
    csv_path = forecast / "fra_p1p1_forecast.csv"
    digest = hashlib.sha256(csv_path.read_bytes()).hexdigest()
    if digest != recorded["outputs"][csv_path.name]:
        raise ValueError("FRA forecast CSV differs from its recorded hash")
    if (
        hashlib.sha256((forecast / "features.npz").read_bytes()).hexdigest()
        != recorded["features_sha256"]
    ):
        raise ValueError("FRA frozen features differ from their recorded hash")
    rows = list(csv.DictReader(csv_path.open(newline="")))
    if len(rows) != recorded["n_unique"] or len({r["name"] for r in rows}) != len(rows):
        raise ValueError("FRA forecast name count or uniqueness changed")
    names = [r["name"] for r in rows if r["display_only_basic"] == "False"]
    if len(names) != recorded["n_unique"] - 5:
        raise ValueError("expected five display-only basics")

    model_dir = resolve_model_dir(None)
    _, manifest = load_model(model_dir)
    if manifest["content_hash"] != recorded["feature_manifest_content_hash"]:
        raise ValueError("forecast and overlay model feature manifests differ")
    index_path = args.out / "index.json"
    index = json.loads(index_path.read_text())
    if index["model_manifest_hash"] != manifest["content_hash"]:
        raise ValueError("existing bundle index uses another model manifest")
    saved = np.load(forecast / "features.npz", allow_pickle=False)
    saved_names = list(saved["names"])
    if set(saved_names) != {r["name"] for r in rows}:
        raise ValueError("frozen feature names differ from the forecast")
    by_name = {name: i for i, name in enumerate(saved_names)}
    features = saved["features"][[by_name[name] for name in names]]
    if features.shape != (len(names), 775) or features.dtype != np.float16:
        raise ValueError(
            f"unexpected frozen feature shape or dtype: {features.shape} {features.dtype}"
        )
    rarity = next(block for block in manifest["blocks"] if block["name"] == "rarity")
    start, width = rarity["start"], len(rarity["columns"])
    rarity_ids = features[:, start : start + width].argmax(axis=1).astype(np.uint8)

    updated_at = snapshot_updated_at(args.scryfall)
    snapshot = Snapshot(args.scryfall, updated_at)
    cards = build_cards("FRA", names, snapshot)

    arena_db = args.arena_db or find_arena_db()
    if not arena_db:
        raise ValueError("Arena card database is required for FRA grpIds")
    conn = sqlite3.connect(f"file:{arena_db}?mode=ro", uri=True)
    try:
        arena_rows = conn.execute("""
            SELECT c.GrpId, t.Loc FROM Cards c
            JOIN Localizations_enUS t ON t.LocId = c.TitleId AND t.Formatted = 1
            WHERE c.ExpansionCode IN ('FRA', 'SPG')
              AND c.IsToken = 0 AND c.IsPrimaryCard = 1
        """).fetchall()
    finally:
        conn.close()
    by_arena_name = {}
    for grp_id, raw_name in arena_rows:
        by_arena_name.setdefault(norm_17lands(clean_name(raw_name)), []).append(
            int(grp_id)
        )
    grp_ids = {}
    owner = {}
    for name in names:
        keys = {norm_17lands(name), norm_17lands(name.split(" // ")[0])}
        ids = sorted({grp for key in keys for grp in by_arena_name.get(key, [])})
        if not ids:
            raise ValueError(f"Arena has no FRA/SPG grpId for {name!r}")
        for grp_id in ids:
            previous = owner.setdefault(grp_id, name)
            if previous != name:
                raise ValueError(
                    f"Arena grpId {grp_id} maps to {previous!r} and {name!r}"
                )
        grp_ids[name] = ids

    out = args.out
    set_dir = out / "FRA"
    set_dir.mkdir(parents=True, exist_ok=True)
    built_at = _now()
    tmp = set_dir / "assets.npz.tmp.npz"
    np.savez(
        tmp,
        features=features,
        rarity_ids=rarity_ids,
        names=np.array(names),
        grp_ids=json.dumps(grp_ids),
        manifest_hash=manifest["content_hash"],
        picks_per_pack=14,
        set="FRA",
        text_missing="[]",
        built_at=built_at,
    )
    tmp.replace(set_dir / "assets.npz")
    _write_json(
        set_dir / "cards.json",
        {
            "set": "FRA",
            "scryfall_updated_at": updated_at,
            "built_at": built_at,
            "cards": cards,
        },
    )
    (set_dir / "ratings.json").unlink(missing_ok=True)

    index["sets"]["FRA"] = {
        "picks_per_pack": 14,
        "manifest_hash": manifest["content_hash"],
        "cards": len(names),
        "grp_ids": sum(map(len, grp_ids.values())),
        "text_missing": 0,
        "built_at": built_at,
        "scryfall_updated_at": updated_at,
    }
    index["sets"] = dict(sorted(index["sets"].items()))
    index["built_at"] = built_at
    _write_json(index_path, index)
    print(
        f"FRA: {len(names)} draftable names, {index['sets']['FRA']['grp_ids']} Arena ids; "
        f"forecast {digest}; Scryfall {updated_at}; Arena {arena_db.name}"
    )


if __name__ == "__main__":
    main()

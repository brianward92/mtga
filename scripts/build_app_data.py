import argparse
from datetime import date
import gzip
import json
import os
from pathlib import Path

import pandas as pd

# Historical floor for the app. Default builds union this list with released
# Scryfall expansion sets so the registry grows automatically over time.
BASE_SET_CODES = [
    "MH2",
    "NEO",
    "SNC",
    "DMU",
    "BRO",
    "ONE",
    "MOM",
    "LTR",
    "WOE",
    "LCI",
    "MKM",
    "OTJ",
    "MH3",
    "BLB",
    "DSK",
    "FDN",
    "DFT",
    "TDM",
    "FIN",
    "EOE",
    "SPM",
    "TLA",
    "TMT",
]
AUTO_SET_TYPES = {"expansion"}
DATA_SCHEMA_VERSION = 4
SET_FIELDS = [
    "id",
    "name",
    "collectorNumber",
    "colors",
    "manaCost",
    "typeLine",
    "rarity",
    "priceUsd",
    "priceUsdFoil",
    "priceUsdEtched",
    "valueHint",
    "imageSmallUrl",
    "imageNormalUrl",
]
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".avif"}


def create_parser():
    desc = "Build lazy-load app/data JSON files from processed parquet files"
    parser = argparse.ArgumentParser(description=desc)
    parser.add_argument("--sets", nargs="*", help="Set codes to include.")
    return parser


def read_with_error(fpath):
    if not fpath.exists():
        raise FileNotFoundError(f"File not found: {fpath}")
    else:
        return pd.read_parquet(fpath)


def clean_value(value):
    if pd.isna(value):
        return None
    return value


def clean_text(value):
    value = clean_value(value)
    return "" if value is None else value


def clean_price(value):
    value = clean_value(value)
    return None if value is None else float(value)


def dedupe_preserving_order(values):
    seen = set()
    result = []
    for value in values:
        if value not in seen:
            seen.add(value)
            result.append(value)
    return result


def resolve_default_set_codes(cards_df, sets_df):
    card_set_codes = set(cards_df["set"].dropna().str.upper().unique())
    baseline = [code for code in BASE_SET_CODES if code in card_set_codes]
    union = set(baseline)

    sets_with_dates = sets_df.copy()
    sets_with_dates["released_at"] = pd.to_datetime(
        sets_with_dates["released_at"], errors="coerce"
    )
    baseline_dates = sets_with_dates[
        sets_with_dates["set"].isin(baseline)
    ]["released_at"].dropna()
    min_release_date = baseline_dates.min() if not baseline_dates.empty else None

    if "set_type" in sets_with_dates.columns:
        today = pd.Timestamp(date.today())
        auto_mask = (
            sets_with_dates["set"].isin(card_set_codes)
            & sets_with_dates["set_type"].isin(AUTO_SET_TYPES)
            & sets_with_dates["released_at"].notna()
            & (sets_with_dates["released_at"] <= today)
        )
        if min_release_date is not None:
            auto_mask &= sets_with_dates["released_at"] >= min_release_date
        auto_sets = sets_with_dates[auto_mask]["set"].tolist()
        union.update(auto_sets)

    baseline_rank = {code: index for index, code in enumerate(BASE_SET_CODES)}
    ordered_sets = sets_with_dates[sets_with_dates["set"].isin(union)].copy()
    ordered_sets["baseline_rank"] = (
        ordered_sets["set"].map(baseline_rank).fillna(len(BASE_SET_CODES)).astype(int)
    )
    ordered_sets = ordered_sets.sort_values(
        ["released_at", "baseline_rank", "set"],
        na_position="first",
    )
    return ordered_sets["set"].tolist()


def resolve_default_set_code(set_codes, sets_df):
    sets_with_dates = sets_df[sets_df["set"].isin(set_codes)].copy()
    sets_with_dates["released_at"] = pd.to_datetime(
        sets_with_dates["released_at"], errors="coerce"
    )
    sets_with_dates = sets_with_dates.sort_values(
        ["released_at", "set"],
        na_position="first",
    )
    if sets_with_dates.empty:
        return set_codes[-1]
    return sets_with_dates.iloc[-1]["set"]


def resolve_build_id(paths):
    latest_mtime = max(path.stat().st_mtime for path in paths)
    return f"v{DATA_SCHEMA_VERSION}-{int(latest_mtime)}"


def write_json(path, payload, *, indent=None):
    with path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, indent=indent, separators=(",", ":"), ensure_ascii=False)
        f.write("\n")
    write_gzip_copy(path)


def write_gzip_copy(path):
    gz_path = path.with_suffix(path.suffix + ".gz")
    gz_path.write_bytes(gzip.compress(path.read_bytes(), compresslevel=9, mtime=0))


def compact_card_row(card, colors, value_hint):
    image_normal_url = clean_value(card.get("image_normal_url"))
    legacy_image_url = clean_value(card.get("image_url"))
    image_normal_url = image_normal_url or legacy_image_url
    image_small_url = clean_value(card.get("image_small_url")) or image_normal_url

    values = {
        "id": card["id"],
        "name": card["name"],
        "collectorNumber": card["collector_number"],
        "colors": colors,
        "manaCost": clean_text(card["mana_cost"]),
        "typeLine": clean_text(card["type_line"]),
        "rarity": clean_text(card["rarity"]),
        "priceUsd": clean_price(card["price_usd"]),
        "priceUsdFoil": clean_price(card["price_usd_foil"]),
        "priceUsdEtched": clean_price(card["price_usd_etched"]),
        "valueHint": value_hint,
        "imageSmallUrl": image_small_url,
        "imageNormalUrl": image_normal_url,
    }
    return [values[field] for field in SET_FIELDS]


def resolve_thumbnail_cache_path(output_dir):
    images_dir = output_dir / "images"
    if not images_dir.is_dir():
        return None
    has_images = any(
        child.is_file() and child.suffix.lower() in IMAGE_SUFFIXES
        for child in images_dir.iterdir()
    )
    return "images" if has_images else None


if __name__ == "__main__":

    # Parser -> args -> unpack args
    parser = create_parser()
    args = parser.parse_args()

    # Determine paths
    user = os.getenv("USER", "unknown")
    processed_prefix = Path(f"/opt/{user}/dat/mtga/processed")
    script_dir = Path(__file__).resolve().parent
    repo_root = script_dir.parent
    output_dir = repo_root / "app" / "data"
    manifest_path = output_dir / "manifest.json"
    sets_dir = output_dir / "sets"
    thumbnail_cache_path = resolve_thumbnail_cache_path(output_dir)

    # Read Cards
    cards_path = processed_prefix / "cards.parquet"
    cards_df = read_with_error(cards_path)
    cards_df["set"] = cards_df["set"].str.upper()

    # Read Sets
    sets_path = processed_prefix / "sets.parquet"
    sets_df = read_with_error(sets_path)
    sets_df["set"] = sets_df["set"].str.upper()
    if args.sets:
        set_codes = dedupe_preserving_order([s.upper() for s in args.sets])
    else:
        set_codes = resolve_default_set_codes(cards_df, sets_df)
    print(f"Building app data for sets: {', '.join(set_codes)}")

    cards_df = cards_df[cards_df["set"].isin(set_codes)]
    sets_df = sets_df[sets_df["set"].isin(set_codes)]

    # Check
    if cards_df.empty or sets_df.empty:
        raise ValueError("Got 0 data to write for application.")

    # Convert to app format, split by set for lazy loading.
    app_sets = {set_code: [] for set_code in set_codes}
    for _, card in cards_df.iterrows():
        # Parse colors (comma-separated string to array)
        colors = (
            card["colors"].split(",")
            if pd.notna(card["colors"]) and card["colors"]
            else []
        )

        # Create value hint from price
        value_hint = None
        if pd.notna(card.get("price_best")) and card["price_best"] > 0:
            value_hint = f"${card['price_best']:.2f}"

        app_sets[card["set"]].append(compact_card_row(card, colors, value_hint))

    # Write compact JSON for the web app.
    output_dir.mkdir(parents=True, exist_ok=True)
    sets_dir.mkdir(parents=True, exist_ok=True)
    for stale_path in list(sets_dir.glob("*.json")) + list(sets_dir.glob("*.json.gz")):
        stale_path.unlink()

    old_cards_path = output_dir / "cards.js"
    if old_cards_path.exists():
        old_cards_path.unlink()

    manifest_sets = []
    total_cards = 0
    for set_code in set_codes:
        set_cards = app_sets[set_code]
        set_path = sets_dir / f"{set_code}.json"
        set_payload = {
            "schemaVersion": DATA_SCHEMA_VERSION,
            "setCode": set_code,
            "fields": SET_FIELDS,
            "cards": set_cards,
        }
        write_json(set_path, set_payload)

        set_rows = sets_df[sets_df["set"] == set_code]
        set_name = set_rows.iloc[0]["set_name"] if not set_rows.empty else set_code
        manifest_sets.append(
            {
                "setCode": set_code,
                "setName": set_name,
                "cardCount": len(set_cards),
                "cardsPath": f"sets/{set_code}.json",
            }
        )
        total_cards += len(set_cards)
        print(f"Wrote {len(set_cards):,} cards to {set_path}")

    manifest = {
        "schemaVersion": DATA_SCHEMA_VERSION,
        "buildId": resolve_build_id([cards_path, sets_path]),
        "defaultSetCode": resolve_default_set_code(set_codes, sets_df),
        "sets": manifest_sets,
    }
    if thumbnail_cache_path:
        manifest["thumbnailCachePath"] = thumbnail_cache_path
    write_json(manifest_path, manifest, indent=2)

    print(f"Wrote manifest for {len(manifest_sets):,} sets to {manifest_path}")
    print(f"Wrote gzip copies for manifest and set files.")
    print(f"Wrote {total_cards:,} cards across split set files.")

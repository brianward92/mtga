import argparse
import json
import os
from pathlib import Path

import pandas as pd

# Default: Main expansion sets from 2021-2025 (sorted by release date)
DEFAULT_SET_CODES = [
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


def create_parser():
    desc = "Build app/data/cards.js from processed parquet files"
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


if __name__ == "__main__":

    # Parser -> args -> unpack args
    parser = create_parser()
    args = parser.parse_args()
    if args.sets:
        set_codes = [s.upper() for s in args.sets]
    else:
        set_codes = DEFAULT_SET_CODES
    print(f"Building app data for sets: {', '.join(set_codes)}")

    # Determine paths
    user = os.getenv("USER", "unknown")
    processed_prefix = Path(f"/opt/{user}/dat/mtga/processed")
    script_dir = Path(__file__).resolve().parent
    repo_root = script_dir.parent
    output_dir = repo_root / "app" / "data"
    manifest_path = output_dir / "manifest.json"
    sets_dir = output_dir / "sets"

    # Read Cards
    cards_path = processed_prefix / "cards.parquet"
    cards_df = read_with_error(cards_path)
    cards_df["set"] = cards_df["set"].str.upper()
    cards_df = cards_df[cards_df["set"].isin(set_codes)]

    # Read Sets
    sets_path = processed_prefix / "sets.parquet"
    sets_df = read_with_error(sets_path)
    sets_df["set"] = sets_df["set"].str.upper()
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

        app_card = {
            "id": card["id"],
            "name": card["name"],
            "setCode": card["set"],
            "setName": card["set_name"],
            "collectorNumber": card["collector_number"],
            "colors": colors,
            "manaCost": clean_text(card["mana_cost"]),
            "typeLine": clean_text(card["type_line"]),
            "rarity": clean_text(card["rarity"]),
            "priceUsd": clean_price(card["price_usd"]),
            "priceUsdFoil": clean_price(card["price_usd_foil"]),
            "priceUsdEtched": clean_price(card["price_usd_etched"]),
            "valueHint": value_hint,
            "imageUrl": clean_value(card["image_url"]),
        }
        app_sets[card["set"]].append(app_card)

    # Write as JSON for Web App
    sets_dir.mkdir(parents=True, exist_ok=True)
    for stale_path in sets_dir.glob("*.json"):
        stale_path.unlink()

    old_cards_path = output_dir / "cards.js"
    if old_cards_path.exists():
        old_cards_path.unlink()

    manifest_sets = []
    total_cards = 0
    for set_code in set_codes:
        set_cards = app_sets[set_code]
        set_path = sets_dir / f"{set_code}.json"
        with set_path.open("w", encoding="utf-8") as f:
            json.dump(set_cards, f, separators=(",", ":"), ensure_ascii=False)
            f.write("\n")

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
        "defaultSetCode": set_codes[-1],
        "sets": manifest_sets,
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    with manifest_path.open("w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
        f.write("\n")

    print(f"Wrote manifest for {len(manifest_sets):,} sets to {manifest_path}")
    print(f"Wrote {total_cards:,} cards across split set files.")

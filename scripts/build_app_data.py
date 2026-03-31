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
    output_path = repo_root / "app" / "data" / "cards.js"

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

    # Convert to app format
    app_cards = []
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
            "typeLine": card["type_line"] if pd.notna(card["type_line"]) else "",
            "rarity": card["rarity"] if pd.notna(card["rarity"]) else "",
            "valueHint": value_hint,
            "imageUrl": card["image_url"] if pd.notna(card["image_url"]) else None,
        }
        app_cards.append(app_card)

    # Write as JavaScript for Web App
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as f:
        f.write("window.MTG_CARDS = ")
        json.dump(app_cards, f, indent=2, ensure_ascii=False)
        f.write(";\n")
    print(f"Wrote {len(app_cards):,} cards to {output_path}")

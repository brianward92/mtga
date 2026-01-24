import argparse
import json
import os
from pathlib import Path

import pandas as pd


def create_parser():
    desc = "Build slim database from Scryfall bulk data."
    parser = argparse.ArgumentParser(description=desc)
    parser.add_argument("--input", type=Path, help="Path to input JSON file.")
    return parser


def extract_best_price(prices):
    """Extract best available price and all price variants."""
    usd = prices.get("usd")
    usd_foil = prices.get("usd_foil")
    usd_etched = prices.get("usd_etched")

    # Convert to float, handling None
    def to_float(val):
        if val is None:
            return None
        try:
            return float(val)
        except (ValueError, TypeError):
            return None

    usd = to_float(usd)
    usd_foil = to_float(usd_foil)
    usd_etched = to_float(usd_etched)

    # Best price is max of available prices
    available = [p for p in [usd, usd_foil, usd_etched] if p is not None]
    best = max(available) if available else None

    return {
        "price_usd": usd,
        "price_usd_foil": usd_foil,
        "price_usd_etched": usd_etched,
        "price_best": best,
    }


def extract_image_url(card):
    """Extract best available image URL."""

    def pick_best(img_block):
        if not img_block:
            return None
        for key in ("normal", "large", "png"):
            if img_block.get(key):
                return img_block[key]
        return None

    # Try card-level image_uris first
    img = pick_best(card.get("image_uris"))
    if img:
        return img

    # Fall back to first face
    faces = card.get("card_faces") or []
    for face in faces:
        img = pick_best(face.get("image_uris"))
        if img:
            return img

    return None


def process_cards(cards_iter):
    """
    Process cards into structured dataframes.

    Params
    ------
    cards_iter : Iterator[dict]
        Stream of card objects

    Returns
    -------
    dict
        cards : pd.DataFrame
            Main card data
        sets : pd.DataFrame
            Set metadata
        card_faces : pd.DataFrame
            Multi-faced card data
    """
    cards_data = []
    sets_data = {}
    faces_data = []

    for card in cards_iter:
        # Skip non-English and digital-only cards
        if card.get("lang") != "en" or card.get("digital"):
            continue

        # Extract prices
        prices = extract_best_price(card.get("prices") or {})

        # Core card data
        card_row = {
            "id": card.get("id"),
            "name": card.get("name"),
            "set": card.get("set"),
            "set_name": card.get("set_name"),
            "collector_number": card.get("collector_number"),
            "rarity": card.get("rarity"),
            "type_line": card.get("type_line"),
            "mana_cost": card.get("mana_cost"),
            "cmc": card.get("cmc"),
            "colors": ",".join(card.get("colors") or []),
            "color_identity": ",".join(card.get("color_identity") or []),
            "oracle_text": card.get("oracle_text"),
            "power": card.get("power"),
            "toughness": card.get("toughness"),
            "loyalty": card.get("loyalty"),
            "keywords": ",".join(card.get("keywords") or []),
            "layout": card.get("layout"),
            "image_url": extract_image_url(card),
            **prices,
        }
        cards_data.append(card_row)

        # Collect set metadata
        set_code = card.get("set")
        if set_code and set_code not in sets_data:
            sets_data[set_code] = {
                "set": set_code,
                "set_name": card.get("set_name"),
                "released_at": card.get("released_at"),
            }

        # Handle multi-faced cards
        card_faces = card.get("card_faces")
        if card_faces:
            for i, face in enumerate(card_faces):
                face_row = {
                    "card_id": card.get("id"),
                    "face_index": i,
                    "name": face.get("name"),
                    "mana_cost": face.get("mana_cost"),
                    "type_line": face.get("type_line"),
                    "oracle_text": face.get("oracle_text"),
                    "colors": ",".join(face.get("colors") or []),
                    "power": face.get("power"),
                    "toughness": face.get("toughness"),
                    "loyalty": face.get("loyalty"),
                }
                faces_data.append(face_row)

    # Convert to DataFrames
    cards_df = pd.DataFrame(cards_data)
    sets_df = pd.DataFrame(list(sets_data.values()))
    faces_df = pd.DataFrame(faces_data) if faces_data else pd.DataFrame()

    return {
        "cards": cards_df,
        "sets": sets_df,
        "card_faces": faces_df,
    }


if __name__ == "__main__":

    # Parser -> args + cfg/dirs for $USER
    parser = create_parser()
    args = parser.parse_args()
    input_path = args.input
    user = os.getenv("USER", "unknown")
    data_home = Path(f"/opt/{user}/dat")

    # Determine input path
    if input_path is None:
        input_path = data_home / "mtga" / "scryfall" / "all_cards.json"

    # Check existence, then read
    if not input_path.exists():
        raise FileNotFoundError(f"Input file not found: {input_path}")
    print(f"Reading cards from {input_path}")
    with open(input_path, "r", encoding="utf-8") as fh:
        cards_iter = json.load(fh)

    # Process
    print("Processing cards...")
    result = process_cards(cards_iter)

    # Output prefix
    processed_prefix = data_home / "mtga" / "processed"
    processed_prefix.mkdir(parents=True, exist_ok=True)

    # Write Cards
    cards_path = processed_prefix / "cards.parquet"
    print(f"Writing {len(result['cards'])} cards to {cards_path}")
    result["cards"].to_parquet(cards_path)

    # Writes Sets
    sets_path = processed_prefix / "sets.parquet"
    print(f"Writing {len(result['sets'])} sets to {sets_path}")
    result["sets"].to_parquet(sets_path)

    # Write Faces
    if not result["card_faces"].empty:
        faces_path = processed_prefix / "card_faces.parquet"
        print(f"Writing {len(result['card_faces'])} card faces to {faces_path}")
        result["card_faces"].to_parquet(faces_path)

    print("Processing complete!")

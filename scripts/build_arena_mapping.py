#!/usr/bin/env python3
"""
Build arena card mapping (grpId -> card info) for MTGA Tracker.

Downloads card data from MTGJSON and extracts Arena IDs to create
a mapping file that the Electron app can use.
"""

import json
import gzip
import os
import sys
from pathlib import Path
from urllib.request import urlopen, Request
from typing import Any

# MTGJSON URLs - AllPrintings contains all cards with identifiers including mtgArenaId
MTGJSON_ALLPRINTINGS_URL = "https://mtgjson.com/api/v5/AllPrintings.json"

# Output path
OUTPUT_DIR = Path(__file__).parent.parent / "data"
OUTPUT_FILE = OUTPUT_DIR / "arena_mapping.json"


def download_json(url: str) -> dict[str, Any]:
    """Download and parse JSON from URL."""
    print(f"Downloading from {url}...")
    print("(This may take a while for large files...)")

    req = Request(url, headers={"Accept-Encoding": "gzip"})
    with urlopen(req, timeout=300) as response:
        if response.info().get("Content-Encoding") == "gzip":
            data = gzip.decompress(response.read()).decode("utf-8")
        else:
            data = response.read().decode("utf-8")
        return json.loads(data)


def build_mapping() -> dict[int, dict[str, Any]]:
    """Build the grpId to card info mapping."""

    # Download all printings data (contains Arena IDs in identifiers)
    print("Downloading AllPrintings data from MTGJSON...")
    all_data = download_json(MTGJSON_ALLPRINTINGS_URL)

    sets_data = all_data.get("data", {})
    mapping: dict[int, dict[str, Any]] = {}

    print(f"Processing {len(sets_data)} sets...")

    # Process each set
    for set_code, set_info in sets_data.items():
        cards = set_info.get("cards", [])

        for card in cards:
            # Get Arena ID from identifiers
            identifiers = card.get("identifiers", {})
            arena_id = identifiers.get("mtgArenaId")

            if not arena_id:
                continue

            # Convert to int if string
            try:
                arena_id = int(arena_id)
            except (ValueError, TypeError):
                continue

            if arena_id <= 0:
                continue

            # Skip if we already have this card (prefer first occurrence)
            if arena_id in mapping:
                continue

            # Build card info
            card_info = {
                "name": card.get("name", "Unknown"),
                "manaCost": card.get("manaCost", ""),
                "type": card.get("type", ""),
                "rarity": card.get("rarity", "common"),
                "colors": card.get("colors", []),
                "colorIdentity": card.get("colorIdentity", []),
                "text": card.get("text", ""),
                "setCode": set_code,
            }

            mapping[arena_id] = card_info

    return mapping


def main():
    """Main entry point."""
    print("Building Arena card mapping...")

    # Ensure output directory exists
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # Build the mapping
    mapping = build_mapping()

    if not mapping:
        print("Warning: No cards with Arena IDs found. Creating empty mapping.")
        mapping = {}

    # Write to file
    print(f"Writing {len(mapping)} cards to {OUTPUT_FILE}...")
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(mapping, f, ensure_ascii=False, indent=2)

    print("Done!")
    print(f"Card mapping saved to: {OUTPUT_FILE}")


if __name__ == "__main__":
    main()

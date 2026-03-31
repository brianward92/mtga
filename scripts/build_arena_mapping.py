#!/usr/bin/env python3
"""
Build arena card mapping (grpId -> card info) for MTGA Tracker.

Primary source: Arena's own CardDatabase SQLite file (most complete, always current).
Fallback sources: MTGJSON AllPrintings or Scryfall bulk data.

Usage:
  python build_arena_mapping.py                    # Auto-detect Arena DB
  python build_arena_mapping.py --arena-db <path>  # Explicit Arena DB path
  python build_arena_mapping.py --mtgjson           # Download from MTGJSON (fallback)
  python build_arena_mapping.py --scryfall <path>   # Merge Scryfall data
"""

import argparse
import json
import gzip
import os
import re
import sqlite3
from pathlib import Path
from urllib.request import urlopen, Request
from typing import Any

# MTGJSON fallback URL
MTGJSON_ALLPRINTINGS_URL = "https://mtgjson.com/api/v5/AllPrintings.json"

# Default Arena DB location (macOS)
ARENA_DB_GLOB = Path.home() / "Library/Application Support/com.wizards.mtga/Downloads/Raw"

# Output path
OUTPUT_DIR = Path(__file__).parent.parent / "data"
OUTPUT_FILE = OUTPUT_DIR / "arena_mapping.json"

COLOR_MAP = {1: "W", 2: "U", 3: "B", 4: "R", 5: "G"}
RARITY_MAP = {0: "token", 1: "common", 2: "uncommon", 3: "rare", 4: "mythic", 5: "land"}


def find_arena_db() -> Path | None:
    """Find the Arena CardDatabase file."""
    if not ARENA_DB_GLOB.exists():
        return None
    for f in ARENA_DB_GLOB.iterdir():
        if f.name.startswith("Raw_CardDatabase") and f.suffix == ".mtga":
            return f
    return None


def build_mapping_arena_db(db_path: Path) -> dict[int, dict[str, Any]]:
    """Build mapping from Arena's own CardDatabase SQLite file."""
    print(f"Reading Arena CardDatabase: {db_path}")
    conn = sqlite3.connect(str(db_path))
    cur = conn.cursor()

    # Build localization lookup: LocId -> English text
    loc = {}
    cur.execute("SELECT LocId, Loc FROM Localizations_enUS")
    for row in cur.fetchall():
        loc[row[0]] = row[1]

    # Build card mapping
    cur.execute("""
        SELECT GrpId, TitleId, TypeTextId, SubtypeTextId, Rarity, ExpansionCode,
               Colors, ColorIdentity, Power, Toughness, OldSchoolManaText
        FROM Cards
        WHERE IsToken = 0 AND IsPrimaryCard = 1
    """)

    mapping: dict[int, dict[str, Any]] = {}
    for row in cur.fetchall():
        grp_id = row[0]
        title = loc.get(row[1], f"Unknown ({row[1]})")
        type_text = loc.get(row[2], "")
        rarity = RARITY_MAP.get(row[4], "common")
        set_code = (row[5] or "").upper()
        mana_cost = row[10] or ""

        # Parse comma-separated color ints
        colors_raw = [int(x) for x in row[6].split(",") if x.strip()] if row[6] else []
        ci_raw = [int(x) for x in row[7].split(",") if x.strip()] if row[7] else []
        colors = [COLOR_MAP.get(c, str(c)) for c in colors_raw]
        color_identity = [COLOR_MAP.get(c, str(c)) for c in ci_raw]

        # Convert Arena mana format: "o2oUoU" -> "{2}{U}{U}"
        if mana_cost:
            mana_cost = re.sub(r"o([A-Za-z0-9X]+)", r"{\1}", mana_cost)

        mapping[grp_id] = {
            "name": title,
            "manaCost": mana_cost,
            "type": type_text,
            "rarity": rarity,
            "colors": colors,
            "colorIdentity": color_identity,
            "text": "",
            "setCode": set_code,
        }

    conn.close()
    return mapping


def download_json(url: str) -> dict[str, Any]:
    """Download and parse JSON from URL."""
    print(f"Downloading from {url}...")
    req = Request(url, headers={
        "Accept-Encoding": "gzip",
        "User-Agent": "MTGA-Tracker/1.0",
    })
    with urlopen(req, timeout=300) as response:
        if response.info().get("Content-Encoding") == "gzip":
            data = gzip.decompress(response.read()).decode("utf-8")
        else:
            data = response.read().decode("utf-8")
        return json.loads(data)


def build_mapping_mtgjson() -> dict[int, dict[str, Any]]:
    """Build mapping from MTGJSON AllPrintings (fallback)."""
    print("Downloading AllPrintings data from MTGJSON...")
    all_data = download_json(MTGJSON_ALLPRINTINGS_URL)
    sets_data = all_data.get("data", {})
    mapping: dict[int, dict[str, Any]] = {}

    print(f"Processing {len(sets_data)} sets from MTGJSON...")
    for set_code, set_info in sets_data.items():
        for card in set_info.get("cards", []):
            arena_id = card.get("identifiers", {}).get("mtgArenaId")
            if not arena_id:
                continue
            try:
                arena_id = int(arena_id)
            except (ValueError, TypeError):
                continue
            if arena_id <= 0 or arena_id in mapping:
                continue

            mapping[arena_id] = {
                "name": card.get("name", "Unknown"),
                "manaCost": card.get("manaCost", ""),
                "type": card.get("type", ""),
                "rarity": card.get("rarity", "common"),
                "colors": card.get("colors", []),
                "colorIdentity": card.get("colorIdentity", []),
                "text": card.get("text", ""),
                "setCode": set_code,
            }

    return mapping


def build_mapping_scryfall(path: Path) -> dict[int, dict[str, Any]]:
    """Build mapping from Scryfall bulk JSON (supplemental)."""
    print(f"Reading Scryfall data from {path}...")
    with open(path, "r", encoding="utf-8") as f:
        cards = json.load(f)

    mapping: dict[int, dict[str, Any]] = {}
    for card in cards:
        if card.get("lang") != "en":
            continue
        arena_id = card.get("arena_id")
        if not arena_id or arena_id <= 0 or arena_id in mapping:
            continue

        mapping[arena_id] = {
            "name": card.get("name", "Unknown"),
            "manaCost": card.get("mana_cost", ""),
            "type": card.get("type_line", ""),
            "rarity": card.get("rarity", "common"),
            "colors": card.get("colors", []),
            "colorIdentity": card.get("color_identity", []),
            "text": card.get("oracle_text", ""),
            "setCode": (card.get("set") or "").upper(),
        }

    return mapping


def main():
    parser = argparse.ArgumentParser(description="Build Arena card mapping.")
    parser.add_argument("--arena-db", type=Path, default=None,
                        help="Path to Arena Raw_CardDatabase .mtga file")
    parser.add_argument("--mtgjson", action="store_true",
                        help="Download from MTGJSON (used as fallback if no Arena DB)")
    parser.add_argument("--scryfall", type=Path, default=None,
                        help="Path to Scryfall all_cards JSON (supplemental)")
    args = parser.parse_args()

    print("Building Arena card mapping...")
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # Primary: Arena's own database (most complete)
    arena_db = args.arena_db or find_arena_db()
    mapping: dict[int, dict[str, Any]] = {}

    if arena_db and arena_db.exists():
        mapping = build_mapping_arena_db(arena_db)
        print(f"  Arena DB: {len(mapping)} cards")
    elif args.mtgjson:
        mapping = build_mapping_mtgjson()
        print(f"  MTGJSON: {len(mapping)} cards")
    else:
        # Auto-detect: try Arena DB, fall back to MTGJSON
        print("  Arena DB not found, downloading from MTGJSON...")
        mapping = build_mapping_mtgjson()
        print(f"  MTGJSON: {len(mapping)} cards")

    # Merge Scryfall data (fills oracle text gaps)
    if args.scryfall and args.scryfall.exists():
        scryfall = build_mapping_scryfall(args.scryfall)
        new_count = 0
        text_count = 0
        for arena_id, card_info in scryfall.items():
            if arena_id not in mapping:
                mapping[arena_id] = card_info
                new_count += 1
            elif not mapping[arena_id]["text"] and card_info["text"]:
                mapping[arena_id]["text"] = card_info["text"]
                text_count += 1
        print(f"  Scryfall: {new_count} new cards, {text_count} text backfills")

    print(f"Writing {len(mapping)} cards to {OUTPUT_FILE}...")
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(mapping, f, ensure_ascii=False, indent=2)

    # Summary
    from collections import Counter
    sets = Counter(v["setCode"] for v in mapping.values())
    recent = ["FIN", "EOE", "SPM", "TLA", "TMT"]
    print(f"Recent sets: {', '.join(f'{s}={sets.get(s,0)}' for s in recent)}")
    print("Done!")


if __name__ == "__main__":
    main()

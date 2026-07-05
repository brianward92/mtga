#!/usr/bin/env python3
"""Fetch real, unmodified Scryfall card images for the paper's illustrative
"verdict panel" figures (§2 teaser, §4.2, §6, §7).

These figures show the deployed pick-scoring interface next to the actual
card it is scoring. Every card here is drawn from a development set (BRO or
SOS) that is public and legally inspectable -- never from MSH, which stays
untouched until the frozen evaluation (paper/sections/protocol.tex).

Usage:
    python3 figures/fetch_example_cards.py

Writes one JPEG per card under figures/cards/ (Scryfall's `image_uris.normal`,
488x680, full and unmodified) plus figures/cards/manifest.json recording the
exact source URL, set, artist, and copyright line for each -- so the
provenance backing the "no cropping / no distortion / no overlay on the
image itself" claim in sections/appendix.tex is auditable.

Only hits the public Scryfall API (https://scryfall.com/docs/api), using the
same User-Agent convention as mtga/scryfall.py. No local/private data.
"""

import json
import time
from pathlib import Path

import requests

HERE = Path(__file__).resolve().parent
OUT_DIR = HERE / "cards"

REQUEST_TIMEOUT = 30
SCRYFALL_HEADERS = {
    "Accept": "application/json",
    "User-Agent": "mtga/0.2 (brian.ward.92@gmail.com)",
}
# Scryfall asks for 50-100ms between requests; this script makes a handful.
REQUEST_DELAY_S = 0.15

# (slug, exact card name, set code) -- set code disambiguates cards that have
# been printed more than once. All four are dev-set cards (BRO or SOS),
# never MSH.
CARDS = [
    ("emeritus-of-ideation", "Emeritus of Ideation", "sos"),
    ("steel-seraph", "Steel Seraph", "bro"),
    ("sundering-archaic", "Sundering Archaic", "sos"),
    ("flow-state", "Flow State", "sos"),
]


def fetch_card(name, set_code):
    resp = requests.get(
        "https://api.scryfall.com/cards/named",
        params={"exact": name, "set": set_code},
        headers=SCRYFALL_HEADERS,
        timeout=REQUEST_TIMEOUT,
    )
    resp.raise_for_status()
    return resp.json()


def download_image(url, dest):
    resp = requests.get(url, headers=SCRYFALL_HEADERS, timeout=REQUEST_TIMEOUT)
    resp.raise_for_status()
    dest.write_bytes(resp.content)


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    manifest = {}
    for slug, name, set_code in CARDS:
        print(f"Fetching {name} ({set_code.upper()}) from Scryfall.")
        card = fetch_card(name, set_code)
        image_url = card["image_uris"]["normal"]
        dest = OUT_DIR / f"{slug}.jpg"
        download_image(image_url, dest)
        manifest[slug] = {
            "name": card["name"],
            "set": card["set"].upper(),
            "set_name": card["set_name"],
            "collector_number": card["collector_number"],
            "rarity": card["rarity"],
            "artist": card["artist"],
            "scryfall_uri": card["scryfall_uri"],
            "image_source": image_url,
            "copyright": f"© Wizards of the Coast LLC. Art by {card['artist']}.",
        }
        print(f"  wrote {dest} ({dest.stat().st_size} bytes)")
        time.sleep(REQUEST_DELAY_S)

    manifest_path = OUT_DIR / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"wrote {manifest_path}")


if __name__ == "__main__":
    main()

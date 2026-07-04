#!/usr/bin/env python
"""Build the canonical grpId card table from 17Lands cards.csv + Scryfall parquet."""

from mtga.lands import cardstore


if __name__ == "__main__":
    cardstore.build_card_store()

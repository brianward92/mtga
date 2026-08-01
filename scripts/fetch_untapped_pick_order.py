#!/usr/bin/env python
"""Snapshot Untapped.gg's public Limited pick-order page as normalized JSON.

The page is server rendered and includes both its visible tier order and the
underlying public aggregate counts in ``__NEXT_DATA__``.  This importer makes
one request, keeps source/update metadata, and writes derived per-card records;
it does not retain the site's HTML or presentation assets.

Usage:
    python scripts/fetch_untapped_pick_order.py \
        --set ECL --slug lorwyn-eclipsed --out data/external/untapped/ECL.json
"""

from __future__ import annotations

import argparse
import datetime as dt
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import urllib.request


BASE_URL = "https://mtga.untapped.gg/limited/draft"
RANK_CODES = ("b", "s", "g", "p")


class NextDataParser(HTMLParser):
    """Extract the structured ``__NEXT_DATA__`` script from one page."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._active = False
        self.parts: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag == "script" and dict(attrs).get("id") == "__NEXT_DATA__":
            self._active = True

    def handle_endtag(self, tag):
        if tag == "script" and self._active:
            self._active = False

    def handle_data(self, data):
        if self._active:
            self.parts.append(data)


class VisibleTierParser(HTMLParser):
    """Read the visible Tier S..F card order from the rendered HTML."""

    _CARD_LINK = re.compile(r"[?&]includingCards=(\d+)(?:&|$)")
    _TIERS = {"S", "A+", "A", "A-", "B+", "B", "B-", "C+", "C",
              "C-", "D+", "D", "D-", "F", "?"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._expect_tier = False
        self._collect_tier_suffix = False
        self._tier: str | None = None
        self.cards: list[tuple[int, str]] = []
        self._seen: set[int] = set()

    def handle_starttag(self, tag, attrs):
        if tag != "a" or self._tier is None:
            return
        href = dict(attrs).get("href", "")
        match = self._CARD_LINK.search(href)
        if not match:
            return
        title_id = int(match.group(1))
        if title_id not in self._seen:
            self._seen.add(title_id)
            self.cards.append((title_id, self._tier))

    def handle_data(self, data):
        text = data.strip()
        if text == "Tier":
            self._expect_tier = True
            self._collect_tier_suffix = False
            return
        if self._expect_tier and text:
            self._expect_tier = False
            if text in self._TIERS:
                self._tier = text
                self._collect_tier_suffix = text in {"A", "B", "C", "D"}
            return
        if self._collect_tier_suffix and text in {"+", "-"} and self._tier:
            self._tier += text
            self._collect_tier_suffix = False


def parse_page(html: str) -> tuple[dict, list[tuple[int, str]]]:
    next_parser = NextDataParser()
    next_parser.feed(html)
    if not next_parser.parts:
        raise ValueError("Untapped page has no __NEXT_DATA__ payload")

    tier_parser = VisibleTierParser()
    tier_parser.feed(html)
    if not tier_parser.cards:
        raise ValueError("Untapped page has no visible pick-order cards")
    return json.loads("".join(next_parser.parts)), tier_parser.cards


def _block_value(blocks, block_index: int, value_index: int) -> int:
    try:
        value = blocks[block_index][value_index]
        return int(value) if value is not None else 0
    except (IndexError, TypeError, ValueError):
        return 0


def aggregate_card_stats(raw: dict | None) -> dict:
    """Aggregate Untapped's compact bronze-through-platinum count blocks."""
    ranks = (raw or {}).get("ALL", {})
    available_games = available_wins = 0
    opening_games = opening_wins = 0
    games = 0
    for rank in RANK_CODES:
        blocks = ranks.get(rank) or []
        games += _block_value(blocks, 0, 0)
        available_games += _block_value(blocks, 1, 0)
        available_wins += _block_value(blocks, 1, 1)
        opening_games += _block_value(blocks, 2, 0)
        opening_wins += _block_value(blocks, 2, 1)
    return {
        "games": games,
        "in_hand_games": available_games,
        "in_hand_wins": available_wins,
        "in_hand_win_rate": (
            available_wins / available_games if available_games else None
        ),
        "opening_hand_games": opening_games,
        "opening_hand_wins": opening_wins,
        "opening_hand_win_rate": (
            opening_wins / opening_games if opening_games else None
        ),
    }


def weighted_offer_metric(row: dict | None, key: str) -> float | None:
    row = row or {}
    quantities = row.get("offered_qty") or {}
    values = row.get(key) or {}
    total = weighted = 0.0
    for rank in ("bronze", "silver", "gold", "platinum"):
        quantity = quantities.get(rank)
        value = values.get(rank)
        if not isinstance(quantity, (int, float)) or quantity <= 0:
            continue
        if not isinstance(value, (int, float)):
            continue
        total += quantity
        weighted += quantity * value
    return weighted / total if total else None


def iso_from_millis(value) -> str | None:
    if not isinstance(value, (int, float)):
        return None
    return dt.datetime.fromtimestamp(value / 1000, dt.timezone.utc).isoformat()


def normalize_snapshot(html: str, url: str, fetched_at: str | None = None) -> dict:
    page, visible = parse_page(html)
    props = page["props"]["pageProps"]
    ssr = props["ssrProps"]

    compact = ssr["minifiedMtgaJsonData"]
    locale = {int(key): value for key, value in compact["localeData"]}
    cards_by_title = {
        int(row[1]): {"grp_id": int(row[0]), "name": locale.get(int(row[1]))}
        for row in compact["cardData"]
        if len(row) > 1
    }

    stats_response = ssr["limitedCardStatsResp"]
    stats = stats_response["data"]["data"]
    draft_response = ssr["limitedDraftInfo"]
    draft_rows = {
        int(row["title_id"]): row for row in draft_response["data"]
    }

    normalized = []
    for order, (title_id, tier) in enumerate(visible, start=1):
        identity = cards_by_title.get(title_id)
        if not identity or not identity["name"]:
            continue
        offer = draft_rows.get(title_id)
        normalized.append({
            "order": order,
            "tier": tier,
            "title_id": title_id,
            **identity,
            **aggregate_card_stats(stats.get(str(title_id))),
            "avg_pick_chosen": weighted_offer_metric(offer, "avg_pick_chosen"),
            "avg_last_offered": weighted_offer_metric(
                offer, "avg_last_pick_offered"
            ),
        })

    return {
        "schema_version": 1,
        "source": "Untapped.gg public Limited Draft Pick Order",
        "source_url": url,
        "fetched_at": fetched_at or dt.datetime.now(dt.timezone.utc).isoformat(),
        "stats_updated_at": iso_from_millis(stats_response.get("lastModified")),
        "draft_info_updated_at": iso_from_millis(draft_response.get("lastModified")),
        "set": props["clientProps"]["setCode"],
        "format": "PremierDraft",
        "rank_range": ["bronze", "platinum"],
        "cards": normalized,
    }


def create_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--set", required=True, dest="set_code")
    parser.add_argument("--slug", required=True)
    parser.add_argument("--out", required=True, type=Path)
    return parser


def main(argv=None) -> None:
    args = create_parser().parse_args(argv)
    url = f"{BASE_URL}/{args.slug}/pick-order"
    request = urllib.request.Request(
        url, headers={"User-Agent": "mtga-research/0.1 (one-shot public snapshot)"}
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        html = response.read().decode("utf-8")
    payload = normalize_snapshot(html, url)
    if payload["set"].upper() != args.set_code.upper():
        raise ValueError(
            f"requested {args.set_code}, page payload is {payload['set']}"
        )
    args.out.parent.mkdir(parents=True, exist_ok=True)
    tmp = args.out.with_suffix(args.out.suffix + ".part")
    tmp.write_text(json.dumps(payload, indent=2) + "\n")
    tmp.replace(args.out)
    print(f"{payload['set']}: {len(payload['cards'])} cards -> {args.out}")


if __name__ == "__main__":
    main()

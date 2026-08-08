import datetime
from functools import lru_cache
import gzip
import json

import requests

BULK_DATA_URL = "https://api.scryfall.com/bulk-data"
REQUEST_TIMEOUT = 30
SCRYFALL_HEADERS = {
    "Accept": "application/json",
    "User-Agent": "mtga/0.2 (brian.ward.92@gmail.com)",
}

_BULK_DATA = None


def get_bulk_data_urls(refresh=False):
    global _BULK_DATA
    if refresh or (_BULK_DATA is None):
        print(f"Fetching bulk data info from {BULK_DATA_URL}.")
        response = requests.get(
            BULK_DATA_URL, headers=SCRYFALL_HEADERS, timeout=REQUEST_TIMEOUT
        )
        response.raise_for_status()
        _BULK_DATA = response.json()
    return _BULK_DATA


_DOWNLOAD_URLS = dict()


def get_download_url(data_type, refresh=False):
    global _DOWNLOAD_URLS
    if refresh or (data_type not in _DOWNLOAD_URLS):
        bulk_data = get_bulk_data_urls(refresh=refresh)
        download_url = None
        for item in bulk_data["data"]:
            if item["type"] == data_type:
                if download_url is not None:
                    raise ValueError(f"Multiple `{data_type}` entries!")
                # 2026-07-29 Scryfall API change: bulk objects dropped
                # `download_uri` (single JSON array) in favor of
                # `jsonl_download_uri` (gzipped JSONL). Accept either.
                download_url = item.get("download_uri") \
                    or item.get("jsonl_download_uri")
                if download_url is None:
                    raise ValueError(
                        f"`{data_type}` entry has no download uri "
                        f"(keys: {sorted(item)})")
        if download_url is None:
            raise ValueError(f"No `{data_type}` entries!")
        _DOWNLOAD_URLS[data_type] = download_url
    print(f"`{data_type}` available at {_DOWNLOAD_URLS[data_type]}.")
    return _DOWNLOAD_URLS[data_type]


def get_latest_all_cards_data():
    download_url = get_download_url("all_cards")
    data_response = requests.get(
        download_url, headers=SCRYFALL_HEADERS, timeout=REQUEST_TIMEOUT
    )
    data_response.raise_for_status()
    content = data_response.content
    if content[:2] == b"\x1f\x8b":  # gzip magic (jsonl.gz bulk files)
        content = gzip.decompress(content)
    return content


def parse_cards_payload(data):
    """Parse an all_cards payload: legacy JSON array or JSONL (one card
    object per line, the format Scryfall bulk data switched to 2026-07-29).
    Returns a list of card dicts."""
    text = data.decode("utf-8")
    head = text.lstrip()[:1]
    if head == "[":
        return json.loads(text)
    return [json.loads(line) for line in text.splitlines() if line.strip()]

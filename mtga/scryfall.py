import datetime
from functools import lru_cache
import json

import requests

BULK_DATA_URL = "https://api.scryfall.com/bulk-data"

_BULK_DATA = None


def get_bulk_data_urls(refresh=False):
    global _BULK_DATA
    if refresh or (_BULK_DATA is None):
        print(f"Fetching bulk data info from {BULK_DATA_URL}.")
        response = requests.get(BULK_DATA_URL)
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
                download_url = item["download_uri"]
        if download_url is None:
            raise ValueError(f"No `{data_type}` entries!")
        _DOWNLOAD_URLS[data_type] = download_url
    print(f"`{data_type}` available at {_DOWNLOAD_URLS[data_type]}.")
    return _DOWNLOAD_URLS[data_type]


def get_latest_all_cards_data():
    download_url = get_download_url("all_cards")
    data_response = requests.get(
        download_url, headers={"User-Agent": "mtga/0.2 (brian.ward.92@gmail.com)"}
    )
    data_response.raise_for_status()
    return data_response.content

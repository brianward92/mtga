"""Filesystem layout for 17Lands data, derived metrics, and model artifacts.

Everything lives under the same data root as the Scryfall pipeline
(/opt/$USER/dat/mtga). Raw files keep 17Lands' own naming so anything written
against mtga/base.py conventions still resolves.
"""

import os
from pathlib import Path

DATA_ROOT = Path(
    os.environ.get("MTGA_DATA_ROOT", f"/opt/{os.environ.get('USER', 'unknown')}/dat/mtga")
)

LANDS_DIR = DATA_ROOT / "17lands"
RAW_DIR = LANDS_DIR / "raw"
CARDS_DIR = LANDS_DIR / "cards"
CARD_RATINGS_DIR = LANDS_DIR / "card_ratings"
COLOR_RATINGS_DIR = LANDS_DIR / "color_ratings"
CURATED_DIR = LANDS_DIR / "curated"
METRICS_DIR = LANDS_DIR / "metrics"
MODELS_DIR = DATA_ROOT / "models"

SCRYFALL_PROCESSED_DIR = DATA_ROOT / "processed"
SCRYFALL_CARDS_PARQUET = SCRYFALL_PROCESSED_DIR / "cards.parquet"
SCRYFALL_SETS_PARQUET = SCRYFALL_PROCESSED_DIR / "sets.parquet"
SCRYFALL_FACES_PARQUET = SCRYFALL_PROCESSED_DIR / "card_faces.parquet"

# DraftFM cross-set card feature store (mtga/foundation/featurize.py).
FEATURES_DIR = LANDS_DIR / "features"
FEATURIZER_MANIFEST = FEATURES_DIR / "featurizer_manifest.json"
CARDFEATS_PARQUET = FEATURES_DIR / "cardfeats_v1.parquet"
TEXT_EMB_CACHE = FEATURES_DIR / "text_emb" / "bge-small-en-v1.5.npz"

CARD_STORE_PARQUET = CARDS_DIR / "card_store.parquet"
CARDS_CSV = CARDS_DIR / "cards.csv"
ABILITIES_CSV = CARDS_DIR / "abilities.csv"


def raw_dataset_path(data_type, set_code, limited_type):
    """Path of a raw 17Lands dump, e.g. raw/draft_data_public.SOS.PremierDraft.csv.gz"""
    name = f"{data_type}_data_public.{set_code}.{limited_type}.csv.gz"
    return RAW_DIR / name


def meta_path(path):
    """Sidecar json recording etag/size/mtime for any downloaded or derived file."""
    return Path(f"{path}.meta.json")


def curated_path(data_type, set_code, limited_type):
    return CURATED_DIR / data_type / f"{set_code}.{limited_type}.parquet"


def vocab_path(set_code, limited_type):
    """Ordered card-name vocabulary sidecar for a curated draft file."""
    return CURATED_DIR / "draft" / f"{set_code}.{limited_type}.vocab.json"


def card_ratings_path(set_code, limited_type, date_str):
    return CARD_RATINGS_DIR / set_code / limited_type / f"{date_str}.json"


def color_ratings_path(set_code, limited_type, date_str):
    return COLOR_RATINGS_DIR / set_code / limited_type / f"{date_str}.json"


def latest_symlink(dated_path, prefix=""):
    return dated_path.parent / f"{prefix}latest{dated_path.suffix}"


def metrics_cards_path(set_code, limited_type, date_str):
    return METRICS_DIR / set_code / limited_type / f"cards_{date_str}.parquet"


def metrics_colors_path(set_code, limited_type, date_str):
    return METRICS_DIR / set_code / limited_type / f"colors_{date_str}.parquet"


def model_dir(set_code, limited_type, version):
    return MODELS_DIR / set_code / limited_type / version


def set_assets_path(set_code):
    """Per-set DraftFM serving assets (built by scripts/build_set_assets.py)."""
    return DATA_ROOT / "foundation" / "set_assets" / f"{set_code}.npz"


def repoint_latest(dated_path, prefix=""):
    """Atomically repoint the sibling `latest` symlink at a dated file."""
    link = latest_symlink(dated_path, prefix)
    tmp = link.parent / f".{link.name}.tmp"
    if tmp.is_symlink() or tmp.exists():
        tmp.unlink()
    tmp.symlink_to(dated_path.name)
    tmp.replace(link)
    return link

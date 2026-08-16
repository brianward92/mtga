#!/usr/bin/env python
"""Build the offline per-set bundle the Electron app ships.

Single external input: a dated raw Scryfall bulk snapshot (`default_cards`,
jsonl / jsonl.gz / json) at <data root>/scryfall/default_cards-<YYYY-MM-DD>
.jsonl.gz (newest wins; --scryfall PATH overrides; --fetch downloads the
current one through mtga.scryfall's bulk-data API and names it after the
listing's `updated_at`). Scryfall's `arena_id` supplies Arena grpIds; the
frozen featurizer manifest travels with the model in the repo
(electron/resources/draftfm/model/<tag>/featurizer_manifest.json); text
embeddings come from the data-root cache (extended in-process when
sentence-transformers is importable, else a hard failure pointing at
scripts/setup_embed.sh — --allow-missing-text zero-fills instead).

Per set, under electron/resources/draftfm/sets/<SET>/:

  assets.npz   features fp16 [N, 775] through the frozen manifest, rarity_ids,
               names, grp_ids (JSON name -> [grpIds]), manifest_hash,
               picks_per_pack, set, text_missing, built_at
  cards.json   {"set", "scryfall_updated_at", "built_at",
                "cards": {name: {rarity, colors, colorIdentity, manaCost,
                                   manaValue, type}}}
               — one entry per NAME (grpId -> name lives in assets.npz)
  index.json   {"model_id", "model_manifest_hash", "scryfall_updated_at",
                "built_at", "sets": {SET: {picks_per_pack, manifest_hash,
                cards, grp_ids, text_missing, built_at}}}, merged over
               any existing index so sets can be built one at a time.

Universe per set: names = the curated draft vocab when it exists (training
sets; already includes bonus sheets), else the non-basic English names among
the set's Scryfall booster or Arena-game printings. grpIds per name = every
Scryfall printing with an arena_id whose oracle name matches (in-set first,
then other sets). No ratings, art, processed card store, or hand-maintained
Arena-id overlay enters this path.

  build_app_bundle.py --set DSK
  build_app_bundle.py --all --fetch
  build_app_bundle.py --set MSH --scryfall /tmp/default_cards-2026-08-15.jsonl.gz
"""

import argparse
import datetime
import json
import os
import re
import sys
from pathlib import Path

import numpy as np
import pandas as pd

from mtga import scryfall
from mtga.foundation import featurize, textemb
from mtga.lands import corpus, names as names_mod, paths

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT = REPO_ROOT / "electron" / "resources" / "draftfm" / "sets"
MODEL_ROOT = REPO_ROOT / "electron" / "resources" / "draftfm" / "model"
BULK_TYPE = "default_cards"
ALL_EXTRA_SETS = ("HOB",)
SNAPSHOT_RE = re.compile(
    r"^default_cards-(\d{4}-\d{2}-\d{2})\.(jsonl\.gz|jsonl|json\.gz|json)$"
)
COLOR_ORDER = "WUBRG"
# Printings that are never a pack card, even when Scryfall gives them an id.
SKIP_LAYOUTS = frozenset({"token", "double_faced_token", "emblem", "art_series"})
EMBED_SETUP = REPO_ROOT / "scripts" / "setup_embed.sh"
EMBED_PYTHON = REPO_ROOT / ".venv-embed" / "bin" / "python"

# Scryfall can briefly advertise Arena availability before publishing
# arena_id. Keep the unresolved-id decision in one place until product policy
# is settled: "report" builds the otherwise useful set assets and reports
# every missing name; "fail" rejects that set while the outer build continues.
MISSING_GRP_IDS_POLICY = "report"
PUBLIC_SET_KEYS = (
    "picks_per_pack",
    "manifest_hash",
    "cards",
    "grp_ids",
    "text_missing",
    "built_at",
)


class BundleError(RuntimeError):
    """A per-set or setup failure with a message meant for the terminal."""


# ---------------------------------------------------------------------------
# CLI


def create_parser():
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--set",
        action="append",
        dest="sets",
        default=[],
        metavar="SET",
        help="set code (repeatable)",
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="every set with a curated draft vocab, plus HOB (and any --set)",
    )
    parser.add_argument(
        "--scryfall",
        default=None,
        metavar="PATH",
        help="dated raw Scryfall default_cards snapshot (jsonl, jsonl.gz, "
        "json or json.gz); "
        "default: newest <data root>/scryfall/default_cards-YYYY-MM-DD.jsonl.gz",
    )
    parser.add_argument(
        "--min-date",
        default=None,
        metavar="YYYY-MM-DD",
        help="refuse a snapshot older than this date",
    )
    parser.add_argument(
        "--fetch",
        action="store_true",
        help="resolve and download the current default_cards bulk listing",
    )
    parser.add_argument(
        "--out", default=str(DEFAULT_OUT), help=f"bundle root (default: {DEFAULT_OUT})"
    )
    parser.add_argument(
        "--data-root",
        default=None,
        help="override MTGA_DATA_ROOT (must be set before mtga imports; the "
        "script re-execs itself)",
    )
    parser.add_argument(
        "--allow-missing-text",
        action="store_true",
        help="zero-fill text embeddings missing from the cache instead of "
        "failing (recorded in the npz's text_missing)",
    )
    parser.add_argument(
        "--model-tag",
        default=None,
        help="model dir under electron/resources/draftfm/model "
        "(default: newest tag with a meta.json)",
    )
    return parser


# ---------------------------------------------------------------------------
# Scryfall snapshot on disk / fetch


def scryfall_dir():
    return paths.DATA_ROOT / "scryfall"


def snapshot_date(path):
    """'YYYY-MM-DD' from the snapshot file name (None when unnamed)."""
    match = SNAPSHOT_RE.match(Path(path).name)
    return match.group(1) if match else None


def _date(value, label):
    """Validate and normalize a CLI/file ISO date."""
    try:
        return datetime.date.fromisoformat(str(value)).isoformat()
    except ValueError as err:
        raise BundleError(f"{label} must be YYYY-MM-DD, got {value!r}") from err


def validate_snapshot_path(path):
    """Require the dated default_cards filename that freezes provenance."""
    path = Path(path)
    if not path.is_file():
        raise BundleError(f"Scryfall snapshot {path} does not exist or is not a file")
    date = snapshot_date(path)
    if date is None:
        raise BundleError(
            f"Scryfall snapshot {path} is not a dated raw default_cards file; "
            "expected default_cards-YYYY-MM-DD.jsonl.gz (also accepts "
            ".jsonl, .json, or .json.gz)"
        )
    _date(date, f"snapshot filename {path.name}")
    return date


def snapshot_updated_at(path):
    """Precise `updated_at` from the download sidecar, else the file date."""
    path = Path(path)
    file_date = validate_snapshot_path(path)
    meta = scryfall.bulk_meta_path(path)
    if meta.exists():
        try:
            payload = json.loads(meta.read_text())
            if payload.get("type") not in (None, BULK_TYPE):
                raise BundleError(
                    f"{meta} describes {payload.get('type')!r}, not {BULK_TYPE!r}"
                )
            stamp = payload.get("updated_at")
            if stamp:
                try:
                    updated_date = scryfall.bulk_item_date(
                        {"type": BULK_TYPE, "updated_at": stamp}
                    )
                except ValueError as err:
                    raise BundleError(f"invalid updated_at in {meta}: {err}") from err
                if updated_date != file_date:
                    raise BundleError(
                        f"{meta} updated_at date {updated_date} does not match "
                        f"snapshot filename date {file_date}"
                    )
                return str(stamp)
        except (json.JSONDecodeError, AttributeError, OSError) as err:
            raise BundleError(
                f"could not read Scryfall metadata {meta}: {err}"
            ) from err
    return file_date


def list_snapshots(directory=None):
    """[(date, path)] newest first for every dated snapshot in the dir."""
    directory = scryfall_dir() if directory is None else Path(directory)
    if not directory.is_dir():
        return []
    found = []
    for child in directory.iterdir():
        date = snapshot_date(child.name)
        if date and child.is_file():
            found.append((date, child))
    # Date is authoritative. The filename tiebreak makes selection stable when
    # a user keeps both legacy JSON and current JSONL for the same day.
    return sorted(found, key=lambda item: (item[0], item[1].name), reverse=True)


def _wanted_message(min_date):
    want = scryfall_dir() / "default_cards-YYYY-MM-DD.jsonl.gz"
    newer = f" dated {min_date} or newer" if min_date else ""
    return (
        f"no usable Scryfall snapshot{newer}. Wanted: {want} (Scryfall bulk-data "
        f"type `{BULK_TYPE}`, listed at {scryfall.BULK_DATA_URL}; jsonl.gz, "
        f"jsonl or json). Re-run with --fetch to download the current one, or "
        f"pass --scryfall PATH."
    )


def ensure_snapshot(explicit=None, min_date=None, fetch=False):
    """Resolve the snapshot to build from: (path, updated_at)."""
    min_date = _date(min_date, "--min-date") if min_date else None
    if explicit:
        path = Path(explicit)
        date = validate_snapshot_path(path)
        if min_date and date < min_date:
            raise BundleError(
                f"--scryfall {path} is dated {date}, older than --min-date {min_date}"
            )
        return path, snapshot_updated_at(path)

    if fetch:
        item = scryfall.get_bulk_data_item(BULK_TYPE, refresh=True)
        date = scryfall.bulk_item_date(item)
        if min_date and date < min_date:
            raise BundleError(
                f"Scryfall's current `{BULK_TYPE}` bulk file is dated {date}, older "
                f"than --min-date {min_date}; try again later"
            )
        extension = scryfall.bulk_item_extension(item)
        dest = scryfall_dir() / f"default_cards-{date}{extension}"
        meta_path = scryfall.bulk_meta_path(dest)
        current = False
        if dest.is_file() and meta_path.is_file():
            try:
                meta = json.loads(meta_path.read_text())
                expected_size = item.get("size")
                size_matches = expected_size is None or dest.stat().st_size == int(
                    expected_size
                )
                current = (
                    meta.get("type") == BULK_TYPE
                    and meta.get("updated_at") == item.get("updated_at")
                    and size_matches
                )
            except (json.JSONDecodeError, OSError, TypeError, ValueError):
                current = False
        if not current:
            scryfall.download_bulk_data(BULK_TYPE, dest, item=item)
        return dest, str(item["updated_at"])

    for date, path in list_snapshots():
        if not min_date or date >= min_date:
            return path, snapshot_updated_at(path)
        break  # newest is too old; nothing older can help
    raise BundleError(_wanted_message(min_date))


# ---------------------------------------------------------------------------
# The loaded snapshot


def _join(values):
    return ",".join(values or [])


def _norm(name):
    return names_mod.norm(name or "")


def _front(name):
    return (name or "").split(" // ")[0]


def _back(name):
    parts = (name or "").split(" // ")
    return parts[1] if len(parts) > 1 else None


def _released_key(row):
    """Newest first, unknown last (mirrors featurize._released_sort_key)."""
    date = row.get("released_at") or ""
    return "".join(chr(255 - ord(c)) for c in date) if date else "￿"


class Snapshot:
    """A raw default_cards snapshot indexed for name -> printings lookups."""

    def __init__(self, path, updated_at=None):
        self.path = Path(path)
        file_date = validate_snapshot_path(self.path)
        self.updated_at = updated_at or snapshot_updated_at(path)
        try:
            updated_date = scryfall.bulk_item_date(
                {"type": BULK_TYPE, "updated_at": self.updated_at}
            )
        except ValueError as err:
            raise BundleError(
                f"invalid snapshot updated_at {self.updated_at!r}"
            ) from err
        if updated_date != file_date:
            raise BundleError(
                f"snapshot updated_at date {updated_date} does not match "
                f"filename date {file_date}"
            )
        self.rows = []
        self.by_full, self.by_front, self.by_back = {}, {}, {}
        self.by_set = {}
        for record_number, card in enumerate(
            scryfall.iter_bulk_cards(self.path), start=1
        ):
            if not isinstance(card, dict):
                raise BundleError(
                    f"{self.path}: Scryfall record {record_number} is not an object"
                )
            if not card.get("name") or not card.get("set"):
                raise BundleError(
                    f"{self.path}: Scryfall record {record_number} lacks name or set"
                )
            if card.get("layout") in SKIP_LAYOUTS:
                continue
            i = len(self.rows)
            self.rows.append(card)
            name = card.get("name") or ""
            full = _norm(name)
            self.by_full.setdefault(full, []).append(i)
            front = _norm(_front(name))
            if front != full:
                self.by_front.setdefault(front, []).append(i)
            back = _back(name)
            if back is not None:
                self.by_back.setdefault(_norm(back), []).append(i)
            self.by_set.setdefault((card.get("set") or "").upper(), []).append(i)
        self._frames = None

    # -- name matching --------------------------------------------------

    def matches(self, name):
        """(row indices, match kind) for a 17Lands/Scryfall name: full name
        first, then front face, then back face (featurize.resolve_names)."""
        key = names_mod.norm_17lands(name)
        for kind, index in (
            ("full", self.by_full),
            ("front", self.by_front),
            ("back", self.by_back),
        ):
            hits = index.get(key)
            if hits:
                return hits, kind
        return [], None

    def arena_ids(self, name, set_code):
        """Every arena_id whose oracle name matches: in-set printings first,
        then the set's bonus sheets, then other sets newest-first."""
        hits, _ = self.matches(name)
        rank = _set_rank(set_code)
        ranked = sorted(
            (self.rows[i] for i in hits if self.rows[i].get("arena_id")),
            key=lambda r: (rank(r), _released_key(r), str(r.get("id"))),
        )
        ids = []
        for row in ranked:
            grp = int(row["arena_id"])
            if grp not in ids:
                ids.append(grp)
        return ids

    def display_row(self, name, set_code):
        """The printing cards.json describes: in-set, else the set's bonus
        sheet, else newest paper, else newest digital."""
        hits, _ = self.matches(name)
        rank = _set_rank(set_code)
        english = [self.rows[i] for i in hits if self.rows[i].get("lang") == "en"]
        candidates = english or [self.rows[i] for i in hits]
        if not candidates:
            return None
        return min(
            candidates,
            key=lambda r: (
                rank(r),
                1 if r.get("digital") else 0,
                _released_key(r),
                str(r.get("id")),
            ),
        )

    def set_universe(self, set_code):
        """Scryfall's draft universe: non-basic English booster/Arena cards.

        `arena_id` can lag the `games: ["arena"]` flag, notably for preview
        season sets, so id availability must not define the name universe.
        """
        rows = [
            self.rows[i]
            for i in self.by_set.get(set_code.upper(), [])
            if self.rows[i].get("lang") == "en"
            and (
                self.rows[i].get("booster")
                or "arena" in (self.rows[i].get("games") or [])
                or self.rows[i].get("arena_id")
            )
            and not _is_basic_land(self.rows[i])
        ]
        rows.sort(key=lambda r: (_collector_key(r.get("collector_number")), r["name"]))
        names = []
        for row in rows:
            if row["name"] not in names:
                names.append(row["name"])
        return names

    # -- featurizer frames ------------------------------------------------

    def frames(self):
        """(cards, faces) DataFrames in the processed-parquet schema the
        frozen featurizer joins against (English rows only, as the training
        parquet was)."""
        if self._frames is None:
            cards, faces = [], []
            for card in self.rows:
                if card.get("lang") != "en":
                    continue
                cards.append(
                    {
                        "id": card.get("id"),
                        "name": card.get("name"),
                        "set": card.get("set"),
                        "rarity": card.get("rarity"),
                        "type_line": card.get("type_line"),
                        "mana_cost": card.get("mana_cost"),
                        "cmc": card.get("cmc"),
                        "colors": _join(card.get("colors")),
                        "color_identity": _join(card.get("color_identity")),
                        "oracle_text": card.get("oracle_text"),
                        "power": card.get("power"),
                        "toughness": card.get("toughness"),
                        "loyalty": card.get("loyalty"),
                        "keywords": _join(card.get("keywords")),
                        "layout": card.get("layout"),
                        "digital": bool(card.get("digital")),
                        "released_at": card.get("released_at"),
                    }
                )
                for index, face in enumerate(card.get("card_faces") or []):
                    faces.append(
                        {
                            "card_id": card.get("id"),
                            "face_index": index,
                            "name": face.get("name"),
                            "mana_cost": face.get("mana_cost"),
                            "type_line": face.get("type_line"),
                            "oracle_text": face.get("oracle_text"),
                            "colors": _join(face.get("colors")),
                            "power": face.get("power"),
                            "toughness": face.get("toughness"),
                            "loyalty": face.get("loyalty"),
                        }
                    )
            self._frames = (pd.DataFrame(cards), pd.DataFrame(faces))
        return self._frames

    def frames_for(self, names):
        """The (cards, faces) rows that can match any of `names`, so the
        featurizer never scans the whole snapshot per set."""
        cards, faces = self.frames()
        ids = set()
        for name in names:
            hits, _ = self.matches(name)
            ids.update(self.rows[i].get("id") for i in hits)
        sub = cards[cards["id"].isin(ids)]
        sub_faces = faces[faces["card_id"].isin(ids)] if len(faces) else faces
        return sub, sub_faces


def _set_rank(set_code):
    """Row -> 0 in-set, 1 on one of the set's bonus sheets (corpus registry),
    2 anywhere else."""
    code = set_code.upper()
    bonus = set()
    if code in corpus.CORPUS:
        bonus = {b.upper() for b in corpus.CORPUS[code].bonus_sheets}

    def rank(row):
        row_set = (row.get("set") or "").upper()
        return 0 if row_set == code else 1 if row_set in bonus else 2

    return rank


def _collector_key(value):
    text = str(value or "")
    match = re.match(r"(\d+)", text)
    return (int(match.group(1)) if match else 10**9, text)


def _is_basic_land(row):
    front_type = (row.get("type_line") or "").split(" // ")[0]
    return front_type.startswith("Basic Land") or front_type.startswith(
        "Basic Snow Land"
    )


# ---------------------------------------------------------------------------
# Model dir + frozen manifest


def resolve_model_dir(tag=None, model_root=None):
    root = MODEL_ROOT if model_root is None else Path(model_root)
    if tag:
        model_dir = root / tag
        if not (model_dir / "meta.json").exists():
            raise BundleError(f"model dir {model_dir} has no meta.json")
        return model_dir
    tags = (
        sorted(p.name for p in root.iterdir() if (p / "meta.json").exists())
        if root.is_dir()
        else []
    )
    if not tags:
        raise BundleError(f"no model export with a meta.json under {root}")
    return root / tags[-1]


def load_model(model_dir):
    """(meta, manifest) with the manifest verified against meta.manifest_hash."""
    model_dir = Path(model_dir)
    meta = json.loads((model_dir / "meta.json").read_text())
    manifest_path = model_dir / "featurizer_manifest.json"
    if not manifest_path.exists():
        raise BundleError(
            f"{manifest_path} is missing: copy the frozen featurizer manifest "
            f"the model was trained with next to its meta.json"
        )
    manifest = featurize.load_manifest(manifest_path)
    recorded = manifest.get("content_hash")
    if featurize.content_hash(manifest) != recorded:
        raise BundleError(f"{manifest_path}: content_hash does not match its content")
    expected = meta.get("manifest_hash")
    if not expected:
        raise BundleError(f"{model_dir / 'meta.json'} has no manifest_hash")
    if expected != recorded:
        raise BundleError(
            f"{manifest_path} hash {recorded[:12]} != model meta manifest_hash "
            f"{str(expected)[:12]}"
        )
    return meta, manifest


# ---------------------------------------------------------------------------
# Universe: curated vocab / Scryfall


def curated_sets():
    codes = set()
    draft_dir = paths.CURATED_DIR / "draft"
    if draft_dir.is_dir():
        for vocab_file in draft_dir.glob("*.vocab.json"):
            codes.add(vocab_file.name.split(".")[0])
    return sorted(codes)


def vocab_names(set_code):
    """Ordered union of the set's curated vocab sidecars ([] when none)."""
    names = []
    draft_dir = paths.CURATED_DIR / "draft"
    for vocab_file in sorted(draft_dir.glob(f"{set_code}.*.vocab.json")):
        for name in json.loads(vocab_file.read_text())["names"]:
            if name not in names:
                names.append(name)
    return names


def vocab_membership():
    """{norm_17lands(name): [set codes]} over every curated vocab — the
    printing preference the training features were built with."""
    member = {}
    for code in curated_sets():
        try:
            set_names = vocab_names(code)
        except (BundleError, json.JSONDecodeError, OSError, KeyError, TypeError):
            # The requested set will report its own malformed vocab from
            # universe(); an unrelated bad sidecar must not stop other sets.
            continue
        for name in set_names:
            member.setdefault(names_mod.norm_17lands(name), []).append(code)
    return member


def _missing_grp_ids_message(set_code, missing):
    return (
        f"{set_code}: {len(missing)} name(s) have no Scryfall arena_id: "
        f"{json.dumps(missing, ensure_ascii=False)}"
    )


def _handle_missing_grp_ids(set_code, missing):
    """Apply the single, explicit policy for names Scryfall cannot identify."""
    if not missing or MISSING_GRP_IDS_POLICY == "report":
        return
    message = _missing_grp_ids_message(set_code, missing)
    if MISSING_GRP_IDS_POLICY == "fail":
        raise BundleError(message)
    raise BundleError(
        f"invalid MISSING_GRP_IDS_POLICY {MISSING_GRP_IDS_POLICY!r}; "
        f"expected 'report' or 'fail'. {message}"
    )


def universe(set_code, snapshot):
    """Ordered {name: [grpIds]} plus internal reporting metadata."""
    names = vocab_names(set_code)
    source = "vocab"
    if not names:
        source = "scryfall"
        names = snapshot.set_universe(set_code)
    if not names:
        raise BundleError(
            f"no card universe for {set_code}: no curated vocab, no Scryfall "
            "English booster or Arena-game printings"
        )

    unmatched = [name for name in names if not snapshot.matches(name)[0]]
    if unmatched:
        raise BundleError(
            f"{set_code}: {len(unmatched)} universe name(s) do not resolve in "
            f"the raw Scryfall snapshot: {json.dumps(unmatched, ensure_ascii=False)}"
        )

    grp_lists = {}
    for name in names:
        grp_lists[name] = snapshot.arena_ids(name, set_code)
    missing = [name for name, ids in grp_lists.items() if not ids]
    _handle_missing_grp_ids(set_code, missing)
    return grp_lists, {"source": source, "names_without_grp_ids": missing}


# ---------------------------------------------------------------------------
# Features + text


def feature_table(
    set_code,
    names,
    snapshot,
    manifest,
    allow_missing_text=False,
    run_hint="",
    membership=None,
):
    """(features fp16 [N, 775], rarity_ids u8 [N], text_missing names)."""
    membership = vocab_membership() if membership is None else membership
    prefer = {}
    for name in names:
        # Training built one feature row per name preferring any set whose
        # vocab carried it; the same preference here keeps served features
        # identical to the trained ones. Brand-new names prefer their set.
        prefer[name] = membership.get(names_mod.norm_17lands(name)) or [set_code]
    cards, faces = snapshot.frames_for(names)
    struct, _ = featurize.featurize(
        names, manifest, cards, faces, prefer_sets_by_name=prefer
    )

    norms = [names_mod.norm_17lands(n) for n in names]
    cache = textemb._read_cache(paths.TEXT_EMB_CACHE)
    missing = [n for n, key in zip(names, norms) if key not in cache]
    text_missing = []
    if missing:
        inputs = featurize.embed_inputs(
            missing, cards, faces, prefer_sets_by_name=prefer
        )
        texts = {
            name: textemb.normalize_oracle(
                spec["name"],
                spec["type_line"],
                spec["oracle_front"],
                spec["oracle_back"],
            )
            for name, spec in inputs.items()
        }
        try:
            text = textemb.embed_names(names, paths.TEXT_EMB_CACHE, texts_by_name=texts)
        except RuntimeError as err:
            if not allow_missing_text:
                listing = "\n  ".join(missing[:20]) + (
                    "\n  ..." if len(missing) > 20 else ""
                )
                raise BundleError(
                    f"{set_code}: {len(missing)} name(s) have no cached text "
                    f"embedding and sentence-transformers is not importable in "
                    f"this interpreter. Either:\n"
                    f"  bash {EMBED_SETUP}\n"
                    f"  {EMBED_PYTHON} {Path(__file__).resolve()} {run_hint}\n"
                    f"(embeds them and extends {paths.TEXT_EMB_CACHE}), or pass "
                    f"--allow-missing-text to zero-fill. Missing:\n  {listing}"
                ) from err
            text = np.zeros((len(names), textemb.EMBED_DIM), dtype=np.float32)
            for i, key in enumerate(norms):
                if key in cache:
                    text[i] = cache[key]
                else:
                    text_missing.append(names[i])
    else:
        text = np.stack([cache[key] for key in norms]).astype(np.float32)

    rarity_block = next(b for b in manifest["blocks"] if b["name"] == "rarity")
    r0, width = rarity_block["start"], len(rarity_block["columns"])
    rarity_ids = struct[:, r0 : r0 + width].argmax(axis=1).astype(np.uint8)
    features = np.concatenate([struct, text], axis=1).astype(np.float16)
    return features, rarity_ids, text_missing


def picks_per_pack_for(set_code):
    if set_code in corpus.CORPUS:
        return corpus.CORPUS[set_code].picks_per_pack
    draft_dir = paths.CURATED_DIR / "draft"
    for meta in sorted(draft_dir.glob(f"{set_code}.*.parquet.meta.json")):
        try:
            recorded = json.loads(meta.read_text()).get("picks_per_pack")
        except (json.JSONDecodeError, OSError):
            recorded = None
        if recorded:
            return int(recorded)
    return 14


# ---------------------------------------------------------------------------
# cards.json


def _colors(letters):
    have = {c for c in (letters or []) if c in COLOR_ORDER}
    return "".join(c for c in COLOR_ORDER if c in have)


def _mana_value(value):
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return int(number) if number == int(number) else number


def _rarity(row):
    if _is_basic_land(row):
        return "land"  # the app sorts basics after commons, as Arena does
    return (row.get("rarity") or "").lower()


def _front_is_land(row):
    front_type = (row.get("type_line") or "").split(" // ")[0]
    card_types = front_type.split("—", 1)[0].split()
    return "Land" in card_types


def card_entry(row):
    faces = row.get("card_faces") or []
    mana_cost = row.get("mana_cost")
    if not mana_cost and faces:
        mana_cost = faces[0].get("mana_cost") or ""
    return {
        "rarity": _rarity(row),
        # Arena's color sort uses the printed colors, not commander color
        # identity. Lands are deliberately colorless in this field.
        "colors": "" if _front_is_land(row) else _colors(row.get("colors")),
        "colorIdentity": _colors(row.get("color_identity")),
        "manaCost": mana_cost or "",
        "manaValue": _mana_value(row.get("cmc")),
        "type": row.get("type_line") or "",
    }


def build_cards(set_code, names, snapshot):
    cards = {}
    for name in names:
        row = snapshot.display_row(name, set_code)
        if row is None:
            raise BundleError(f"{set_code}: no Scryfall identity for {name!r}")
        cards[name] = card_entry(row)
    return cards


# ---------------------------------------------------------------------------
# Orchestration


def _write_json(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, path)


def _now():
    return datetime.datetime.now().isoformat(timespec="seconds")


def build_set(
    set_code,
    out_dir,
    snapshot,
    manifest,
    allow_missing_text=False,
    run_hint="",
    membership=None,
):
    """Write <out>/<SET>/{assets.npz,cards.json}; returns the index entry."""
    grp_lists, prov = universe(set_code, snapshot)
    names = list(grp_lists)
    missing_grp_ids = prov["names_without_grp_ids"]
    try:
        cards = build_cards(set_code, names, snapshot)
        features, rarity_ids, text_missing = feature_table(
            set_code,
            names,
            snapshot,
            manifest,
            allow_missing_text,
            run_hint,
            membership,
        )
    except Exception as err:
        if missing_grp_ids:
            raise BundleError(
                f"{err}\n{_missing_grp_ids_message(set_code, missing_grp_ids)}"
            ) from err
        raise
    built_at = _now()
    set_dir = Path(out_dir) / set_code
    set_dir.mkdir(parents=True, exist_ok=True)

    tmp = set_dir / "assets.npz.tmp.npz"
    np.savez(
        tmp,
        features=features,
        rarity_ids=rarity_ids,
        names=np.array(names),
        grp_ids=json.dumps(grp_lists),
        manifest_hash=manifest["content_hash"],
        picks_per_pack=picks_per_pack_for(set_code),
        set=set_code,
        text_missing=json.dumps(text_missing),
        built_at=built_at,
    )
    os.replace(tmp, set_dir / "assets.npz")

    _write_json(
        set_dir / "cards.json",
        {
            "set": set_code,
            "scryfall_updated_at": snapshot.updated_at,
            "built_at": built_at,
            "cards": cards,
        },
    )
    stale = set_dir / "ratings.json"
    if stale.exists():
        stale.unlink()

    return {
        "picks_per_pack": picks_per_pack_for(set_code),
        "manifest_hash": manifest["content_hash"],
        "cards": len(names),
        "grp_ids": sum(len(g) for g in grp_lists.values()),
        "text_missing": len(text_missing),
        "built_at": built_at,
        "names_source": prov["source"],
        "_names_without_grp_ids": missing_grp_ids,
    }


def selected_sets(explicit, include_all=False):
    """Normalize/dedupe CLI set codes; --all always includes HOB."""
    result = []
    for raw in explicit:
        code = str(raw).strip().upper()
        if code and code not in result:
            result.append(code)
    if include_all:
        for code in curated_sets() + list(ALL_EXTRA_SETS):
            if code not in result:
                result.append(code)
    return result


def update_index(out_dir, entries, meta, manifest, snapshot, requested=()):
    index_path = Path(out_dir) / "index.json"
    payload = {}
    if index_path.exists():
        try:
            payload = json.loads(index_path.read_text())
        except (json.JSONDecodeError, AttributeError):
            payload = {}
    manifest_hash = manifest["content_hash"]

    def public_entry(entry):
        if not isinstance(entry, dict) or any(
            key not in entry for key in PUBLIC_SET_KEYS
        ):
            return None
        return {key: entry[key] for key in PUBLIC_SET_KEYS}

    raw_existing = payload.get("sets", {}) if isinstance(payload, dict) else {}
    raw_existing = raw_existing if isinstance(raw_existing, dict) else {}
    compatible_index = (
        payload.get("model_manifest_hash") == manifest_hash
        and payload.get("scryfall_updated_at") == snapshot.updated_at
    )
    existing, stale = {}, []
    for code, entry in raw_existing.items():
        clean = public_entry(entry)
        if (
            not compatible_index
            or clean is None
            or clean["manifest_hash"] != manifest_hash
            or code in requested
        ):
            if code not in entries:
                stale.append(code)
            continue
        existing[code] = clean

    public = {}
    for code, entry in entries.items():
        clean = public_entry(entry)
        if clean is None:  # an internal programming error, never user data
            raise BundleError(f"{code}: builder produced an incomplete index entry")
        public[code] = clean
    existing.update(public)
    index = {
        "model_id": meta.get("model_id"),
        "model_manifest_hash": manifest_hash,
        "scryfall_updated_at": snapshot.updated_at,
        "built_at": _now(),
        "sets": {code: existing[code] for code in sorted(existing)},
    }
    _write_json(index_path, index)
    return index, sorted(stale)


def build(
    set_codes, out_dir, snapshot, model_dir, allow_missing_text=False, run_hint=""
):
    """Build every set (continuing past per-set failures).

    Returns (entries, failures, index, stale): entries/failures keyed by set,
    failures holding the message; the index reflects the sets that built.
    """
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    meta, manifest = load_model(model_dir)
    membership = vocab_membership()
    entries, failures = {}, {}
    for set_code in set_codes:
        # ratings.json is forbidden in the new bundle even when rebuilding
        # this particular set later fails for an unrelated reason.
        (out_dir / set_code / "ratings.json").unlink(missing_ok=True)
        try:
            entries[set_code] = build_set(
                set_code,
                out_dir,
                snapshot,
                manifest,
                allow_missing_text,
                run_hint,
                membership,
            )
        except Exception as err:
            failures[set_code] = str(err)
    if entries:
        index, stale = update_index(
            out_dir, entries, meta, manifest, snapshot, requested=set_codes
        )
    else:
        # Do not make a pre-existing index look freshly built when every
        # requested set failed. This value exists only for terminal reporting.
        index = {
            "model_id": meta.get("model_id"),
            "model_manifest_hash": manifest["content_hash"],
            "scryfall_updated_at": snapshot.updated_at,
            "built_at": _now(),
            "sets": {},
        }
        stale = []
    return entries, failures, index, stale


def _report(out_dir, entries, failures, index, stale, snapshot, model_dir):
    out_dir = Path(out_dir)
    print(f"bundle root: {out_dir}")
    print(
        f"model: {index.get('model_id')} ({Path(model_dir).name}), manifest "
        f"{str(index['model_manifest_hash'])[:12]}"
    )
    print(f"scryfall: {snapshot.path} (updated_at {snapshot.updated_at})")
    header = f"{'set':<5} {'names':>6} {'grpIds':>7} {'text_missing':>12} {'KB':>6}  names-from"
    print(header)
    for set_code in sorted(entries):
        entry = entries[set_code]
        size = sum(f.stat().st_size for f in (out_dir / set_code).iterdir()) / 1024
        print(
            f"{set_code:<5} {entry['cards']:>6} {entry['grp_ids']:>7} "
            f"{entry['text_missing']:>12} "
            f"{size:>6.0f}  {entry['names_source']}"
        )
        if entry["_names_without_grp_ids"]:
            missing = entry["_names_without_grp_ids"]
            print(
                f"      {len(missing)} name(s) with no Scryfall arena_id: "
                f"{json.dumps(missing, ensure_ascii=False)}"
            )
    for set_code in sorted(failures):
        print(f"FAILED {set_code}: {failures[set_code]}", file=sys.stderr)
    if stale:
        print(
            f"WARNING: index has sets built against another manifest: {stale} "
            f"(rebuild them)",
            file=sys.stderr,
        )


def main(argv=None):
    args = create_parser().parse_args(argv)
    if args.data_root and Path(args.data_root).resolve() != paths.DATA_ROOT.resolve():
        # paths freezes DATA_ROOT at import; re-exec with the env var set.
        env = dict(os.environ, MTGA_DATA_ROOT=args.data_root)
        cmd = [sys.executable, str(Path(__file__).resolve())] + list(
            sys.argv[1:] if argv is None else argv
        )
        os.execve(sys.executable, cmd, env)

    set_codes = selected_sets(args.sets, args.all)
    if not set_codes:
        print(
            "nothing to do: pass --set SET (repeatable) and/or --all", file=sys.stderr
        )
        return 2

    run_hint = " ".join(sys.argv[1:] if argv is None else argv)
    try:
        model_dir = resolve_model_dir(args.model_tag)
        snap_path, updated_at = ensure_snapshot(
            args.scryfall, args.min_date, args.fetch
        )
        print(f"loading Scryfall snapshot {snap_path} ...", flush=True)
        snapshot = Snapshot(snap_path, updated_at)
        entries, failures, index, stale = build(
            set_codes,
            args.out,
            snapshot,
            model_dir,
            args.allow_missing_text,
            run_hint,
        )
    except Exception as err:
        print(f"FAILED: {err}", file=sys.stderr)
        return 2
    _report(args.out, entries, failures, index, stale, snapshot, model_dir)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())

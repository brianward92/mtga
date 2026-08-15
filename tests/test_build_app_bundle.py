"""scripts/build_app_bundle.py: the offline per-set bundle the Electron app ships.

Reuses test_build_set_assets' synthetic universe (frozen manifest, text-emb
cache, card store, ratings cache) so assets.npz goes through the real
build_set_assets path and cards.json/ratings.json exercise the same joins
draft_api.DataHub uses.
"""

import importlib.util
import json
from pathlib import Path

import numpy as np
import pytest

import test_build_set_assets as tbsa
from _synth import ALIASES_A, CARD_A, CARD_B, FMT, GRP, SET
from mtga.foundation import textemb
from mtga.lands import paths

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"

spec = importlib.util.spec_from_file_location(
    "build_app_bundle", SCRIPTS / "build_app_bundle.py")
bab = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bab)


@pytest.fixture
def universe(card_store, ratings_cache, data_root):
    """Vocab sidecar + synthetic Scryfall/manifest/text cache for ALL_NAMES."""
    vocab_file = paths.vocab_path(SET, FMT)
    vocab_file.parent.mkdir(parents=True, exist_ok=True)
    vocab_file.write_text(json.dumps(
        {"set": SET, "format": FMT, "names": tbsa.VOCAB}))
    return tbsa._write_universe(tbsa.ALL_NAMES)


def _load(path):
    return json.loads(Path(path).read_text())


def test_bundle_writes_assets_cards_ratings_index(universe, tmp_path,
                                                  monkeypatch):
    # The bundle must never reach for sentence-transformers.
    def boom():
        raise AssertionError("encoder loaded")
    monkeypatch.setattr(textemb, "_load_encoder", boom)

    out = tmp_path / "sets"
    entries, index, stale = bab.build([SET], out)
    assert stale == []
    set_dir = out / SET

    # assets.npz is byte-identical to the data-root build_set_assets output.
    assert (set_dir / "assets.npz").read_bytes() == \
        paths.set_assets_path(SET).read_bytes()
    with np.load(set_dir / "assets.npz") as z:
        assert [str(n) for n in z["names"]] == tbsa.ALL_NAMES
        assert str(z["manifest_hash"]) == universe["content_hash"]

    # cards.json: one row per grpId, aliases included, store identity.
    cards = _load(set_dir / "cards.json")
    by_grp = {row["grpId"]: row for row in cards}
    assert sorted(by_grp) == sorted(set(ALIASES_A) | {102, 103, 104, 501, 502})
    assert [row["grpId"] for row in cards] == sorted(by_grp)  # stable order
    bolt = by_grp[GRP[CARD_A]]
    assert bolt == {
        "grpId": 101, "name": CARD_A, "rarity": "common", "colors": "R",
        "manaCost": "{1}", "manaValue": 1, "type": "Creature",
        "setCode": SET, "imageSmall": "https://img.test/101-small.jpg",
        "imageNormal": "https://img.test/101.jpg",
    }
    assert by_grp[301]["setCode"] == "OTH"      # out-of-set alias keeps its set
    assert by_grp[301]["name"] == CARD_A
    assert by_grp[GRP[CARD_B]]["rarity"] == "uncommon"
    assert by_grp[GRP[CARD_B]]["colors"] == "W"

    # ratings.json: name-keyed 17Lands stats per cached format + attribution.
    ratings = _load(set_dir / "ratings.json")
    assert ratings["attribution"] == "Data from 17Lands.com (CC BY 4.0)"
    assert ratings["keyed_by"] == "name"
    assert list(ratings["formats"]) == [FMT]
    bolt_stats = ratings["formats"][FMT][CARD_A]
    assert bolt_stats["gih_wr"] == pytest.approx(0.62)
    assert bolt_stats["oh_wr"] == pytest.approx(0.61)
    assert bolt_stats["gd_wr"] == pytest.approx(0.60)
    assert bolt_stats["games"] == 5000
    assert bolt_stats["alsa"] == 2.5 and bolt_stats["ata"] == 2.0
    assert "No Arena Id" in ratings["formats"][FMT]  # stats keyed by name

    # index.json
    assert index["model_manifest_hash"] == universe["content_hash"]
    entry = index["sets"][SET]
    assert entry["picks_per_pack"] == 14
    assert entry["manifest_hash"] == universe["content_hash"]
    assert entry["cards"] == len(tbsa.ALL_NAMES)
    assert entry["grp_ids"] == len(cards)
    assert entry["formats_with_ratings"] == [FMT]
    assert entries[SET] == entry
    assert _load(out / "index.json") == index

    # Compact JSON: no pretty-print whitespace.
    assert "\n" not in (set_dir / "cards.json").read_text()


def test_bundle_is_idempotent_and_merges_index(universe, tmp_path):
    out = tmp_path / "sets"
    bab.build([SET], out)
    first_cards = (out / SET / "cards.json").read_bytes()
    first_index = _load(out / "index.json")

    # A second run over the same set rewrites identical content and keeps
    # entries for sets it wasn't asked to touch.
    index_path = out / "index.json"
    other = {"picks_per_pack": 15, "manifest_hash": universe["content_hash"],
             "cards": 1, "grp_ids": 1, "text_missing": 0,
             "built_at": "x", "formats_with_ratings": []}
    payload = _load(index_path)
    payload["sets"]["ZZZ"] = other
    index_path.write_text(json.dumps(payload))

    _, index, stale = bab.build([SET], out)
    assert (out / SET / "cards.json").read_bytes() == first_cards
    assert index["sets"][SET] == first_index["sets"][SET]
    assert index["sets"]["ZZZ"] == other
    assert list(index["sets"]) == [SET, "ZZZ"]
    assert stale == []


def test_bundle_without_ratings_skips_ratings_json(card_store, data_root,
                                                   tmp_path):
    vocab_file = paths.vocab_path(SET, FMT)
    vocab_file.parent.mkdir(parents=True, exist_ok=True)
    vocab_file.write_text(json.dumps(
        {"set": SET, "format": FMT, "names": tbsa.VOCAB}))
    tbsa._write_universe(tbsa.ALL_NAMES)

    out = tmp_path / "sets"
    entries, _, _ = bab.build([SET], out)
    assert not (out / SET / "ratings.json").exists()
    assert entries[SET]["formats_with_ratings"] == []
    assert (out / SET / "cards.json").exists()


def test_stale_index_entries_are_flagged(universe, tmp_path):
    out = tmp_path / "sets"
    out.mkdir()
    (out / "index.json").write_text(json.dumps({"sets": {"OLD": {
        "picks_per_pack": 14, "manifest_hash": "deadbeef", "cards": 1,
        "grp_ids": 1, "text_missing": 0, "built_at": "x",
        "formats_with_ratings": []}}}))
    _, index, stale = bab.build([SET], out)
    assert stale == ["OLD"]
    assert "OLD" in index["sets"]  # kept, but reported


def test_helpers_normalize_identity_fields():
    assert bab._colors("B,U") == "UB"
    assert bab._colors("gwu") == "WUG"
    assert bab._colors(float("nan")) == ""
    assert bab._rarity("basic") == "land"
    assert bab._rarity("Mythic") == "mythic"
    assert bab._mana_value(3.0) == 3
    assert bab._mana_value(float("nan")) is None
    assert bab._mana_value(None) is None

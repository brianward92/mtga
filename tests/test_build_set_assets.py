"""scripts/build_set_assets.py: per-set DraftFM serving assets.

Reuses test_featurize's synthetic Scryfall builders so features go through
the real frozen-manifest featurizer, and _synth's card store / ratings cache
so the grpId universe matches the serving fixtures.
"""

import importlib.util
import json
from pathlib import Path

import numpy as np
import pytest

import test_featurize as tf
from _synth import (ALIASES_A, CARD_A, CARD_B, CARD_C, CARD_D, FMT, GRP, SET,
                    VOCAB)
from mtga.foundation import featurize, textemb
from mtga.lands import names as names_mod
from mtga.lands import paths

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"

spec = importlib.util.spec_from_file_location(
    "build_set_assets", SCRIPTS / "build_set_assets.py")
bsa = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bsa)

ALL_NAMES = VOCAB + ["Alt Only"]


def _write_universe(names):
    """Synthetic Scryfall rows + frozen manifest + text-emb cache."""
    cards = [tf.card(name, set_="tst", rarity=rarity, colors=color,
                     color_identity=color, mana_cost="{1}", cmc=1.0,
                     oracle_text=f"{name} does a thing.")
             for name, rarity, color in [
                 (CARD_A, "common", "R"), (CARD_B, "uncommon", "W"),
                 (CARD_C, "rare", "U"), (CARD_D, "common", "G"),
                 ("Alt Only", "common", "B")]
             if name in names]
    tf.write_scryfall(cards)
    manifest = featurize.build_manifest({SET: names})
    featurize.save_manifest(manifest)
    textemb._write_cache(paths.TEXT_EMB_CACHE, {
        names_mod.norm_17lands(n): np.full(textemb.EMBED_DIM, 0.25,
                                           dtype=np.float32)
        for n in names
    })
    return manifest


@pytest.fixture
def curated_vocab(data_root):
    vocab_file = paths.vocab_path(SET, FMT)
    vocab_file.parent.mkdir(parents=True, exist_ok=True)
    vocab_file.write_text(json.dumps(
        {"set": SET, "format": FMT, "names": VOCAB}))
    return vocab_file


def test_universe_merges_vocab_store_and_aliases(card_store, curated_vocab,
                                                 ratings_cache):
    grp_lists = bsa.universe(SET)
    assert list(grp_lists) == ALL_NAMES  # vocab order first, then store-only
    assert grp_lists[CARD_A] == ALIASES_A  # booster, alt art, out-of-set
    assert grp_lists[CARD_B] == [GRP[CARD_B]]
    assert set(grp_lists["Alt Only"]) == {501, 502}


def test_build_writes_loadable_assets(card_store, curated_vocab,
                                      ratings_cache):
    manifest = _write_universe(ALL_NAMES)
    result = bsa.build(SET)
    assert result["n_cards"] == len(ALL_NAMES)
    assert result["text_missing"] == []

    from mtga.models.draftfm import load_assets

    assets = load_assets(paths.set_assets_path(SET))
    assert assets["names"] == ALL_NAMES
    assert assets["features"].shape == (
        len(ALL_NAMES), featurize.N_FEATURES + textemb.EMBED_DIM)
    assert assets["manifest_hash"] == manifest["content_hash"]
    assert assets["picks_per_pack"] == 14
    assert assets["grp_ids"][CARD_A] == ALIASES_A
    # rarity ids follow the manifest's rarity block order (c, u, r, m, other)
    assert assets["rarity_ids"].tolist() == [0, 1, 2, 0, 0]
    # text block: the cached embedding, not zeros
    assert assets["features"][0, featurize.N_FEATURES] == pytest.approx(
        0.25, rel=1e-2)


def test_day1_set_builds_from_ratings_cache_alone(card_store, data_root):
    """The MSH hour-zero path: no vocab, no store rows for the set — names
    and grpIds come from the cached card_ratings, features on the fly."""
    import _synth

    _synth.write_ratings_cache(set_code="MSH")
    _write_universe(VOCAB)

    grp_lists = bsa.universe("MSH")
    assert list(grp_lists) == VOCAB  # "No Arena Id" row skipped
    # Global store aliases still resolve for reprinted names.
    assert set(grp_lists[CARD_A]) == set(ALIASES_A)

    result = bsa.build("MSH")
    assert result["n_cards"] == 4
    assert result["path"] == paths.set_assets_path("MSH")

    from mtga.models.draftfm import load_assets

    assets = load_assets(result["path"])
    assert assets["picks_per_pack"] == 14  # default: nothing curated yet


def test_missing_text_embeddings_fail_unless_allowed(card_store,
                                                     curated_vocab,
                                                     monkeypatch):
    _write_universe(ALL_NAMES)
    # Drop two names from the cache and make the encoder unimportable.
    textemb._write_cache(paths.TEXT_EMB_CACHE, {
        names_mod.norm_17lands(n): np.full(textemb.EMBED_DIM, 0.25,
                                           dtype=np.float32)
        for n in ALL_NAMES[:3]
    })

    def no_encoder():
        raise ImportError("sentence-transformers not installed")

    monkeypatch.setattr(textemb, "_load_encoder", no_encoder)

    with pytest.raises(RuntimeError, match="setup_embed"):
        bsa.build(SET)

    result = bsa.build(SET, allow_missing_text=True)
    assert sorted(result["text_missing"]) == sorted(ALL_NAMES[3:])
    assets = np.load(paths.set_assets_path(SET))
    text = assets["features"][:, featurize.N_FEATURES:]
    assert not np.any(text[:3] == 0)  # cached names keep their vectors
    assert np.all(text[3:] == 0)      # missing names zero-filled


def test_empty_universe_is_a_hard_failure(data_root):
    with pytest.raises(FileNotFoundError, match="universe"):
        bsa.build("ZZZ")

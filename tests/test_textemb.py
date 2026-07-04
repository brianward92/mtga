"""mtga/foundation/textemb.py: oracle normalization + embedding cache."""

import numpy as np
import pytest

from mtga.foundation import textemb
from mtga.lands import names, paths


# ---------------------------------------------------------------------------
# normalize_oracle.

def test_self_name_and_legendary_short_name_masked():
    out = textemb.normalize_oracle(
        "Elenda, the Dusk Rose",
        "Legendary Creature — Vampire Knight",
        "When Elenda, the Dusk Rose dies, create tokens.\n"
        "Elenda gets +1/+1 for each Vampire you control.",
    )
    assert "Elenda" not in out
    assert out == ("Legendary Creature — Vampire Knight | "
                   "When ~ dies, create tokens. | "
                   "~ gets +1/+1 for each Vampire you control.")


def test_short_name_not_masked_for_nonlegendary():
    out = textemb.normalize_oracle(
        "Rise, Again", "Sorcery", "Rise, Again costs less. Rise is a word.")
    assert out == "Sorcery | ~ costs less. Rise is a word."


def test_reminder_text_is_kept():
    out = textemb.normalize_oracle(
        "Sky Skirmisher", "Creature — Bird",
        "Flying (This creature can't be blocked except by creatures with "
        "flying or reach.)")
    assert "(This creature can't be blocked" in out


def test_newlines_collapse_and_symbols_kept():
    out = textemb.normalize_oracle(
        "Mana Rock", "Artifact", "{T}: Add {C}.\n{2}, {T}: Scry 1.")
    assert out == "Artifact | {T}: Add {C}. | {2}, {T}: Scry 1."


def test_dfc_appends_back_face():
    out = textemb.normalize_oracle(
        "Moon Howler // Night Terror",
        "Creature — Human Werewolf // Creature — Nightmare",
        "At night, transform Moon Howler.",
        "Night Terror attacks each combat.",
    )
    assert out == ("Creature — Human Werewolf | At night, transform ~. // "
                   "Creature — Nightmare | ~ attacks each combat.")


def test_vanilla_card_is_just_the_type_line():
    assert textemb.normalize_oracle("Bear", "Creature — Bear", None) == (
        "Creature — Bear")


# ---------------------------------------------------------------------------
# embed_names cache contract.

def _fail_import():
    raise ImportError("No module named 'sentence_transformers'")


class FakeEncoder:
    """Deterministic stand-in: vector i is all (i+1)s."""

    def __init__(self):
        self.calls = []

    def encode(self, texts, **kwargs):
        self.calls.append(list(texts))
        return np.stack([
            np.full(textemb.EMBED_DIM, i + 1.0, dtype=np.float32)
            for i in range(len(texts))
        ])


def test_cache_miss_without_model_raises_listing_names(data_root, monkeypatch):
    monkeypatch.setattr(textemb, "_load_encoder", _fail_import)
    with pytest.raises(RuntimeError) as excinfo:
        textemb.embed_names(["Blazing Torrent", "Steel Trinket"],
                            paths.TEXT_EMB_CACHE)
    message = str(excinfo.value)
    assert "Blazing Torrent" in message and "Steel Trinket" in message
    assert "setup_embed.sh" in message and ".venv-embed" in message


def test_cache_hit_never_needs_the_model(data_root, monkeypatch):
    monkeypatch.setattr(textemb, "_load_encoder", _fail_import)
    vec = np.full(textemb.EMBED_DIM, 7.0, dtype=np.float32)
    textemb._write_cache(paths.TEXT_EMB_CACHE, {"blazing torrent": vec})
    out = textemb.embed_names(["Blazing Torrent"], paths.TEXT_EMB_CACHE)
    assert out.shape == (1, textemb.EMBED_DIM) and out.dtype == np.float32
    assert np.array_equal(out[0], vec)


def test_cache_keys_use_norm_17lands_aliases(data_root, monkeypatch):
    monkeypatch.setattr(textemb, "_load_encoder", _fail_import)
    vec = np.full(textemb.EMBED_DIM, 3.0, dtype=np.float32)
    textemb._write_cache(paths.TEXT_EMB_CACHE,
                         {names.norm("Bespoke Bō"): vec})
    # The 17Lands ASCII-mangled form must hit the same cache entry.
    out = textemb.embed_names(["Bespoke B?"], paths.TEXT_EMB_CACHE)
    assert np.array_equal(out[0], vec)


def test_encoder_extends_cache_then_serves_without_it(data_root, monkeypatch):
    encoder = FakeEncoder()
    monkeypatch.setattr(textemb, "_load_encoder", lambda: encoder)
    texts = {"Blazing Torrent": "Instant | ~ deals X damage to any target."}
    first = textemb.embed_names(["Blazing Torrent"], paths.TEXT_EMB_CACHE,
                                texts_by_name=texts)
    assert encoder.calls == [[texts["Blazing Torrent"]]]
    assert first.shape == (1, textemb.EMBED_DIM)

    # Second call: cache covers the name; the model must not be needed.
    monkeypatch.setattr(textemb, "_load_encoder", _fail_import)
    second = textemb.embed_names(["Blazing Torrent"], paths.TEXT_EMB_CACHE)
    assert np.array_equal(first, second)


def test_stale_normalization_version_invalidates_cache(data_root, monkeypatch):
    vec = np.full(textemb.EMBED_DIM, 1.0, dtype=np.float32)
    textemb._write_cache(paths.TEXT_EMB_CACHE, {"blazing torrent": vec})
    monkeypatch.setattr(textemb, "NORMALIZATION_VERSION", "onorm-v999")
    monkeypatch.setattr(textemb, "_load_encoder", _fail_import)
    with pytest.raises(RuntimeError, match="Blazing Torrent"):
        textemb.embed_names(["Blazing Torrent"], paths.TEXT_EMB_CACHE)


def test_missing_texts_by_name_entry_is_an_error(data_root, monkeypatch):
    monkeypatch.setattr(textemb, "_load_encoder", lambda: FakeEncoder())
    with pytest.raises(KeyError, match="Steel Trinket"):
        textemb.embed_names(["Steel Trinket"], paths.TEXT_EMB_CACHE,
                            texts_by_name={"Other Card": "Artifact |"})

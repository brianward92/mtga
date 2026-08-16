"""scripts/build_app_bundle.py: the offline per-set bundle the Electron app ships.

Everything is synthetic and hermetic: a tiny raw Scryfall `default_cards`
JSONL snapshot (the builder's only external input), a frozen manifest built
from it and stored next to a fake model export, a text-embedding cache under
the data root, and a curated vocab sidecar.
"""

import gzip
import importlib.util
import json
from pathlib import Path
from unittest import mock

import numpy as np
import pytest

from _synth import CARD_A, CARD_B, CARD_C, CARD_D, FMT, SET, VOCAB
from mtga import scryfall
from mtga.foundation import featurize, textemb
from mtga.lands import names as names_mod
from mtga.lands import paths

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"

spec = importlib.util.spec_from_file_location(
    "build_app_bundle", SCRIPTS / "build_app_bundle.py"
)
bab = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bab)

DFC = "Front Face // Back Face"
NEW_SET = "NEW"


# ---------------------------------------------------------------------------
# Synthetic Scryfall snapshot


def scry(
    name,
    set_="tst",
    arena_id=None,
    rarity="common",
    type_line="Creature — Human",
    mana_cost="{1}",
    cmc=1.0,
    colors=(),
    color_identity=(),
    oracle_text=None,
    layout="normal",
    digital=False,
    released_at="2024-09-27",
    booster=True,
    lang="en",
    faces=None,
    id_=None,
    games=("paper", "arena"),
):
    row = {
        "id": id_ or f"scry-{name.lower().replace(' ', '-').replace('/', '')}-{set_}",
        "name": name,
        "set": set_,
        "lang": lang,
        "rarity": rarity,
        "type_line": type_line,
        "mana_cost": mana_cost,
        "cmc": cmc,
        "colors": list(colors),
        "color_identity": list(color_identity),
        "oracle_text": (
            oracle_text if oracle_text is not None else f"{name} does a thing."
        ),
        "keywords": [],
        "layout": layout,
        "digital": digital,
        "released_at": released_at,
        "booster": booster,
        "games": list(games),
        "collector_number": "1",
    }
    if arena_id is not None:
        row["arena_id"] = arena_id
    if faces is not None:
        row["card_faces"] = faces
    return row


def face(
    name, mana_cost="{1}", type_line="Creature — Human", oracle_text=None, colors=()
):
    return {
        "name": name,
        "mana_cost": mana_cost,
        "type_line": type_line,
        "oracle_text": oracle_text or f"{name} face text.",
        "colors": list(colors),
    }


def snapshot_rows():
    return [
        # In-set printing, an out-of-set alt printing, and a token that must be
        # ignored even though Scryfall gave it an arena_id.
        scry(CARD_A, arena_id=101, rarity="common", colors="R", color_identity="R"),
        scry(
            CARD_A,
            set_="oth",
            arena_id=301,
            rarity="uncommon",
            colors="R",
            color_identity="R",
            released_at="2020-01-01",
        ),
        scry(CARD_A, set_="toth", arena_id=999, layout="token"),
        scry(CARD_B, arena_id=102, rarity="uncommon", colors="W", color_identity="W"),
        scry(CARD_C, arena_id=103, rarity="rare", colors="U", color_identity="U"),
        # Printed-colorless but green identity: colors and colorIdentity must
        # remain distinct in cards.json.
        scry(
            CARD_D,
            arena_id=104,
            rarity="common",
            colors=(),
            color_identity="G",
            type_line="Artifact — Equipment",
        ),
        # A transform DFC: mana cost lives on the front face.
        scry(
            DFC,
            arena_id=106,
            rarity="rare",
            type_line="Creature — Human // Creature — Wolf",
            mana_cost="",
            cmc=2.0,
            colors="R",
            color_identity="RG",
            layout="transform",
            faces=[
                face("Front Face", "{1}{R}", colors="R"),
                face("Back Face", "", "Creature — Wolf", colors="G"),
            ],
        ),
        # A basic land: rarity 'land' in cards.json, kept in the universe.
        scry(
            "Plains",
            arena_id=105,
            type_line="Basic Land — Plains",
            mana_cost="",
            cmc=0.0,
            colors="W",
            color_identity="W",
        ),
        # A no-vocab set: fallback is the union of booster and Arena-game
        # printings, independent of arena_id availability.
        scry("New Common", set_="new", arena_id=201, released_at="2026-08-01"),
        scry(
            "New Rare",
            set_="new",
            arena_id=202,
            rarity="rare",
            released_at="2026-08-01",
        ),
        scry(
            "New Promo",
            set_="new",
            arena_id=203,
            booster=False,
            released_at="2026-08-01",
        ),
        scry("New Paper Only", set_="new", released_at="2026-08-01"),
        scry("New Basic", set_="new", type_line="Basic Land — Forest", arena_id=204),
        # A printing in another set is never added to NEW's fallback universe.
        scry("Elsewhere Only", set_="oth", released_at="2020-01-01"),
    ]


def write_snapshot(path, rows=None):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    opener = gzip.open if path.name.endswith(".gz") else open
    with opener(path, "wt", encoding="utf-8") as fh:
        for row in rows if rows is not None else snapshot_rows():
            fh.write(json.dumps(row) + "\n")
    return path


ALL_NAMES = VOCAB + [DFC, "Plains"]


@pytest.fixture
def world(data_root, tmp_path):
    """Snapshot + vocab + manifest-in-model-dir + text cache."""
    snap_path = write_snapshot(bab.scryfall_dir() / "default_cards-2026-08-15.jsonl.gz")
    vocab_file = paths.vocab_path(SET, FMT)
    vocab_file.parent.mkdir(parents=True, exist_ok=True)
    vocab_file.write_text(json.dumps({"set": SET, "format": FMT, "names": ALL_NAMES}))

    snapshot = bab.Snapshot(snap_path)
    cards, faces = snapshot.frames()
    manifest = featurize.build_manifest({SET: ALL_NAMES}, cards, faces)
    model_dir = tmp_path / "model" / "v1"
    model_dir.mkdir(parents=True)
    (model_dir / "meta.json").write_text(
        json.dumps(
            {"model_id": "_foundation/v1", "manifest_hash": manifest["content_hash"]}
        )
    )
    featurize.save_manifest(manifest, model_dir / "featurizer_manifest.json")

    textemb._write_cache(
        paths.TEXT_EMB_CACHE,
        {
            names_mod.norm_17lands(n): np.full(
                textemb.EMBED_DIM, 0.25, dtype=np.float32
            )
            for n in ALL_NAMES
            + ["New Common", "New Rare", "New Promo", "New Paper Only"]
        },
    )
    return {
        "snapshot": snapshot,
        "manifest": manifest,
        "model_dir": model_dir,
        "out": tmp_path / "sets",
    }


def _build(world, sets, **kw):
    return bab.build(sets, world["out"], world["snapshot"], world["model_dir"], **kw)


# ---------------------------------------------------------------------------


def test_build_writes_assets_cards_index(world):
    (world["out"] / SET).mkdir(parents=True)
    (world["out"] / SET / "ratings.json").write_text("{}")  # stale, must go

    entries, failures, index, stale = _build(world, [SET])
    assert failures == {} and stale == []
    set_dir = world["out"] / SET
    assert not (set_dir / "ratings.json").exists()

    with np.load(set_dir / "assets.npz") as z:
        names = [str(n) for n in z["names"]]
        grp = json.loads(str(z["grp_ids"]))
        assert names == ALL_NAMES  # vocab order
        assert z["features"].dtype == np.float16
        assert z["features"].shape == (
            len(ALL_NAMES),
            featurize.N_FEATURES + textemb.EMBED_DIM,
        )
        assert str(z["manifest_hash"]) == world["manifest"]["content_hash"]
        assert int(z["picks_per_pack"]) == 14
        assert str(z["set"]) == SET
        assert json.loads(str(z["text_missing"])) == []
        # rarity block: common, uncommon, rare, common, rare(dfc), other(basic land? no: common)
        assert z["rarity_ids"].tolist()[:4] == [0, 1, 2, 0]
        # text block served from the cache
        assert float(z["features"][0, featurize.N_FEATURES]) == pytest.approx(
            0.25, rel=1e-2
        )
    # in-set arena_id first, then the alt printing; token dropped.
    assert grp[CARD_A] == [101, 301]
    assert grp[CARD_B] == [102]
    assert grp[DFC] == [106]
    assert grp["Plains"] == [105]

    cards = json.loads((set_dir / "cards.json").read_text())
    assert cards["set"] == SET
    assert cards["scryfall_updated_at"] == "2026-08-15"
    assert list(cards["cards"]) == ALL_NAMES
    assert set(cards) == {"set", "scryfall_updated_at", "built_at", "cards"}
    expected_card_keys = {
        "rarity",
        "colors",
        "colorIdentity",
        "manaCost",
        "manaValue",
        "type",
    }
    assert cards["cards"][CARD_A] == {
        "rarity": "common",
        "colors": "R",
        "colorIdentity": "R",
        "manaCost": "{1}",
        "manaValue": 1,
        "type": "Creature — Human",
    }
    assert all(set(card) == expected_card_keys for card in cards["cards"].values())
    assert cards["cards"][DFC]["manaCost"] == "{1}{R}"  # front face
    assert cards["cards"][DFC]["colors"] == "R"
    assert cards["cards"][DFC]["colorIdentity"] == "RG"
    assert cards["cards"][CARD_D]["colors"] == ""
    assert cards["cards"][CARD_D]["colorIdentity"] == "G"
    assert cards["cards"]["Plains"]["rarity"] == "land"
    assert cards["cards"]["Plains"]["colors"] == ""
    assert cards["cards"]["Plains"]["colorIdentity"] == "W"
    serialized = json.dumps(cards)
    assert "grpId" not in serialized and "image" not in serialized
    assert "rating" not in serialized and "overlay" not in serialized
    assert "\n" not in (set_dir / "cards.json").read_text()  # compact

    assert index["model_id"] == "_foundation/v1"
    assert index["model_manifest_hash"] == world["manifest"]["content_hash"]
    assert index["scryfall_updated_at"] == "2026-08-15"
    entry = index["sets"][SET]
    assert set(index) == {
        "model_id",
        "model_manifest_hash",
        "scryfall_updated_at",
        "built_at",
        "sets",
    }
    assert tuple(entry) == bab.PUBLIC_SET_KEYS
    assert entry["picks_per_pack"] == 14
    assert entry["cards"] == len(ALL_NAMES)
    assert entry["grp_ids"] == sum(len(v) for v in grp.values())
    assert entry["text_missing"] == 0
    assert json.loads((world["out"] / "index.json").read_text()) == index
    assert entries[SET]["_names_without_grp_ids"] == []


def test_no_vocab_set_uses_scryfall_booster_or_arena_printings(world):
    entries, failures, index, _ = _build(world, [NEW_SET])
    assert failures == {}
    with np.load(world["out"] / NEW_SET / "assets.npz") as z:
        names = [str(n) for n in z["names"]]
        grp = json.loads(str(z["grp_ids"]))
    # Arena promo and paper-only booster are included; basics and a printing
    # from another set are excluded. Missing ids remain explicit in report mode.
    assert names == ["New Common", "New Paper Only", "New Promo", "New Rare"]
    assert grp == {
        "New Common": [201],
        "New Paper Only": [],
        "New Promo": [203],
        "New Rare": [202],
    }
    assert entries[NEW_SET]["names_source"] == "scryfall"
    assert entries[NEW_SET]["_names_without_grp_ids"] == ["New Paper Only"]
    assert index["sets"][NEW_SET]["cards"] == 4
    assert index["sets"][NEW_SET]["grp_ids"] == 3


def test_idempotent_and_index_merges_other_sets(world):
    _build(world, [SET])
    first = (world["out"] / SET / "cards.json").read_text()
    payload = json.loads((world["out"] / "index.json").read_text())
    other = {
        "picks_per_pack": 15,
        "manifest_hash": world["manifest"]["content_hash"],
        "cards": 1,
        "grp_ids": 1,
        "text_missing": 0,
        "built_at": "x",
    }
    payload["sets"]["ZZZ"] = dict(other, legacy_extra="removed")
    payload["sets"]["OLD"] = dict(other, manifest_hash="deadbeef")
    (world["out"] / "index.json").write_text(json.dumps(payload))

    _, _, index, stale = _build(world, [SET])
    second = json.loads((world["out"] / SET / "cards.json").read_text())
    assert {k: v for k, v in second.items() if k != "built_at"} == {
        k: v for k, v in json.loads(first).items() if k != "built_at"
    }
    assert index["sets"]["ZZZ"] == other
    assert list(index["sets"]) == [SET, "ZZZ"]
    assert stale == ["OLD"]


def test_incompatible_index_entries_and_failed_requested_set_are_dropped(world):
    _build(world, [SET])
    index_path = world["out"] / "index.json"
    payload = json.loads(index_path.read_text())
    payload["scryfall_updated_at"] = "2026-08-14"
    payload["sets"]["OLD"] = dict(payload["sets"][SET])
    index_path.write_text(json.dumps(payload))

    entries, failures, index, stale = _build(world, [NEW_SET, "BAD"])
    assert failures["BAD"].startswith("no card universe")
    assert set(entries) == {NEW_SET}
    assert set(index["sets"]) == {NEW_SET}
    assert stale == ["OLD", SET]


def test_all_failed_does_not_rewrite_index_and_removes_stale_ratings(world):
    world["out"].mkdir()
    index_path = world["out"] / "index.json"
    original = b'{"legacy":true}'
    index_path.write_bytes(original)
    bad_dir = world["out"] / "BAD"
    bad_dir.mkdir()
    (bad_dir / "ratings.json").write_text("{}")

    entries, failures, index, stale = _build(world, ["BAD"])
    assert entries == {} and "BAD" in failures and stale == []
    assert index["sets"] == {}
    assert index_path.read_bytes() == original
    assert not (bad_dir / "ratings.json").exists()


def test_unmatched_vocab_name_fails_that_set_and_continues(world):
    vocab_file = paths.vocab_path("BAD", FMT)
    vocab_file.write_text(
        json.dumps({"set": "BAD", "format": FMT, "names": [CARD_A, "Never Printed"]})
    )
    entries, failures, index, _ = _build(world, ["BAD", SET])
    assert set(entries) == {SET}
    assert "Never Printed" in failures["BAD"]
    assert (
        not (world["out"] / "BAD").exists()
        or not (world["out"] / "BAD" / "assets.npz").exists()
    )
    assert list(index["sets"]) == [SET]


def test_malformed_unrelated_vocab_does_not_defeat_per_set_continuation(world):
    bad = paths.vocab_path("BAD", FMT)
    bad.write_text("{not json")
    entries, failures, index, _ = _build(world, ["BAD", SET])
    assert set(entries) == {SET}
    assert "BAD" in failures
    assert list(index["sets"]) == [SET]


def test_missing_grp_id_policy_is_localized_and_reports_every_name(
    world, monkeypatch, capsys
):
    grp, provenance = bab.universe(NEW_SET, world["snapshot"])
    assert grp["New Paper Only"] == []
    assert provenance["names_without_grp_ids"] == ["New Paper Only"]

    monkeypatch.setattr(bab, "MISSING_GRP_IDS_POLICY", "fail")
    with pytest.raises(bab.BundleError) as err:
        bab.universe(NEW_SET, world["snapshot"])
    assert '["New Paper Only"]' in str(err.value)

    missing = [f"Missing {i}" for i in range(9)]
    entry = {
        "cards": 9,
        "grp_ids": 0,
        "text_missing": 0,
        "names_source": "scryfall",
        "_names_without_grp_ids": missing,
    }
    (world["out"] / NEW_SET).mkdir(parents=True)
    bab._report(
        world["out"],
        {NEW_SET: entry},
        {},
        {"model_id": "m", "model_manifest_hash": "h", "sets": {}},
        [],
        world["snapshot"],
        world["model_dir"],
    )
    report = capsys.readouterr().out
    assert json.dumps(missing) in report


def test_later_feature_failure_keeps_missing_grp_ids_in_error(world, monkeypatch):
    def fail_features(*args, **kwargs):
        raise RuntimeError("feature boom")

    monkeypatch.setattr(bab, "feature_table", fail_features)
    entries, failures, _, _ = _build(world, [NEW_SET])
    assert entries == {}
    assert "feature boom" in failures[NEW_SET]
    assert '["New Paper Only"]' in failures[NEW_SET]


def test_missing_text_fails_with_setup_command_unless_allowed(world, monkeypatch):
    textemb._write_cache(
        paths.TEXT_EMB_CACHE,
        {
            names_mod.norm_17lands(n): np.full(
                textemb.EMBED_DIM, 0.25, dtype=np.float32
            )
            for n in ALL_NAMES
            if n not in (CARD_B, DFC)
        },
    )

    def no_encoder():
        raise ImportError("no sentence_transformers")

    monkeypatch.setattr(textemb, "_load_encoder", no_encoder)

    entries, failures, _, _ = _build(world, [SET])
    assert entries == {}
    message = failures[SET]
    assert "setup_embed.sh" in message and ".venv-embed/bin/python" in message
    assert CARD_B in message and DFC in message
    assert not (world["out"] / SET / "assets.npz").exists()

    entries, failures, _, _ = _build(world, [SET], allow_missing_text=True)
    assert failures == {}
    with np.load(world["out"] / SET / "assets.npz") as z:
        assert json.loads(str(z["text_missing"])) == [CARD_B, DFC]
        row = ALL_NAMES.index(CARD_B)
        assert not z["features"][row, featurize.N_FEATURES :].any()
        assert z["features"][0, featurize.N_FEATURES :].any()
    assert entries[SET]["text_missing"] == 2


def test_missing_text_is_embedded_in_process_when_encoder_importable(
    world, monkeypatch
):
    textemb._write_cache(
        paths.TEXT_EMB_CACHE,
        {
            names_mod.norm_17lands(n): np.full(
                textemb.EMBED_DIM, 0.25, dtype=np.float32
            )
            for n in ALL_NAMES
            if n != DFC
        },
    )
    seen = {}

    class Encoder:
        def encode(self, texts, normalize_embeddings=True, convert_to_numpy=True):
            seen["texts"] = list(texts)
            return np.full((len(texts), textemb.EMBED_DIM), 0.5, dtype=np.float32)

    monkeypatch.setattr(textemb, "_load_encoder", lambda: Encoder())

    _, failures, _, _ = _build(world, [SET])
    assert failures == {}
    # the embed string came from the raw snapshot (front + back face text)
    assert seen["texts"] == [
        textemb.normalize_oracle(
            DFC,
            "Creature — Human // Creature — Wolf",
            "Front Face face text.",
            "Back Face face text.",
        )
    ]
    assert names_mod.norm_17lands(DFC) in textemb._read_cache(paths.TEXT_EMB_CACHE)
    with np.load(world["out"] / SET / "assets.npz") as z:
        assert json.loads(str(z["text_missing"])) == []
        assert float(
            z["features"][ALL_NAMES.index(DFC), featurize.N_FEATURES]
        ) == pytest.approx(0.5, rel=1e-2)


def test_model_manifest_must_match_meta(world):
    meta_path = world["model_dir"] / "meta.json"
    meta_path.write_text(json.dumps({"model_id": "x"}))
    with pytest.raises(bab.BundleError, match="no manifest_hash"):
        bab.load_model(world["model_dir"])

    meta_path.write_text(json.dumps({"model_id": "x", "manifest_hash": "0" * 64}))
    with pytest.raises(bab.BundleError, match="manifest_hash"):
        bab.load_model(world["model_dir"])

    manifest_path = world["model_dir"] / "featurizer_manifest.json"
    payload = json.loads(manifest_path.read_text())
    payload["subtype_vocab"].append("Tampered")
    manifest_path.write_text(json.dumps(payload))
    with pytest.raises(bab.BundleError, match="content_hash"):
        bab.load_model(world["model_dir"])

    manifest_path.unlink()
    with pytest.raises(bab.BundleError, match="missing"):
        bab.load_model(world["model_dir"])


def test_snapshot_discovery_min_date_and_fetch(data_root, monkeypatch):
    with pytest.raises(bab.BundleError) as err:
        bab.ensure_snapshot()
    assert str(bab.scryfall_dir() / "default_cards-YYYY-MM-DD.jsonl.gz") in str(
        err.value
    )
    assert "--fetch" in str(err.value) and "default_cards" in str(err.value)

    old = write_snapshot(bab.scryfall_dir() / "default_cards-2026-08-01.jsonl.gz")
    new = write_snapshot(bab.scryfall_dir() / "default_cards-2026-08-10.jsonl")
    (bab.scryfall_dir() / "default_cards-2026-08-10.jsonl.gz.part").write_text("")
    assert bab.ensure_snapshot() == (new, "2026-08-10")  # newest dated file wins
    assert bab.ensure_snapshot(explicit=old) == (old, "2026-08-01")
    undated = write_snapshot(bab.scryfall_dir() / "default_cards.jsonl.gz")
    with pytest.raises(bab.BundleError, match="dated raw default_cards"):
        bab.ensure_snapshot(explicit=undated)
    with pytest.raises(bab.BundleError, match="YYYY-MM-DD"):
        bab.ensure_snapshot(min_date="yesterday")
    with pytest.raises(bab.BundleError, match="2026-08-12"):
        bab.ensure_snapshot(min_date="2026-08-12")
    with pytest.raises(bab.BundleError, match="older"):
        bab.ensure_snapshot(explicit=old, min_date="2026-08-05")

    # --fetch: the bulk-data listing names the file; the sidecar keeps updated_at.
    item = {
        "type": "default_cards",
        "updated_at": "2026-08-15T21:05:41.265+00:00",
        "jsonl_download_uri": "https://data.scryfall.io/x.jsonl.gz",
    }
    monkeypatch.setattr(
        scryfall, "get_bulk_data_item", lambda data_type, refresh=False: item
    )

    def fake_download(data_type, dest, item=None, **kwargs):
        write_snapshot(dest)
        scryfall.bulk_meta_path(dest).write_text(
            json.dumps(
                {
                    "type": data_type,
                    "updated_at": item["updated_at"],
                }
            )
        )
        return item

    monkeypatch.setattr(scryfall, "download_bulk_data", fake_download)
    path, updated = bab.ensure_snapshot(min_date="2026-08-12", fetch=True)
    assert path == bab.scryfall_dir() / "default_cards-2026-08-15.jsonl.gz"
    assert updated == "2026-08-15T21:05:41.265+00:00"
    # already on disk: not downloaded again
    monkeypatch.setattr(
        scryfall,
        "download_bulk_data",
        lambda *a, **k: (_ for _ in ()).throw(AssertionError("re-downloaded")),
    )
    assert bab.ensure_snapshot(fetch=True)[0] == path

    legacy = dict(
        item, jsonl_download_uri=None, download_uri="https://data.scryfall.io/x.json.gz"
    )
    monkeypatch.setattr(
        scryfall, "get_bulk_data_item", lambda data_type, refresh=False: legacy
    )
    monkeypatch.setattr(scryfall, "download_bulk_data", fake_download)
    assert bab.ensure_snapshot(fetch=True)[0].name == "default_cards-2026-08-15.json.gz"


def test_snapshot_sidecar_must_match_type_date_and_timestamp(data_root):
    path = write_snapshot(bab.scryfall_dir() / "default_cards-2026-08-15.jsonl.gz")
    meta = scryfall.bulk_meta_path(path)
    meta.write_text(
        json.dumps({"type": "all_cards", "updated_at": "2026-08-15T00:00:00Z"})
    )
    with pytest.raises(bab.BundleError, match="not 'default_cards'"):
        bab.snapshot_updated_at(path)
    meta.write_text(
        json.dumps({"type": "default_cards", "updated_at": "2026-08-14T00:00:00Z"})
    )
    with pytest.raises(bab.BundleError, match="does not match"):
        bab.snapshot_updated_at(path)
    meta.write_text(json.dumps({"type": "default_cards", "updated_at": "nonsense"}))
    with pytest.raises(bab.BundleError, match="invalid updated_at"):
        bab.snapshot_updated_at(path)


def test_iter_bulk_cards_reads_jsonl_and_array_plain_gzip_bom_and_magic(tmp_path):
    rows = [{"name": "A"}, {"name": "B"}]
    gz = write_snapshot(tmp_path / "a.jsonl.gz", rows)
    jl = write_snapshot(tmp_path / "a.jsonl", rows)
    js = tmp_path / "a.json"
    js.write_text("\ufeff  \n" + json.dumps(rows))
    json_gz = tmp_path / "a.json.gz"
    with gzip.open(json_gz, "wt", encoding="utf-8") as fh:
        json.dump(rows, fh)
    magic = tmp_path / "payload-without-gzip-suffix.json"
    magic.write_bytes(gz.read_bytes())
    for path in (gz, jl, js, json_gz, magic):
        assert list(scryfall.iter_bulk_cards(path)) == rows


def test_iter_bulk_cards_errors_have_file_and_line_context(tmp_path):
    empty = tmp_path / "empty.jsonl"
    empty.write_text("")
    with pytest.raises(ValueError, match="empty Scryfall bulk file"):
        list(scryfall.iter_bulk_cards(empty))

    bad_line = tmp_path / "bad.jsonl"
    bad_line.write_text('{"name":"ok"}\n{bad\n')
    with pytest.raises(ValueError, match=r"bad\.jsonl at line 2"):
        list(scryfall.iter_bulk_cards(bad_line))

    bad_array = tmp_path / "bad.json"
    bad_array.write_text("[{}")
    with pytest.raises(ValueError, match="invalid JSON array"):
        list(scryfall.iter_bulk_cards(bad_array))


def test_download_bulk_data_streams_and_writes_sidecar(tmp_path, monkeypatch):
    item = {
        "type": "default_cards",
        "updated_at": "2026-08-15T21:05:41+00:00",
        "jsonl_download_uri": "https://data.scryfall.io/x.jsonl.gz",
        "size": 3,
    }
    monkeypatch.setattr(
        scryfall, "get_bulk_data_item", lambda data_type, refresh=False: item
    )
    response = mock.MagicMock()
    response.__enter__.return_value = response
    response.iter_content.return_value = [b"ab", b"c"]
    monkeypatch.setattr(scryfall.requests, "get", lambda *a, **k: response)
    dest = tmp_path / "default_cards-2026-08-15.jsonl.gz"
    assert scryfall.download_bulk_data("default_cards", dest) == item
    assert dest.read_bytes() == b"abc"
    meta = json.loads(scryfall.bulk_meta_path(dest).read_text())
    assert meta["updated_at"] == item["updated_at"]
    assert meta["download_uri"] == item["jsonl_download_uri"]
    assert scryfall.bulk_item_date(item) == "2026-08-15"
    assert scryfall.bulk_item_extension(item) == ".jsonl.gz"


def test_download_bulk_data_cleans_partial_file_on_size_failure(tmp_path, monkeypatch):
    item = {
        "type": "default_cards",
        "updated_at": "20260815T210541+00:00",
        "download_uri": "https://data.scryfall.io/x.json",
        "size": 99,
    }
    response = mock.MagicMock()
    response.__enter__.return_value = response
    response.iter_content.return_value = [b"abc"]
    monkeypatch.setattr(scryfall.requests, "get", lambda *args, **kwargs: response)
    dest = tmp_path / "default_cards-2026-08-15.json"
    with pytest.raises(OSError, match="listing size"):
        scryfall.download_bulk_data("default_cards", dest, item=item)
    assert not dest.exists()
    assert not dest.with_name(dest.name + ".part").exists()
    assert scryfall.bulk_item_date(item) == "2026-08-15"
    assert scryfall.bulk_item_extension(item) == ".json"
    with pytest.raises(ValueError, match="positive"):
        scryfall.download_bulk_data("default_cards", dest, item=item, chunk_size=0)


def test_main_reports_failures_with_nonzero_exit(world, monkeypatch, capsys):
    monkeypatch.setattr(
        bab, "resolve_model_dir", lambda tag=None, model_root=None: world["model_dir"]
    )
    vocab_file = paths.vocab_path("BAD", FMT)
    vocab_file.write_text(
        json.dumps({"set": "BAD", "format": FMT, "names": ["Never Printed"]})
    )
    code = bab.main(["--set", SET, "--set", "BAD", "--out", str(world["out"])])
    assert code == 1
    captured = capsys.readouterr()
    assert "FAILED BAD" in captured.err and "Never Printed" in captured.err
    assert SET in captured.out and "grpIds" in captured.out
    assert bab.main(["--set", SET, "--out", str(world["out"])]) == 0
    assert bab.main(["--all", "--out", str(world["out"])]) == 1


def test_all_set_selection_includes_hob_once(monkeypatch):
    monkeypatch.setattr(bab, "curated_sets", lambda: ["AAA", "HOB", "ZZZ"])
    assert bab.selected_sets(["hob", "AAA", "aaa"], include_all=True) == [
        "HOB",
        "AAA",
        "ZZZ",
    ]


def test_helpers_normalize_identity_fields():
    assert bab._colors(["B", "U"]) == "UB"
    assert bab._colors(["G", "W", "U"]) == "WUG"
    assert bab._colors(None) == ""
    assert (
        bab._rarity({"type_line": "Basic Land — Forest", "rarity": "common"}) == "land"
    )
    assert bab._rarity({"type_line": "Instant", "rarity": "Mythic"}) == "mythic"
    assert bab.card_entry(
        {
            "type_line": "Artifact — Equipment",
            "rarity": "uncommon",
            "colors": [],
            "color_identity": ["G"],
            "mana_cost": "{2}",
            "cmc": 2,
        }
    ) == {
        "rarity": "uncommon",
        "colors": "",
        "colorIdentity": "G",
        "manaCost": "{2}",
        "manaValue": 2,
        "type": "Artifact — Equipment",
    }
    assert (
        bab.card_entry(
            {
                "type_line": "Land — Forest",
                "rarity": "rare",
                "colors": ["G"],
                "color_identity": ["G"],
                "mana_cost": "",
                "cmc": 0,
            }
        )["colors"]
        == ""
    )
    assert bab._mana_value(3.0) == 3
    assert bab._mana_value(2.5) == 2.5
    assert bab._mana_value(None) is None
    assert bab.snapshot_date("default_cards-2026-08-15.jsonl.gz") == "2026-08-15"
    assert bab.snapshot_date("default_cards-2026-08-15.json") == "2026-08-15"
    assert bab.snapshot_date("all_cards_20260808.json") is None

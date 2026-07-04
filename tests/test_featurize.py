"""mtga/foundation/featurize.py: the frozen 391-dim card feature table."""

import importlib.util
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from mtga.foundation import featurize
from mtga.lands import paths

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"


# ---------------------------------------------------------------------------
# Synthetic Scryfall fixtures (processor schema: run_scryfall_processor.py).

def card(name, id_=None, set_="tst", rarity="common",
         type_line="Creature — Human", mana_cost="{1}", cmc=1.0, colors="",
         color_identity="", oracle_text=None, power=None, toughness=None,
         loyalty=None, keywords="", layout="normal", digital=False):
    return dict(id=id_ or f"scry-{name.lower().replace(' ', '-')}-{set_}",
                name=name, set=set_, rarity=rarity, type_line=type_line,
                mana_cost=mana_cost, cmc=cmc, colors=colors,
                color_identity=color_identity, oracle_text=oracle_text,
                power=power, toughness=toughness, loyalty=loyalty,
                keywords=keywords, layout=layout, digital=digital)


def face(card_id, index, name, mana_cost="", type_line="", oracle_text=None,
         colors="", power=None, toughness=None, loyalty=None):
    return dict(card_id=card_id, face_index=index, name=name,
                mana_cost=mana_cost, type_line=type_line,
                oracle_text=oracle_text, colors=colors, power=power,
                toughness=toughness, loyalty=loyalty)


def write_scryfall(cards, faces=(), released=None):
    """Write cards/sets/card_faces parquets into the monkeypatched layout."""
    released = released or {}
    pd.DataFrame(cards).to_parquet(paths.SCRYFALL_CARDS_PARQUET, index=False)
    sets = sorted({c["set"] for c in cards})
    pd.DataFrame([
        {"set": s, "set_name": s.upper(), "set_type": "expansion",
         "released_at": released.get(s, "2024-01-01"), "digital": False}
        for s in sets
    ]).to_parquet(paths.SCRYFALL_SETS_PARQUET, index=False)
    pd.DataFrame(list(faces) or None,
                 columns=["card_id", "face_index", "name", "mana_cost",
                          "type_line", "oracle_text", "colors", "power",
                          "toughness", "loyalty"]
                 ).to_parquet(paths.SCRYFALL_FACES_PARQUET, index=False)


def hand_cards():
    """Cards covering the featurizer edge cases, plus their face rows."""
    cards = [
        card("Blazing Torrent", type_line="Instant", mana_cost="{X}{R}",
             cmc=1.0, colors="R", color_identity="R", rarity="uncommon",
             oracle_text="Blazing Torrent deals X damage to any target."),
        card("Moon Howler // Night Terror", type_line=(
             "Creature — Human Werewolf // Creature — Nightmare"),
             mana_cost=None, cmc=2.0, colors="", color_identity="G",
             layout="transform", keywords="Trample",
             oracle_text=None, power=None, toughness=None),
        card("Bright Hall // Shimmering Cavern",
             type_line="Creature — Wall // Land", mana_cost=None, cmc=3.0,
             colors="", color_identity="W", layout="modal_dfc"),
        card("Formless Mass", type_line="Creature — Ooze",
             mana_cost="{3}{B}", cmc=4.0, colors="B", color_identity="B",
             power="*", toughness="3",
             oracle_text=("When Formless Mass enters, draw a card.\n"
                          "{T}: Add {B}.")),
        card("Steel Trinket", type_line="Artifact", mana_cost="{2}",
             cmc=2.0, rarity="rare", oracle_text="{T}: Scry 1."),
        card("Twinsoul Guard", type_line="Creature — Spirit Soldier",
             mana_cost="{W/U}{W/U}", cmc=2.0, colors="U,W",
             color_identity="U,W", power="2", toughness="2",
             keywords="Flying,Weirdworking"),
        card("Praetor's Edict", type_line="Sorcery", mana_cost="{1}{B/P}",
             cmc=2.0, colors="B", color_identity="B", rarity="mythic",
             oracle_text="Destroy target creature."),
    ]
    # Eight fillers push Flying over the keyword vocab threshold (>= 8).
    cards += [
        card(f"Filler Bird {i}", type_line="Creature — Bird",
             mana_cost="{1}{W}", cmc=2.0, colors="W", color_identity="W",
             power="1", toughness="1", keywords="Flying")
        for i in range(8)
    ]
    faces = [
        face("scry-moon-howler-//-night-terror-tst", 0, "Moon Howler",
             mana_cost="{1}{G}", type_line="Creature — Human Werewolf",
             colors="G", power="2", toughness="2",
             oracle_text="At the beginning of each upkeep, transform Moon Howler."),
        face("scry-moon-howler-//-night-terror-tst", 1, "Night Terror",
             type_line="Creature — Nightmare", colors="B", power="5",
             toughness="5", oracle_text="Night Terror attacks each combat."),
        face("scry-bright-hall-//-shimmering-cavern-tst", 0, "Bright Hall",
             mana_cost="{2}{W}", type_line="Creature — Wall", colors="W",
             power="0", toughness="4"),
        face("scry-bright-hall-//-shimmering-cavern-tst", 1,
             "Shimmering Cavern", type_line="Land",
             oracle_text="{T}: Add {W}."),
    ]
    return cards, faces


HAND_NAMES = ["Blazing Torrent", "Moon Howler", "Bright Hall",
              "Formless Mass", "Steel Trinket", "Twinsoul Guard",
              "Praetor's Edict"] + [f"Filler Bird {i}" for i in range(8)]


@pytest.fixture
def hand_universe(data_root):
    cards, faces = hand_cards()
    write_scryfall(cards, faces)
    manifest = featurize.build_manifest({"TST": HAND_NAMES})
    return manifest


def featurized(manifest, names):
    matrix, provenance = featurize.featurize(names, manifest)
    columns = featurize.manifest_columns(manifest)
    return pd.DataFrame(matrix, columns=columns, index=names), provenance


# ---------------------------------------------------------------------------
# Manifest: frozen dims, vocab rules, stable ordering + hash.

def big_universe():
    """141 subtype candidates (Zebra on 10 cards beats 140 singletons)."""
    cards = []
    for i in range(140):
        zebra = " Zebra" if i < 10 else ""
        kw = "Flying" if i < 8 else ("Cascade" if i < 15 else "")
        cards.append(card(f"Card {i:03d}",
                          type_line=f"Creature — Sub{i:03d}{zebra}",
                          power="1", toughness="1", keywords=kw))
    return cards


def test_manifest_frozen_dims_and_vocab_rules(data_root):
    write_scryfall(big_universe())
    names = [f"Card {i:03d}" for i in range(140)]
    manifest = featurize.build_manifest({"TST": names})

    # Subtype vocab caps at 128, ranked by unique-card count then name.
    assert len(manifest["subtype_vocab"]) == 128
    assert manifest["subtype_vocab"] == (
        ["Zebra"] + [f"Sub{i:03d}" for i in range(127)])

    # Keyword vocab: >= 8 unique cards (Flying: 8 in, Cascade: 7 out).
    assert manifest["keyword_vocab"] == ["Flying"]
    assert manifest["keyword_min_cards"] == 8

    # The feature table is exactly 391 columns, in a stable order.
    columns = featurize.manifest_columns(manifest)
    assert len(columns) == 391 == manifest["n_features"]
    assert columns[0] == "cmc_scaled"
    assert columns[-1] == "flag_modal"
    assert columns.count("subtype_unmatched") == 1
    assert sum(c.startswith("subtype_") for c in columns) == 129
    assert sum(c.startswith("keyword_") for c in columns) == 167


def test_manifest_hash_is_stable_and_content_sensitive(data_root):
    write_scryfall(big_universe())
    names = [f"Card {i:03d}" for i in range(140)]
    a = featurize.build_manifest({"TST": names})
    b = featurize.build_manifest({"TST": names})
    assert a["content_hash"] == b["content_hash"]
    assert featurize.manifest_columns(a) == featurize.manifest_columns(b)

    # Dropping the Zebra cards changes the frozen vocab -> new hash.
    c = featurize.build_manifest({"TST": names[10:]})
    assert c["content_hash"] != a["content_hash"]


def test_manifest_refuses_eval_only_sets(data_root):
    write_scryfall([card("Some Card")])
    with pytest.raises(ValueError, match="EVAL_ONLY"):
        featurize.build_manifest({"MSH": ["Some Card"]})


def test_manifest_roundtrips_through_json(hand_universe, data_root):
    path = featurize.save_manifest(hand_universe)
    loaded = featurize.load_manifest(path)
    assert loaded == hand_universe
    assert featurize.content_hash(loaded) == loaded["content_hash"]


# ---------------------------------------------------------------------------
# Featurize: hand-built cards.

def test_x_spell(hand_universe):
    frame, _ = featurized(hand_universe, ["Blazing Torrent"])
    row = frame.loc["Blazing Torrent"]
    assert row["has_x"] == 1.0
    assert row["pip_r"] == 0.25
    assert row["pip_generic"] == 0.0
    assert row["cmc_is_1"] == 1.0 and row["cmc_scaled"] == 1 / 8
    assert row["type_instant"] == 1.0
    # No P/T on an instant -> missing indicators, not silent zeros-as-values.
    assert row["power_missing"] == 1.0 and row["toughness_missing"] == 1.0
    assert row["loyalty_missing"] == 1.0
    assert row["flag_damage"] == 1.0  # "deals X damage to"


def test_dfc_uses_front_face(hand_universe):
    frame, _ = featurized(hand_universe, ["Moon Howler"])
    row = frame.loc["Moon Howler"]
    # Front is a {1}{G} 2/2 — the 5/5 back must not leak into the numerics.
    assert row["cmc_is_2"] == 1.0 and row["cmc_scaled"] == 2 / 8
    assert row["power_scaled"] == 2 / 8 and row["toughness_scaled"] == 2 / 8
    assert row["color_g"] == 1.0 and row["is_colorless"] == 0.0
    assert row["layout_transform"] == 1.0
    assert row["has_back_face"] == 1.0 and row["back_is_land"] == 0.0
    # Front-face subtypes and text.
    assert row["flag_triggered"] == 1.0  # "At the beginning"
    assert row["flag_attack_trigger"] == 0.0  # back-face text excluded


def test_mdfc_land_back(hand_universe):
    frame, _ = featurized(hand_universe, ["Bright Hall"])
    row = frame.loc["Bright Hall"]
    assert row["layout_modal_dfc"] == 1.0
    assert row["has_back_face"] == 1.0 and row["back_is_land"] == 1.0
    assert row["color_w"] == 1.0
    assert row["type_land"] == 0.0  # front face is the creature


def test_power_star_creature(hand_universe):
    frame, _ = featurized(hand_universe, ["Formless Mass"])
    row = frame.loc["Formless Mass"]
    assert row["power_star"] == 1.0 and row["power_missing"] == 0.0
    assert row["power_scaled"] == 0.0
    assert row["toughness_scaled"] == 3 / 8 and row["toughness_star"] == 0.0
    # Text flags: trigger + ETB + draw + activated + mana ability; 2 lines.
    for flag in ["flag_triggered", "flag_etb", "flag_draw",
                 "flag_activated", "flag_mana_ability"]:
        assert row[flag] == 1.0, flag
    assert row["text_lines"] == pytest.approx(2 / 6)
    assert row["text_len"] > 0.0


def test_colorless_artifact(hand_universe):
    frame, _ = featurized(hand_universe, ["Steel Trinket"])
    row = frame.loc["Steel Trinket"]
    assert row["is_colorless"] == 1.0 and row["is_multicolor"] == 0.0
    assert row["n_colors"] == 0.0
    assert row["pip_generic"] == 2 / 8
    assert row["type_artifact"] == 1.0
    assert row["rarity_rare"] == 1.0 and row["rarity_common"] == 0.0
    assert row["flag_dig"] == 1.0  # Scry 1


def test_multicolor_hybrid_pips(hand_universe):
    frame, _ = featurized(hand_universe, ["Twinsoul Guard"])
    row = frame.loc["Twinsoul Guard"]
    assert row["pip_w"] == 2 / 4 and row["pip_u"] == 2 / 4
    assert row["n_hybrid"] == 2 / 4 and row["n_phyrexian"] == 0.0
    assert row["color_w"] == 1.0 and row["color_u"] == 1.0
    assert row["is_multicolor"] == 1.0
    assert row["n_colors"] == pytest.approx(2 / 3)
    # Keywords: Flying is in the vocab; Weirdworking is not (1 card < 8).
    flying_slot = hand_universe["keyword_vocab"].index("Flying")
    assert row[f"keyword_{flying_slot:03d}"] == 1.0
    assert row["keyword_unmatched"] == 1 / 4


def test_phyrexian_pip(hand_universe):
    frame, _ = featurized(hand_universe, ["Praetor's Edict"])
    row = frame.loc["Praetor's Edict"]
    assert row["n_phyrexian"] == 1 / 4 and row["n_hybrid"] == 0.0
    assert row["pip_b"] == 1 / 4 and row["pip_generic"] == 1 / 8
    assert row["rarity_mythic"] == 1.0
    assert row["flag_targeted_removal"] == 1.0


def test_unmatched_name_hard_fails(hand_universe):
    with pytest.raises(featurize.UnmatchedNamesError) as excinfo:
        featurize.featurize(["Blazing Torrent", "Not A Real Card"],
                            hand_universe)
    assert "Not A Real Card" in str(excinfo.value)
    assert excinfo.value.names == ["Not A Real Card"]


def test_printing_preference(data_root):
    """In-expansion beats newer printings; paper beats newer digital."""
    write_scryfall(
        [card("Dual Print", set_="tst", rarity="common"),
         card("Dual Print", set_="new", rarity="mythic"),
         card("Paper First", set_="old", rarity="uncommon"),
         card("Paper First", set_="dig", rarity="rare", digital=True)],
        released={"tst": "2023-01-01", "new": "2025-06-01",
                  "old": "2020-01-01", "dig": "2025-01-01"},
    )
    manifest = featurize.build_manifest({"TST": ["Dual Print", "Paper First"]})
    _, prov = featurize.featurize(
        ["Dual Print", "Paper First"], manifest,
        prefer_sets_by_name={"Dual Print": ["TST"], "Paper First": ["TST"]})
    by_name = {p["name"]: p for p in prov}
    assert by_name["Dual Print"]["set"] == "tst"
    assert by_name["Dual Print"]["in_expansion"] is True
    assert by_name["Paper First"]["set"] == "old"
    assert by_name["Paper First"]["digital"] is False


def test_digital_only_falls_back_to_newest_digital(data_root):
    write_scryfall(
        [card("Arena Only", set_="ydg", digital=True),
         card("Arena Only", set_="yol", digital=True)],
        released={"ydg": "2022-01-01", "yol": "2023-01-01"},
    )
    manifest = featurize.build_manifest({"TST": ["Arena Only"]})
    _, prov = featurize.featurize(["Arena Only"], manifest)
    assert prov[0]["set"] == "yol" and prov[0]["digital"] is True


def test_front_face_name_matches(hand_universe):
    """17Lands front-face names join to "A // B" Scryfall rows."""
    _, prov = featurize.featurize(["Moon Howler"], hand_universe)
    assert prov[0]["match"] == "front"
    _, prov = featurize.featurize(["Formless Mass"], hand_universe)
    assert prov[0]["match"] == "full"


# ---------------------------------------------------------------------------
# scripts/build_card_features.py end-to-end on the synthetic universe.

def _load_script():
    spec = importlib.util.spec_from_file_location(
        "build_card_features", SCRIPTS / "build_card_features.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _write_vocab(set_code, fmt, vocab_names):
    path = paths.vocab_path(set_code, fmt)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as fh:
        json.dump({"set": set_code, "format": fmt, "names": vocab_names}, fh)


def test_build_script_writes_features_manifest_meta(data_root, capsys):
    cards, faces = hand_cards()
    write_scryfall(cards, faces)
    _write_vocab("TST", "PremierDraft", HAND_NAMES[:5])
    _write_vocab("TST", "TradDraft", HAND_NAMES[3:])  # union across formats

    script = _load_script()
    script.main(["--sets", "TST"])

    manifest = featurize.load_manifest()
    assert manifest["training_sets"] == ["TST"]
    frame = pd.read_parquet(paths.CARDFEATS_PARQUET)
    assert len(frame) == len(HAND_NAMES)
    assert list(frame["gid"]) == list(range(len(HAND_NAMES)))
    assert list(frame["name_norm"]) == sorted(frame["name_norm"])
    assert frame.shape[1] == 391 + 10  # gid + provenance/key columns + features
    with open(paths.meta_path(paths.CARDFEATS_PARQUET)) as fh:
        meta = json.load(fh)
    assert meta["manifest_hash"] == manifest["content_hash"]
    assert meta["n_names"] == len(HAND_NAMES)
    assert meta["unmatched"] == 0
    assert meta["scryfall_cards_sha256"]
    assert f"{len(HAND_NAMES)} x 391" in capsys.readouterr().out


def test_build_script_hard_fails_on_unmatched(data_root, capsys):
    cards, faces = hand_cards()
    write_scryfall(cards, faces)
    _write_vocab("TST", "PremierDraft", HAND_NAMES + ["Ghost Card"])
    script = _load_script()
    with pytest.raises(SystemExit) as excinfo:
        script.main(["--sets", "TST"])
    assert excinfo.value.code == 2
    assert "Ghost Card" in capsys.readouterr().err
    assert not paths.CARDFEATS_PARQUET.exists()


def test_build_script_refuses_msh(data_root, capsys):
    script = _load_script()
    write_scryfall([card("Some Card")])
    _write_vocab("MSH", "PremierDraft", ["Some Card"])
    with pytest.raises(SystemExit) as excinfo:
        script.main(["--sets", "MSH"])
    assert excinfo.value.code == 2
    assert "EVAL_ONLY" in capsys.readouterr().err


def test_build_script_discovers_sets_from_disk(data_root):
    cards, faces = hand_cards()
    write_scryfall(cards, faces)
    _write_vocab("TST", "PremierDraft", HAND_NAMES)
    script = _load_script()
    assert script.discover_sets() == ["TST"]
    script.main([])  # default: every curated vocab on disk
    assert paths.CARDFEATS_PARQUET.exists()

"""mtga/lands/cardstore.py: name -> grpId resolution preferences."""

from _synth import ALIASES_A, CARD_A, CARD_B, CARD_C, CARD_D, SET
from mtga.lands import cardstore


def test_canonical_prefers_in_set_booster(card_store):
    canonical, aliases, attrs = cardstore.name_resolution(SET)
    # Lightning Bolt exists as in-set booster (101), in-set alt art
    # non-booster (201), and an out-of-set printing (301).
    assert canonical[CARD_A] == 101
    assert attrs[CARD_A] == {
        "rarity": "common", "color_identity": "R", "mana_value": 1.0,
    }


def test_aliases_include_all_grp_ids_sharing_the_name(card_store):
    _, aliases, _ = cardstore.name_resolution(SET)
    # Ordered by preference: in-set booster, in-set non-booster, out-of-set.
    assert aliases[CARD_A] == ALIASES_A == [101, 201, 301]
    assert aliases[CARD_D] == [104]


def test_in_set_non_booster_beats_out_of_set_booster(card_store):
    canonical, aliases, _ = cardstore.name_resolution(SET)
    # "Alt Only" has no in-set booster row; the in-set non-booster printing
    # (501) must still win over the out-of-set booster one (502).
    assert canonical["Alt Only"] == 501
    assert aliases["Alt Only"] == [501, 502]


def test_bonus_sheet_name_resolves_via_global_fallback(card_store):
    canonical, aliases, attrs = cardstore.name_resolution(SET)
    # "Bonus Blast" was never printed under TST; the out-of-set row is the
    # only candidate and must still resolve (bonus sheets in real data).
    assert canonical["Bonus Blast"] == 401
    assert aliases["Bonus Blast"] == [401]
    assert attrs["Bonus Blast"]["rarity"] == "rare"


def test_resolution_covers_tricky_names(card_store):
    canonical, _, _ = cardstore.name_resolution(SET)
    assert canonical[CARD_B] == 102  # comma
    assert canonical[CARD_C] == 103  # embedded double quote
    assert canonical[CARD_D] == 104  # apostrophe

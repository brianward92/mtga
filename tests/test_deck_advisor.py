"""mtga/deck_advisor.py: castability, land apportionment, cuts, synergy.

The concrete numbers come from a real MSH Premier draft (2026-07-30) whose
submitted deck the pick model would have advised badly: it recommended two
uncastable multicolor cards and undervalued a hybrid-cost artifact creature.
"""

import pytest

from mtga.deck_advisor import (
    advise,
    cost_pip_tokens,
    cut_candidates,
    deck_colors,
    is_castable,
    mana_curve,
    pip_weights,
    recommend_lands,
    synergy_notes,
    synergy_tags,
)


def card(name, cost, tline="Creature — Hero", text="", **kw):
    return {
        "name": name,
        "mana_cost": cost,
        "type_line": tline,
        "oracle_text": text,
        **kw,
    }


# --- castability -------------------------------------------------------------


class TestCastability:
    def test_hybrid_pip_is_payable_from_either_half(self):
        # War Machine, Legacy of Iron — castable in mono-red despite RW colors.
        assert is_castable("{2}{R/W}", {"R"})
        assert is_castable("{2}{R/W}", {"W"})
        assert not is_castable("{2}{R/W}", {"U"})

    def test_multicolor_requires_every_color(self):
        # Thanos, the Mad Titan — the model's top pick into a UR pool.
        assert not is_castable("{R}{W}{B}", {"U", "R"})
        assert is_castable("{R}{W}{B}", {"R", "W", "B"})

    def test_gold_card_in_exactly_its_colors(self):
        assert is_castable("{2}{U}{R}", {"U", "R"})  # Iron Man
        assert not is_castable("{2}{U}{R}", {"R"})

    def test_generic_x_and_colorless_carry_no_requirement(self):
        assert is_castable("{2}", set())
        assert is_castable("{X}{C}", set())
        assert is_castable("", set())
        assert is_castable(None, set())

    def test_off_color_single_pip(self):
        assert not is_castable("{1}{G}", {"U", "R"})  # Shang-Chi

    def test_pip_tokens_omit_colorless_and_generic(self):
        assert cost_pip_tokens("{3}{R}{R}") == [{"R"}, {"R"}]
        assert cost_pip_tokens("{2}{R/W}") == [{"R", "W"}]
        assert cost_pip_tokens("{X}{2}{C}") == []


# --- pip weight and colors ---------------------------------------------------


class TestColors:
    def test_pip_weight_counts_each_hybrid_half(self):
        weights = pip_weights([card("hybrid", "{2}{R/W}")])
        assert weights["R"] == 1 and weights["W"] == 1

    def test_quantity_multiplies_pips(self):
        weights = pip_weights([card("x", "{R}", quantity=3)])
        assert weights["R"] == 3

    def test_deck_colors_picks_the_two_heaviest(self):
        cards = [card("a", "{R}"), card("b", "{R}"), card("c", "{U}"), card("d", "{G}")]
        assert deck_colors(cards) == ["R", "U"]

    def test_ties_break_in_wubrg_order(self):
        assert deck_colors([card("a", "{R}"), card("b", "{U}")]) == ["U", "R"]


# --- land split --------------------------------------------------------------


class TestLandSplit:
    def test_split_follows_pip_weight_not_card_count(self):
        """The real bug this exists to catch: 16 lands split 8/8 for a deck
        whose pips were 24 R to 11 U."""
        spells = [card(f"r{i}", "{R}") for i in range(24)]
        spells += [card(f"u{i}", "{U}") for i in range(11)]
        lands = recommend_lands(spells, 16)
        assert lands["Mountain"] == 11
        assert lands["Island"] == 5
        assert sum(lands.values()) == 16

    def test_counts_always_sum_to_the_slot_count(self):
        spells = [card("a", "{R}")] * 7 + [card("b", "{U}")] * 3
        for slots in range(2, 19):
            lands = recommend_lands(spells, slots)
            assert sum(lands.values()) == slots

    def test_every_color_keeps_at_least_one_source(self):
        spells = [card(f"r{i}", "{R}") for i in range(30)] + [card("u", "{U}")]
        lands = recommend_lands(spells, 17)
        assert lands["Island"] >= 1

    def test_colorless_deck_splits_evenly(self):
        lands = recommend_lands([card("a", "{2}")], 6, colors=["R", "U"])
        assert lands == {"Mountain": 3, "Island": 3}

    def test_no_slots_yields_no_lands(self):
        assert recommend_lands([card("a", "{R}")], 0) == {}


# --- curve -------------------------------------------------------------------


def test_mana_curve_uses_front_face_mana_value():
    curve = mana_curve(
        [card("a", "{1}{R}"), card("b", "{3}{R}{R}"), card("c", "{1}{R}")]
    )
    assert curve == {2: 2, 5: 1}


# --- synergy -----------------------------------------------------------------


class TestSynergy:
    def test_landcycling_detected(self):
        # Kree Sentinel: {4}{R} 5-drop that can instead fetch a basic for {2}.
        assert "landcycling" in synergy_tags("Reach\nBasic landcycling {2}")

    def test_noncreature_payoff_detected(self):
        text = "Whenever you cast a noncreature spell, Thor deals damage..."
        assert "noncreature_payoff" in synergy_tags(text)

    def test_artifact_payoff_detected(self):
        text = "Iron Man gets +1/+0 for each other artifact you control."
        assert "artifact_payoff" in synergy_tags(text)

    def test_single_card_theme_is_not_reported_as_a_deck_theme(self):
        notes = synergy_notes(
            [
                card(
                    "Thor",
                    "{3}{R}{R}",
                    text="Whenever you cast a noncreature spell, deal damage.",
                ),
                card("Bear", "{2}{G}", text="Vanilla."),
            ]
        )
        assert "noncreature_payoff" not in notes

    def test_two_cards_make_a_theme(self):
        notes = synergy_notes(
            [
                card(
                    "Thor",
                    "{3}{R}{R}",
                    text="Whenever you cast a noncreature spell, deal damage.",
                ),
                card(
                    "Plan",
                    "{2}{R}",
                    text="Whenever you cast a noncreature spell, create Treasure.",
                ),
            ]
        )
        assert "noncreature_payoff" in notes
        assert sorted(notes["noncreature_payoff"]["cards"]) == ["Plan", "Thor"]

    def test_landcycling_reported_even_as_a_single_card(self):
        notes = synergy_notes([card("Kree", "{4}{R}", text="Basic landcycling {2}")])
        assert "landcycling" in notes


# --- cuts --------------------------------------------------------------------


class TestCuts:
    def test_cuts_the_lowest_win_rate_first(self):
        spells = [
            card("good", "{1}{R}", gih_wr=0.58),
            card("bad", "{4}{R}", gih_wr=0.52),
            card("mid", "{2}{R}", gih_wr=0.55),
        ]
        cuts = cut_candidates(spells, target=2)
        assert [c["name"] for c in cuts] == ["bad"]

    def test_landcycling_card_is_protected_from_a_mana_value_cut(self):
        """Brian's correction during the draft: a 5-drop that cycles for a land
        is not the same as a clunky 5-drop."""
        spells = [
            card("cycler", "{4}{R}", text="Basic landcycling {2}", gih_wr=0.52),
            card("clunker", "{5}{R}", gih_wr=0.52),
            card("keep", "{1}{R}", gih_wr=0.58),
        ]
        cuts = cut_candidates(spells, target=2)
        assert [c["name"] for c in cuts] == ["clunker"]

    def test_alsa_stands_in_when_win_rate_is_missing(self):
        spells = [
            card("late", "{2}{R}", alsa=8.8),  # table passes it
            card("early", "{2}{R}", alsa=3.1),
        ]
        cuts = cut_candidates(spells, target=1)
        assert [c["name"] for c in cuts] == ["late"]

    def test_nothing_to_cut_when_at_or_under_target(self):
        assert cut_candidates([card("a", "{R}")], target=5) == []

    def test_cut_count_matches_the_overage(self):
        spells = [card(f"c{i}", "{R}", gih_wr=0.50 + i / 100) for i in range(8)]
        cuts = cut_candidates(spells, target=5)
        assert sum(c["cut_quantity"] for c in cuts) == 3


# --- end to end --------------------------------------------------------------


def test_advise_on_the_real_msh_deck():
    """The 41-card UR artifacts deck submitted on 2026-07-30."""
    deck = [
        card(
            "Thor, God of Thunder",
            "{3}{R}{R}",
            "Legendary Creature — God",
            "Flying\nWhenever you cast a noncreature spell, Thor deals damage "
            "equal to that spell's mana value to any target.",
        ),
        card("Mjolnir, Hammer of Thor", "{3}{R}", "Legendary Artifact — Equipment"),
        card(
            "The Scarlet Witch",
            "{2}{R}",
            "Legendary Creature — Mutant",
            "Instant and sorcery spells you cast with mana value 4 or greater "
            "cost {X} less to cast.",
        ),
        card(
            "Death to Our Enemies",
            "{2}{R}",
            "Enchantment — Plan",
            "Whenever you cast a noncreature spell, create a tapped Treasure.",
        ),
        card(
            "Iron Man, Master of Machines",
            "{2}{U}{R}",
            "Legendary Artifact Creature — Human",
            "Iron Man gets +1/+0 for each other artifact you control.",
        ),
        card(
            "War Machine, Legacy of Iron",
            "{2}{R/W}",
            "Legendary Artifact Creature — Human",
        ),
        card(
            "Kree Sentinel",
            "{4}{R}",
            "Artifact Creature — Kree Robot",
            "Reach\nBasic landcycling {2}",
            gih_wr=0.522,
        ),
        card(
            "Lightning Strike",
            "{1}{R}",
            "Instant",
            "deals 3 damage to any target",
            gih_wr=0.543,
        ),
        card(
            "Futurist Forge",
            "{1}{U}",
            "Artifact",
            "When this artifact enters, draw a card.",
            gih_wr=0.568,
        ),
        card("Aerial Doombot", "{U}", "Artifact Creature — Robot", gih_wr=0.576),
        card(
            "Falcon, Winged Wonder",
            "{4}{U}",
            "Legendary Creature — Human",
            gih_wr=0.567,
        ),
        card("Villainous Hideout", "", "Land", "{T}: Add {C}."),
        card("Shang-Chi, Master of Kung Fu", "{1}{G}", "Legendary Creature"),
    ]

    result = advise(deck, deck_size=41, land_slots=17)

    # Red-primary UR, from pips rather than card count
    assert result["colors"] == ["R", "U"]
    assert result["lands"]["Mountain"] > result["lands"]["Island"]
    # Villainous Hideout is a nonbasic land and eats one of the 17 slots
    assert sum(result["lands"].values()) == 16
    assert result["nonbasic_lands"] == ["Villainous Hideout"]
    # The off-color green mythic is flagged, not silently ranked
    assert result["uncastable"] == ["Shang-Chi, Master of Kung Fu"]
    # The hybrid artifact creature is a playable, not a cut
    assert "War Machine, Legacy of Iron" not in result["uncastable"]
    # Both real synergies surface
    assert "noncreature_payoff" in result["synergies"]
    assert "landcycling" in result["synergies"]


def test_advise_handles_an_empty_deck():
    result = advise([], deck_size=40, land_slots=17)
    assert result["colors"] == []
    assert result["cuts"] == []
    assert result["lands"] == {}


@pytest.mark.parametrize("land_slots", [16, 17, 18])
def test_advise_land_total_is_respected(land_slots):
    deck = [card(f"r{i}", "{R}") for i in range(12)]
    deck += [card(f"u{i}", "{U}") for i in range(6)]
    result = advise(deck, deck_size=40, land_slots=land_slots)
    assert sum(result["lands"].values()) == land_slots

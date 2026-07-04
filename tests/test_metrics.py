"""mtga/lands/metrics.py: shrinkage math and the win-rate/ALSA pipeline."""

import numpy as np
import pandas as pd
import pytest

import _synth
from _synth import CARD_A, CARD_B, CARD_C, CARD_D, FMT, SET, VOCAB
from mtga.lands import etl, metrics, paths


# -- shrink() ---------------------------------------------------------------


def test_shrink_fixed_prior_exact():
    # p0 = (30+2)/(50+4) = 16/27; with m=100:
    #   card0 = (30 + 100*16/27) / (50+100) = 2410/4050
    #   card1 = ( 2 + 100*16/27) / ( 4+100) = 1654/2808
    shrunk, p0, m = metrics.shrink([30, 2], [50, 4], prior_strength=100)
    assert m == 100.0
    assert p0 == pytest.approx(16 / 27)
    assert shrunk[0] == pytest.approx(2410 / 4050)
    assert shrunk[1] == pytest.approx(1654 / 2808)
    # Shrinkage pulls the tiny sample much closer to p0 than the raw rate.
    assert abs(shrunk[1] - p0) < abs(2 / 4 - p0)


def test_shrink_method_of_moments_clamps_high():
    # 10 identical cards -> observed variance 0 -> tau2 floors at 1e-6 ->
    # m explodes and must clamp to SHRINK_CLAMP[1] = 1000.
    wins = [500] * 10
    games = [1000] * 10
    shrunk, p0, m = metrics.shrink(wins, games)
    assert p0 == 0.5
    assert m == metrics.SHRINK_CLAMP[1] == 1000.0
    np.testing.assert_allclose(shrunk, 0.5)


def test_shrink_method_of_moments_clamps_low():
    # Rates 0.2/0.8 -> var_obs = 0.09, var_samp = 0.25/1000, so
    # m_raw = 0.25 / (0.09 - 0.00025) ~= 2.79 -> clamps to 100.
    wins = [200] * 5 + [800] * 5
    games = [1000] * 10
    _, p0, m = metrics.shrink(wins, games)
    assert p0 == 0.5
    assert m == metrics.SHRINK_CLAMP[0] == 100.0


def test_shrink_too_few_trusted_cards_uses_max_prior():
    # Fewer than 10 cards with games >= SHRINK_MIN_N -> m = clamp max.
    shrunk, p0, m = metrics.shrink([1], [2])
    assert p0 == 0.5
    assert m == 1000.0
    assert shrunk[0] == pytest.approx((1 + 1000 * 0.5) / (2 + 1000))


def test_shrink_zero_games_defaults_p0():
    shrunk, p0, _ = metrics.shrink([0, 0], [0, 0], prior_strength=50)
    assert p0 == 0.5
    np.testing.assert_allclose(shrunk, 0.5)  # (0 + m*p0)/(0 + m) == p0


# -- game_card_metrics ------------------------------------------------------


def test_game_card_metrics_hand_computed(curated_game):
    frame = metrics.game_card_metrics(SET, FMT, prior_strength=100)
    assert list(frame["name"]) == VOCAB  # parquet column order == CSV order
    row = frame.set_index("name")

    # Card A (see _synth.hand_game_rows for the derivation):
    a = row.loc[CARD_A]
    assert a["gp_games"] == 5 and a["gp_wr"] == pytest.approx(0.6)
    assert a["oh_games"] == 2 and a["oh_wr"] == pytest.approx(0.5)
    assert a["gd_games"] == 2 and a["gd_wr"] == pytest.approx(0.5)
    assert a["gih_games"] == 3 and a["gih_wr"] == pytest.approx(2 / 3)
    assert a["gns_games"] == 2 and a["gns_wr"] == pytest.approx(0.5)
    assert a["iwd"] == pytest.approx(2 / 3 - 1 / 2)

    b = row.loc[CARD_B]
    assert b["gih_games"] == 4 and b["gih_wr"] == pytest.approx(0.75)
    assert b["gns_games"] == 2 and b["gns_wr"] == pytest.approx(0.5)
    assert b["iwd"] == pytest.approx(0.25)
    assert b["gd_games"] == 0 and pd.isna(b["gd_wr"])  # never drawn

    # C was in one deck and never seen: GNS only, GIH undefined.
    c = row.loc[CARD_C]
    assert c["gih_games"] == 0 and pd.isna(c["gih_wr"])
    assert c["gns_games"] == 1 and c["gns_wr"] == pytest.approx(1.0)
    assert pd.isna(c["iwd"])

    # GIH pooled: wins 2+3=5 over games 3+4=7 -> p0 = 5/7, m fixed at 100.
    assert frame.attrs["gih_prior"]["p0"] == pytest.approx(5 / 7)
    assert frame.attrs["gih_prior"]["m"] == 100.0
    # Shrunk GIH: A = (2 + 100*5/7)/103 = 514/721; B = (3 + 500/7)/104.
    assert a["gih_wr_shrunk"] == pytest.approx(514 / 721)
    assert b["gih_wr_shrunk"] == pytest.approx(521 / 728)
    # D never appeared: 0 games everywhere, shrunk collapses to p0 exactly.
    d = row.loc[CARD_D]
    assert d["gih_games"] == 0 and pd.isna(d["gih_wr"])
    assert d["gih_wr_shrunk"] == pytest.approx(5 / 7)


# -- draft_card_metrics -----------------------------------------------------

EXPECTED_ATA = {CARD_A: 1.5, CARD_B: 1.5, CARD_C: 3.5, CARD_D: 3.5}
EXPECTED_ALSA = {CARD_A: 1.5, CARD_B: 1.5, CARD_C: 3.5, CARD_D: 3.5}


def _assert_draft_metrics(frame):
    assert list(frame["name"]) == VOCAB
    row = frame.set_index("name")
    for name in VOCAB:
        assert row.loc[name, "ata"] == pytest.approx(EXPECTED_ATA[name]), name
        assert row.loc[name, "alsa"] == pytest.approx(EXPECTED_ALSA[name]), name
        assert row.loc[name, "pick_count"] == 2
        # d3's all-zero pack row contributes to no card's last-seen groups.
        assert row.loc[name, "seen_count"] == 2


def test_draft_card_metrics_zero_indexed_picks(curated_draft):
    # Raw data is 0-indexed (min pick_number == 0) -> offset +1 applies to
    # both ATA and ALSA. E.g. A picked at picks 0 and 1 -> ATA 0.5+1 = 1.5;
    # A last seen at pick 0 (d1) and pick 1 (d2) -> ALSA (1+2)/2 = 1.5.
    _assert_draft_metrics(metrics.draft_card_metrics(SET, FMT))


def test_draft_card_metrics_one_indexed_picks(data_root):
    # Same drafts written 1-indexed: offset must be 0 and results identical.
    fmt = "TradDraft"
    dest = paths.raw_dataset_path("draft", SET, fmt)
    _synth.write_draft_csv(dest, _synth.hand_draft_rows(pick_base=1))
    assert etl.curate_draft(SET, fmt)["status"] == "CURATED"
    _assert_draft_metrics(metrics.draft_card_metrics(SET, fmt))


# -- color_metrics / build_metrics ------------------------------------------


def test_build_metrics_end_to_end(curated_draft, curated_game, card_store):
    cards, colors = metrics.build_metrics(
        SET, FMT, prior_strength=100, as_of="2026-01-02"
    )

    assert len(cards) == 4
    a = cards.set_index("name").loc[CARD_A]
    assert a["grp_id"] == 101  # canonical in-set booster printing
    assert a["rarity"] == "common"
    assert a["color_identity"] == "R"
    assert a["gih_wr"] == pytest.approx(2 / 3)  # game side of the merge
    assert a["ata"] == pytest.approx(1.5)  # draft side of the merge

    out = paths.metrics_cards_path(SET, FMT, "2026-01-02")
    assert out.exists()
    link = paths.latest_symlink(out, prefix="cards_")
    assert link.is_symlink() and link.resolve() == out.resolve()

    # Colors: WU played 4 games with 3 wins, BR 2 games 1 win.
    colors = colors.set_index("main_colors")
    assert colors.loc["WU", "games"] == 4 and colors.loc["WU", "wins"] == 3
    assert colors.loc["WU", "wr"] == pytest.approx(0.75)
    assert colors.loc["BR", "wr"] == pytest.approx(0.5)
    # Shrunk toward p0 = 4/6: WU = (3 + 100*2/3)/104.
    assert colors.loc["WU", "wr_shrunk"] == pytest.approx((3 + 200 / 3) / 104)
    assert paths.latest_symlink(
        paths.metrics_colors_path(SET, FMT, "2026-01-02"), prefix="colors_"
    ).exists()

    reloaded = metrics.load_latest_metrics(SET, FMT)
    assert list(reloaded["name"]) == list(cards["name"])

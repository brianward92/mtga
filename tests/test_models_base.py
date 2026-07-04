"""mtga/models/base.py: rank_scores ordering, probs, and unknown handling."""

import math

import pytest

from mtga.models.base import rank_scores


def test_orders_descending_by_ev():
    scores = rank_scores([1, 2, 3], [0.5, 2.0, -1.0])
    assert [s.grp_id for s in scores] == [2, 1, 3]
    assert [s.rank for s in scores] == [1, 2, 3]


def test_probs_are_softmax_over_known_evs():
    scores = rank_scores([1, 2], [0.5, 2.0])
    by_grp = {s.grp_id: s for s in scores}
    # softmax([0.5, 2.0]): p(2) = 1 / (1 + e^-1.5)
    assert by_grp[2].prob == pytest.approx(1 / (1 + math.exp(-1.5)))
    assert by_grp[1].prob == pytest.approx(math.exp(-1.5) / (1 + math.exp(-1.5)))
    assert sum(s.prob for s in scores) == pytest.approx(1.0)


def test_none_evs_sort_last_with_none_prob():
    scores = rank_scores([7, 8, 9], [None, 1.0, None])
    assert [s.grp_id for s in scores] == [8, 7, 9]  # Nones keep input order
    known = scores[0]
    assert known.prob == pytest.approx(1.0)  # softmax over the single known ev
    for unknown in scores[1:]:
        assert unknown.ev is None
        assert unknown.prob is None
    assert [s.rank for s in scores] == [1, 2, 3]


def test_all_unknown_pack():
    scores = rank_scores([5, 6], [None, None])
    assert [s.grp_id for s in scores] == [5, 6]
    assert all(s.prob is None for s in scores)


def test_single_card_pack():
    (score,) = rank_scores([42], [0.0])
    assert score.rank == 1
    assert score.prob == pytest.approx(1.0)


def test_negative_evs_rank_above_none():
    scores = rank_scores([1, 2], [-5.0, None])
    assert [s.grp_id for s in scores] == [1, 2]
    assert scores[0].prob == pytest.approx(1.0)

"""Frozen-protocol metric tests (mtga/foundation/evalproto.py).

These tests pin the exact semantics of every number in the paper. If the
protocol module changes behavior, these fail — and the eval-protocol tag
check in run_frozen_eval.py refuses to run regardless.
"""

import numpy as np
import pandas as pd
import pytest

from mtga.foundation import evalproto


def frame_from(rows):
    columns = ["draft_id", "pack_number", "pick_number", "pack_size",
               "wr_bucket", "n_games_bucket", "target_rank", "pick_prob",
               "top_prob"]
    return pd.DataFrame(rows, columns=columns)


@pytest.fixture
def small():
    # 2 drafts x 3 picks. Draft a: ranks 1,1,2 -> 2/3 top1. Draft b: 1,3,4.
    return frame_from([
        ("a", 0, 0, 14, 0.60, 500, 1, 0.50, 0.50),
        ("a", 0, 1, 13, 0.60, 500, 1, 0.40, 0.40),
        ("a", 0, 2, 12, 0.60, 500, 2, 0.20, 0.30),
        ("b", 0, 0, 14, 0.50, 10, 1, 0.25, 0.25),
        ("b", 0, 1, 13, 0.50, 10, 3, 0.10, 0.60),
        ("b", 1, 0, 14, 0.50, 10, 4, 0.05, 0.80),
    ])


def test_point_stats(small):
    assert evalproto.top1(small) == pytest.approx(3 / 6)
    assert evalproto.topk(small, 3) == pytest.approx(5 / 6)
    # log_loss = -mean(log(pick_prob)), hand-computed
    expected = -np.mean(np.log([0.50, 0.40, 0.20, 0.25, 0.10, 0.05]))
    assert evalproto.log_loss(small) == pytest.approx(expected)


def test_expert_slice_filters_both_buckets(small):
    experts = evalproto.expert_slice(small)
    assert set(experts["draft_id"]) == {"a"}  # b: wr 0.50 and games 10 both fail


def test_forced_pick_variant():
    frame = frame_from([
        ("a", 0, 12, 2, 0.6, 500, 2, 0.4, 0.6),
        ("a", 0, 13, 1, 0.6, 500, 1, 1.0, 1.0),  # forced: always "correct"
    ])
    assert evalproto.top1(frame) == pytest.approx(0.5)
    assert evalproto.top1(evalproto.non_forced(frame)) == pytest.approx(0.0)


def test_ece_perfectly_calibrated_and_not():
    # Perfect: confidence == long-run accuracy within each bin.
    rng = np.random.default_rng(7)
    n = 30000
    conf = rng.uniform(0.2, 0.9, n)
    correct = rng.uniform(size=n) < conf
    frame = frame_from([
        (f"d{i}", 0, 0, 14, 0.6, 500, 1 if correct[i] else 2, 0.5, conf[i])
        for i in range(n)
    ])
    assert evalproto.ece(frame) < 0.01
    # Maximally overconfident: conf 1.0, accuracy 0 -> ECE 1.0.
    bad = frame_from([("d", 0, 0, 14, 0.6, 500, 2, 0.0001, 1.0)] * 100)
    assert evalproto.ece(bad) == pytest.approx(1.0)


def test_cluster_bootstrap_deterministic_and_sane(small):
    point, lo, hi = evalproto.cluster_bootstrap(small, evalproto.top1, b=200)
    point2, lo2, hi2 = evalproto.cluster_bootstrap(small, evalproto.top1, b=200)
    assert (point, lo, hi) == (point2, lo2, hi2)  # deterministic under seed
    assert point == pytest.approx(0.5)
    assert lo <= point <= hi
    # With 2 very different drafts (2/3 vs 1/3), draft resampling must
    # produce a wide interval touching both extremes.
    assert lo <= 1 / 3 + 1e-9 and hi >= 2 / 3 - 1e-9


def test_paired_bootstrap_identical_frames_gives_zero(small):
    point, lo, hi = evalproto.paired_bootstrap_diff(
        small, small.copy(), evalproto.top1, b=100
    )
    assert point == 0.0 and lo == 0.0 and hi == 0.0


def test_paired_bootstrap_constant_difference():
    # B is A with every rank degraded so top1 differs by exactly 0.5 in
    # every draft -> the paired difference is 0.5 with zero variance.
    rows_a, rows_b = [], []
    for d in "abcde":
        rows_a += [(d, 0, 0, 14, 0.6, 500, 1, 0.5, 0.5),
                   (d, 0, 1, 13, 0.6, 500, 1, 0.5, 0.5)]
        rows_b += [(d, 0, 0, 14, 0.6, 500, 1, 0.5, 0.5),
                   (d, 0, 1, 13, 0.6, 500, 2, 0.2, 0.5)]
    point, lo, hi = evalproto.paired_bootstrap_diff(
        frame_from(rows_a), frame_from(rows_b), evalproto.top1, b=100
    )
    assert point == pytest.approx(0.5)
    assert lo == pytest.approx(0.5) and hi == pytest.approx(0.5)


def test_icc_extremes():
    # All drafts identical accuracy -> ICC ~ 0.
    rng = np.random.default_rng(3)
    rows = []
    for d in range(200):
        for p in range(10):
            rows.append((f"d{d}", 0, p, 14, 0.6, 500,
                         1 if rng.uniform() < 0.5 else 2, 0.5, 0.5))
    assert evalproto.intraclass_correlation(frame_from(rows)) < 0.02
    # Perfectly clustered: half the drafts always right, half always wrong.
    rows = []
    for d in range(100):
        correct = d < 50
        for p in range(10):
            rows.append((f"d{d}", 0, p, 14, 0.6, 500,
                         1 if correct else 2, 0.5, 0.5))
    assert evalproto.intraclass_correlation(frame_from(rows)) > 0.95


def test_per_pick_curve_and_alignment(small):
    curve = evalproto.per_pick_curve(small)
    cell = curve[(curve["pack_number"] == 0) & (curve["pick_number"] == 0)]
    assert cell["top1"].iloc[0] == pytest.approx(1.0)  # both drafts rank 1
    assert cell["random_floor"].iloc[0] == pytest.approx(1 / 14)

    a, b = evalproto.align_on_picks(small, small.iloc[:3])
    assert len(a) == len(b) == 3


def test_summarize_reports_non_forced_calibration():
    """T3.7: summarize exposes non-forced ECE and log-loss alongside the
    non-forced top-1. Forced picks (pack_size == 1) are scored trivially --
    lone candidate, confidence 1.0 -- which deflates both calibration
    numbers, so the non-forced variants must be strictly worse here."""
    rows = []
    for d in range(50):
        # a genuine choice the model gets wrong at high confidence
        rows.append((f"d{d}", 0, 0, 10, 0.6, 500, 3, 0.05, 0.9))
        # a forced pick: lone candidate, trivially "correct", confidence 1.0
        rows.append((f"d{d}", 0, 13, 1, 0.6, 500, 1, 1.0, 1.0))
    result = evalproto.summarize(frame_from(rows), "mixed")
    for key in ["top1", "top1_ci", "top3", "top3_ci", "log_loss",
                "log_loss_ci", "ece", "top1_non_forced",
                "log_loss_non_forced", "ece_non_forced"]:
        assert key in result, f"summarize missing {key}"
    nf = evalproto.non_forced(frame_from(rows))
    assert result["top1_non_forced"] == pytest.approx(evalproto.top1(nf))
    assert result["log_loss_non_forced"] == pytest.approx(evalproto.log_loss(nf))
    assert result["ece_non_forced"] == pytest.approx(evalproto.ece(nf))
    # forced picks mask the model's real (poor) performance and calibration
    assert result["top1_non_forced"] < result["top1"]
    assert result["ece_non_forced"] > result["ece"]
    assert result["log_loss_non_forced"] > result["log_loss"]


def test_summarize_non_forced_nan_when_all_forced():
    """All-forced frame: non-forced variants are NaN, not a crash."""
    frame = frame_from([("a", 0, 13, 1, 0.6, 500, 1, 1.0, 1.0)])
    result = evalproto.summarize(frame, "forced-only")
    assert np.isnan(result["top1_non_forced"])
    assert np.isnan(result["log_loss_non_forced"])
    assert np.isnan(result["ece_non_forced"])


def test_validate_rejects_missing_columns(small):
    with pytest.raises(ValueError):
        evalproto.validate(small.drop(columns=["top_prob"]))
    assert evalproto.validate(small) is small

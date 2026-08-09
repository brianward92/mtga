"""Win-probability v1/v2 (mtga/winprob): data assembly, metrics, train, economics.

Hand-computed expectations follow _synth.hand_replay_games (12 turn rows over
6 games; rg0 is a clean on-play win with a 3-turn trajectory) and the
_synth.winprob_training_games fixture for the training/economics smoke.

v2 (cross-set) coverage reuses the SAME winprob_training_games generator for
a second synthetic set code (SET2) so multi-set loading has two curated
files to concatenate; the two "sets" share a game generator (not a
statistically distinct distribution) because these tests exercise the
PLUMBING (concatenation, set tagging, row capping, split uniqueness,
zero-shot scoring, persistence) rather than a real cross-set generalization
result -- that comes from the actual training run over real 17Lands data.
"""

import json

import numpy as np
import pytest

import _synth
from mtga.lands import paths
from mtga.models.draftnet import split_by_draft
from mtga.winprob import data as wdata
from mtga.winprob import economics
from mtga.winprob import train as wtrain
from mtga.winprob.model import WinProbNet, predict_proba

SET2 = "TS2"  # second synthetic set code for v2 multi-set coverage


@pytest.fixture
def winprob_hand_data(replay_raw):
    """WinProbData over the six hand-computed replay games (12 turn rows)."""
    from mtga.replay import etl

    assert etl.curate_turn_states(_synth.SET, _synth.FMT)["status"] == "CURATED"
    return wdata.load_dataset(_synth.SET, _synth.FMT)


@pytest.fixture
def winprob_training_data(data_root):
    """Curated multi-turn fixture with a healthy crc32 split at permille 500."""
    dest = paths.raw_dataset_path("replay", _synth.SET, _synth.FMT)
    _synth.write_replay_csv(
        dest, games=_synth.winprob_training_games(), turn_cols=_synth.WINPROB_TURN_COLS
    )
    from mtga.replay import etl

    assert etl.curate_turn_states(_synth.SET, _synth.FMT)["status"] == "CURATED"
    return dest


@pytest.fixture
def winprob_multiset_raw(data_root):
    """Two curated sets (_synth.SET, SET2) for v2 multi-set loading tests.

    Both curated from the same winprob_training_games() generator (60 games,
    turn counts 3..11, draft_ids "wp00".."wp59" on BOTH sets) so load_many's
    set-code draft_id prefixing is exercised against a real collision, not
    just a hypothetical one. Returns the set-code list in a fixed order.
    """
    from mtga.replay import etl

    sets = [_synth.SET, SET2]
    for set_code in sets:
        dest = paths.raw_dataset_path("replay", set_code, _synth.FMT)
        _synth.write_replay_csv(
            dest,
            games=_synth.winprob_training_games(),
            turn_cols=_synth.WINPROB_TURN_COLS,
        )
        assert etl.curate_turn_states(set_code, _synth.FMT)["status"] == "CURATED"
    return sets


# ---------------------------------------------------------------------------
# Data assembly.


def test_features_layout():
    assert len(wdata.FEATURES) == 25
    for needed in [
        "turn",
        "life_diff",
        "user_hand_count",
        "user_drawn_cum",
        "library_approx",
        "user_wr_bucket",
        "num_mulligans",
    ]:
        assert needed in wdata.FEATURES


def test_cumulative_within_games():
    new_game = np.array([True, False, False, True, True, False])
    values = np.array([0, 1, 1, 5, 2, 0], dtype=np.int64)
    cum = wdata._cumulative_within_games(values, new_game)
    assert cum.tolist() == [0, 1, 2, 5, 2, 2]


def test_verify_row_order():
    gs = np.array([0, 0, 1, 1, 1])
    turn = np.array([1, 2, 1, 2, 3])
    new_game = wdata._verify_row_order(gs, turn)
    assert new_game.tolist() == [True, False, True, False, False]

    with pytest.raises(ValueError, match="game-contiguous"):
        wdata._verify_row_order(np.array([1, 0]), np.array([1, 1]))
    with pytest.raises(ValueError, match="start at turn 1"):
        wdata._verify_row_order(np.array([0, 0]), np.array([2, 3]))
    with pytest.raises(ValueError, match="increment by 1"):
        wdata._verify_row_order(np.array([0, 0]), np.array([1, 3]))


def test_load_dataset_hand_computed(winprob_hand_data):
    data = winprob_hand_data
    assert data.n_rows == 12 and data.n_games == 6
    assert data.X.shape == (12, 25) and data.X.dtype == np.float32

    # rg0 (game_seq 0), turn 2: on play, ahead by 2 life, drew one card.
    idx = int(np.flatnonzero((data.game_seq == 0) & (data.turn == 2))[0])
    row = dict(zip(wdata.FEATURES, data.X[idx]))
    assert row["turn"] == 2 and row["on_play"] == 1.0
    assert (row["user_life"], row["oppo_life"], row["life_diff"]) == (20, 18, 2)
    assert (row["user_hand_count"], row["oppo_hand_count"], row["hand_diff"]) == (
        4,
        5,
        -1,
    )
    assert (row["user_lands_count"], row["oppo_lands_count"], row["lands_diff"]) == (
        2,
        1,
        1,
    )
    assert (
        row["user_creatures_count"],
        row["oppo_creatures_count"],
        row["creatures_diff"],
    ) == (1, 1, 0)
    assert (row["user_mana_spent"], row["oppo_mana_spent"]) == (2, 2)
    assert row["user_drawn_cum"] == 1  # t1 draw 0, t2 draw 1
    assert (row["num_mulligans"], row["opp_num_mulligans"]) == (0, 1)
    assert row["user_n_games_bucket"] == 500
    # library approx = deck_size(5) - 7 + num_mulligans(0) - drawn_cum(1)
    assert row["library_approx"] == -3

    # Cumulative draws advance within rg0 and RESET into rg1.
    t3 = int(np.flatnonzero((data.game_seq == 0) & (data.turn == 3))[0])
    assert dict(zip(wdata.FEATURES, data.X[t3]))["user_drawn_cum"] == 2
    rg1_t1 = int(np.flatnonzero((data.game_seq == 1) & (data.turn == 1))[0])
    rg1 = dict(zip(wdata.FEATURES, data.X[rg1_t1]))
    assert rg1["user_drawn_cum"] == 1 and rg1["on_play"] == 0.0  # on draw

    assert not np.isnan(data.X[:, wdata.FEATURES.index("user_wr_bucket")]).any()
    assert data.wr_fill == pytest.approx(0.60, abs=1e-4)


def test_state_anchors_and_verify(winprob_hand_data):
    anchors = wdata.state_anchors(winprob_hand_data)
    assert anchors["mean_turns"] == pytest.approx(2.0)  # 12 rows / 6 games
    assert anchors["ahead"]["n"] == 0  # no turn-7 rows here
    assert anchors["ahead"]["win_rate"] is None

    wdata.verify_anchors(anchors, {"mean_turns": 2.0})
    with pytest.raises(ValueError, match="anchor mismatch"):
        wdata.verify_anchors(anchors, {"mean_turns": 3.0})
    with pytest.raises(ValueError, match="anchor mismatch"):
        wdata.verify_anchors(anchors, {"ahead": 0.5})  # got None


def test_scaler_roundtrip():
    X = np.array([[0.0, 10.0], [2.0, 10.0], [4.0, 10.0]], dtype=np.float32)
    mean, std = wdata.fit_scaler(X, np.arange(3))
    assert mean.tolist() == pytest.approx([2.0, 10.0])
    assert std[1] == pytest.approx(wdata.SCALE_FLOOR)  # constant col floors
    Xs = wdata.standardize(X, mean, std)
    assert Xs[:, 0].tolist() == pytest.approx([-1.2247449, 0.0, 1.2247449])


# ---------------------------------------------------------------------------
# Metrics.


def test_ece_equal_mass():
    ece = wtrain.ece_equal_mass([0, 0, 1, 1], [0.1, 0.4, 0.35, 0.8], bins=2)
    assert ece == pytest.approx(0.1875)
    assert np.isnan(wtrain.ece_equal_mass([], []))


def test_evaluate_and_buckets():
    y = np.array([0, 0, 1, 1])
    p = np.array([0.1, 0.2, 0.8, 0.9])  # perfectly separable
    block = wtrain.evaluate(y, p)
    assert block["auc"] == 1.0 and block["n"] == 4
    assert set(block) >= {
        "auc",
        "log_loss",
        "brier",
        "ece",
        "base_rate",
        "mean_pred",
        "reliability",
    }

    turn = np.array([2, 5, 8, 11])
    by = wtrain.evaluate_by_bucket(y, p, turn)
    assert set(by) == {"pooled", "t1-3", "t4-6", "t7-9", "t10+"}
    assert by["t1-3"]["n"] == 1


def test_nonlinearity_gap():
    full = {"pooled": {"n": 10, "auc": 0.70, "log_loss": 0.60}}
    mlp = {"pooled": {"n": 10, "auc": 0.75, "log_loss": 0.55}}
    gap = wtrain.nonlinearity_gap(full, mlp)
    assert gap["pooled"]["auc_gain"] == pytest.approx(0.05)
    assert gap["pooled"]["log_loss_drop"] == pytest.approx(0.05)


def test_model_forward_and_predict():
    import torch

    net = WinProbNet(1, hidden=())  # logistic
    assert sum(p.numel() for p in net.parameters()) == 2  # weight + bias
    logits = net(torch.zeros(3, 1))
    assert logits.shape == (3,)

    mlp = WinProbNet(25, hidden=(64, 32))
    Xs = np.random.default_rng(0).standard_normal((5, 25)).astype(np.float32)
    proba = predict_proba(mlp, Xs, np.arange(25), batch_size=2)
    assert proba.shape == (5,) and ((proba > 0) & (proba < 1)).all()


# ---------------------------------------------------------------------------
# Training + economics smoke.


def test_train_smoke_all_three_heads(winprob_training_data):
    models, report, context = wtrain.train(
        _synth.SET,
        _synth.FMT,
        epochs=3,
        batch_size=64,
        lr=1e-2,
        seed=3,
        patience=3,
        val_permille=500,
        subsample=None,
        progress=lambda *_: None,
    )

    assert set(models) == {"life_diff", "full", "mlp"}
    assert report["n_train"] + report["n_val"] == report["n_rows"]
    for name in models:
        block = report["models"][name]
        assert "pooled" in block and 0.0 <= block["pooled"]["auc"] <= 1.0
    # Non-linearity gap is reported per bucket that both heads scored.
    assert "pooled" in report["nonlinearity_gap"]
    # life_diff head consumes exactly one feature.
    assert context["models"]["life_diff"]["columns"] == [
        wdata.FEATURES.index("life_diff")
    ]
    assert len(context["scaler_mean"]) == 25


def test_save_version_and_economics(winprob_training_data, tmp_path, monkeypatch):
    import torch

    from mtga.foundation import runlog

    models, report, context = wtrain.train(
        _synth.SET,
        _synth.FMT,
        epochs=2,
        batch_size=64,
        lr=1e-2,
        seed=3,
        patience=3,
        val_permille=500,
        subsample=None,
        progress=lambda *_: None,
    )

    out_dir = wtrain.save_version(models, report, context, tag="v1-test")
    assert out_dir == paths.MODELS_DIR / "_winprob" / "v1-test"
    for artifact in [
        "checkpoint_life_diff.pt",
        "checkpoint_full.pt",
        "checkpoint_mlp.pt",
        "meta.json",
        "metrics.json",
    ]:
        assert (out_dir / artifact).exists()
    with open(out_dir / "meta.json") as fh:
        meta = json.load(fh)
    assert meta["model_id"] == "_winprob/v1-test"
    assert meta["data_etag"] == "etag-replay-1"
    assert set(meta["heads"]) == {"life_diff", "full", "mlp"}

    # The MLP checkpoint round-trips into a fresh net.
    checkpoint = torch.load(out_dir / "checkpoint_mlp.pt", weights_only=False)
    fresh = WinProbNet(
        checkpoint["config"]["input_dim"], hidden=tuple(checkpoint["config"]["hidden"])
    )
    fresh.load_state_dict(checkpoint["model"])

    # Economics from the trained MLP.
    mean, std = context["_scaler"]
    econ = economics.compute(
        models["mlp"], mean, std, context["_data"], context["_val_idx"], seed=3
    )
    assert econ["kind"] == "winprob-economics-v1"
    assert "NOT causal" in econ["framing"]
    for key in [
        "headline",
        "pooled_typical",
        "life_curve_at_t7",
        "parity_curve",
        "exchange_rate_table",
    ]:
        assert key in econ
    assert len(econ["exchange_rate_table"]) == len(economics.REF_TURNS) * len(
        economics.REF_LIVES
    )
    assert isinstance(economics.render_table(econ), str)

    json_path, fig_path = economics.save(econ, out_dir)
    assert json_path.exists() and fig_path.exists()

    monkeypatch.setattr(runlog, "LEDGER", tmp_path / "ledger.jsonl")
    record = wtrain.ledger_run(report, context, out_dir, economics=econ)
    lines = (tmp_path / "ledger.jsonl").read_text().strip().splitlines()
    assert len(lines) == 1
    logged = json.loads(lines[0])
    assert logged["run_id"] == record["run_id"]
    assert logged["metrics"]["auc_mlp"] == report["models"]["mlp"]["pooled"]["auc"]


def test_gradient_sign_and_exchange():
    """A hand-built monotone-in-life MLP gives a positive life gradient and a
    finite life-per-card exchange when the card gradient is also positive."""
    import torch

    mean = np.zeros(25, dtype=np.float32)
    std = np.ones(25, dtype=np.float32)
    net = WinProbNet(25, hidden=())
    with torch.no_grad():
        net.net[0].weight.zero_()
        w = net.net[0].weight
        w[0, wdata.FEATURES.index("life_diff")] = 0.5
        w[0, wdata.FEATURES.index("hand_diff")] = 0.2
        net.net[0].bias.zero_()

    X = np.zeros((4, 25), dtype=np.float32)
    g_life = economics.gradient(net, mean, std, X, "life")
    g_card = economics.gradient(net, mean, std, X, "card")
    assert (g_life > 0).all() and (g_card > 0).all()
    # life-equiv of a card = dP/dcard / dP/dlife, both from a 0.5/0.2 logit.
    equiv, _, _ = economics._exchange(g_card, g_life)
    # ~0.4 up to sigmoid curvature of the central-difference secants.
    assert equiv == pytest.approx(0.2 / 0.5, abs=0.02)


# ---------------------------------------------------------------------------
# v2: multi-set loading, cross-set training, zero-shot eval, economics-by-set.


def test_load_many_concatenates_and_tags_sets(winprob_multiset_raw):
    sets = winprob_multiset_raw
    single = {s: wdata.load_dataset(s, _synth.FMT) for s in sets}

    combined, report, wr_fills = wdata.load_many(
        sets, _synth.FMT, per_set_row_cap=None, progress=lambda *_: None
    )

    assert combined.n_rows == sum(d.n_rows for d in single.values())
    assert combined.n_games == sum(d.n_games for d in single.values())
    assert set(combined.game_set.tolist()) == set(sets)
    assert set(wr_fills) == set(sets)
    for s in sets:
        assert report[s]["rows_total"] == single[s].n_rows
        assert report[s]["rows_kept"] == single[s].n_rows
        assert report[s]["games"] == single[s].n_games

    # Every row's source set (via game_pos) matches that set's own row count.
    row_set = combined.game_set[combined.game_pos]
    for s in sets:
        assert int((row_set == s).sum()) == single[s].n_rows

    # draft_id is prefixed with the set code -- both fixtures share the same
    # "wp00".."wp59" ids, so this is a real collision, not a hypothetical one.
    ids = combined.game_draft_id.tolist()
    assert f"{sets[0]}:wp00" in ids and f"{sets[1]}:wp00" in ids
    assert len(set(ids)) == len(ids)  # globally unique -> no split leakage

    train_mask, val_mask = split_by_draft(combined.game_draft_id, 500)
    assert train_mask.any() and val_mask.any()


def test_load_many_row_cap_keeps_full_game_metadata(winprob_multiset_raw):
    sets = winprob_multiset_raw
    cap = 10
    combined, report, _ = wdata.load_many(
        sets, _synth.FMT, per_set_row_cap=cap, seed=5, progress=lambda *_: None
    )

    for s in sets:
        assert report[s]["rows_total"] > cap
        assert report[s]["rows_kept"] == cap
    assert combined.n_rows == cap * len(sets)

    # Per-game metadata (draft_id/game_set) is NEVER capped, only the row
    # matrix -- this is what state_anchors' rows-per-game ratio depends on,
    # which is exactly why the anchor check must run on FULL data first.
    full_games = sum(wdata.load_dataset(s, _synth.FMT).n_games for s in sets)
    assert combined.n_games == full_games


def test_load_many_anchor_check(winprob_multiset_raw):
    sets = winprob_multiset_raw
    single = wdata.load_dataset(sets[0], _synth.FMT)
    anchors = wdata.state_anchors(single)
    key = (sets[0], _synth.FMT)

    ok = {
        key: {
            "mean_turns": anchors["mean_turns"],
            "ahead": anchors["ahead"]["win_rate"],
            "behind": anchors["behind"]["win_rate"],
        }
    }
    combined, report, _ = wdata.load_many(
        sets, _synth.FMT, anchor_checks=ok, progress=lambda *_: None
    )
    assert combined.n_rows == sum(r["rows_kept"] for r in report.values())

    bad = {key: {"mean_turns": anchors["mean_turns"] + 5.0}}
    with pytest.raises(ValueError, match="anchor mismatch"):
        wdata.load_many(sets, _synth.FMT, anchor_checks=bad, progress=lambda *_: None)


def test_train_multiset_smoke_zero_shot(winprob_multiset_raw):
    train_sets = [winprob_multiset_raw[0]]
    holdout_sets = [winprob_multiset_raw[1]]

    models, report, context = wtrain.train_multiset(
        train_sets,
        holdout_sets,
        limited_type=_synth.FMT,
        per_set_row_cap=None,
        epochs=2,
        batch_size=64,
        lr=1e-2,
        seed=3,
        patience=3,
        val_permille=500,
        progress=lambda *_: None,
    )

    assert set(models) == {"life_diff", "full", "mlp"}
    assert context["train_sets"] == train_sets
    assert context["holdout_sets"] == holdout_sets
    assert report["n_train"] + report["n_val"] == report["n_rows"]

    # Within-training validation is broken out by (trained-on) set...
    assert set(report["by_train_set"]) == set(train_sets)
    # ...while the zero-shot set never appears there, only under zero_shot.
    assert holdout_sets[0] not in report["by_train_set"]
    assert set(report["zero_shot"]) == set(holdout_sets)

    z = report["zero_shot"][holdout_sets[0]]
    for name in ("life_diff", "full", "mlp"):
        assert "pooled" in z["models"][name]
        assert 0.0 <= z["models"][name]["pooled"]["auc"] <= 1.0
    assert report["zero_shot_mlp_auc_mean"] == pytest.approx(
        z["models"]["mlp"]["pooled"]["auc"]
    )
    assert "pooled" in z["nonlinearity_gap"]


def test_save_version_multiset_and_economics_by_set(
    winprob_multiset_raw, tmp_path, monkeypatch
):
    import torch

    from mtga.foundation import runlog

    train_sets = list(winprob_multiset_raw)  # both sets train, no holdout
    models, report, context = wtrain.train_multiset(
        train_sets,
        [],
        limited_type=_synth.FMT,
        per_set_row_cap=None,
        epochs=2,
        batch_size=64,
        lr=1e-2,
        seed=3,
        patience=3,
        val_permille=500,
        progress=lambda *_: None,
    )
    assert report["zero_shot"] == {}
    assert report["zero_shot_mlp_auc_mean"] is None

    out_dir = wtrain.save_version_multiset(models, report, context, tag="v2-test")
    assert out_dir == paths.MODELS_DIR / "_winprob" / "v2-test"
    for artifact in [
        "checkpoint_life_diff.pt",
        "checkpoint_full.pt",
        "checkpoint_mlp.pt",
        "meta.json",
        "metrics.json",
    ]:
        assert (out_dir / artifact).exists()
    with open(out_dir / "meta.json") as fh:
        meta = json.load(fh)
    assert meta["train_sets"] == train_sets
    assert meta["holdout_sets"] == []
    assert set(meta["data_etags"]) == set(train_sets)

    # The MLP checkpoint round-trips into a fresh net, same as v1.
    checkpoint = torch.load(out_dir / "checkpoint_mlp.pt", weights_only=False)
    fresh = WinProbNet(
        checkpoint["config"]["input_dim"], hidden=tuple(checkpoint["config"]["hidden"])
    )
    fresh.load_state_dict(checkpoint["model"])

    mean, std = context["_scaler"]
    data = context["_data"]
    val_idx = context["_val_idx"]

    econ = economics.compute(models["mlp"], mean, std, data, val_idx, seed=3)
    by_set = economics.compute_by_set(
        models["mlp"], mean, std, data, val_idx, train_sets, seed=3
    )
    assert set(by_set) == set(
        train_sets
    )  # both sets have val rows at n=60/permille=500
    table = economics.render_by_set_table(by_set)
    assert isinstance(table, str)
    for s in train_sets:
        assert s in table

    json_path, fig_path = economics.save(econ, out_dir)
    assert json_path.exists() and fig_path.exists()

    monkeypatch.setattr(runlog, "LEDGER", tmp_path / "ledger.jsonl")
    record = wtrain.ledger_run_multiset(report, context, out_dir, economics=econ)
    lines = (tmp_path / "ledger.jsonl").read_text().strip().splitlines()
    assert len(lines) == 1
    logged = json.loads(lines[0])
    assert logged["run_id"] == record["run_id"]
    assert logged["metrics"]["auc_mlp"] == report["models"]["mlp"]["pooled"]["auc"]
    assert logged["metrics"]["zero_shot_mlp_auc_mean"] is None

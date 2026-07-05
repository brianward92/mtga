"""Mulligan v1 (mtga/mulligan): data assembly, metrics, and train smoke.

Hand-computed expectations follow _synth.hand_replay_games (8 decision rows
after curation: rg3 drops) and _synth.CARDFEAT_SPEC. Feature geometry:
rg0's kept hand [A, B, C, D, L1, L1, L2] has 3 lands, 3 cheap spells
(A cmc1, B cmc3, C cmc3; D cmc5 misses the <=3 cut), pips r1+w1+u2+g1=5;
rg0's deck {A:2, B:1, C:1, D:1} has color counts [W1, U1, B0, R2, G1], so
top-2 colors {R, W} and a pip match of (1+1)/5 = 0.4.
"""

import json

import numpy as np
import pytest

import _synth
from mtga.lands import paths
from mtga.mulligan import data as mdata
from mtga.mulligan import train as mtrain
from mtga.mulligan.model import MulliganNet, predict_proba


def _curate_replay():
    from mtga.replay import etl

    assert etl.curate_mulligans(_synth.SET, _synth.FMT)["status"] == "CURATED"
    assert etl.curate_turn_states(_synth.SET, _synth.FMT)["status"] == "CURATED"


@pytest.fixture
def mulligan_data(replay_raw):
    """MulliganData over the six hand-computed replay games."""
    _synth.write_mull_cards_csv()
    _synth.write_cardfeats()
    _curate_replay()
    return mdata.load_dataset(_synth.SET, _synth.FMT)


@pytest.fixture
def training_raw(data_root):
    """40-game replay fixture with a healthy crc32 split at permille 500."""
    dest = paths.raw_dataset_path("replay", _synth.SET, _synth.FMT)
    _synth.write_replay_csv(dest, games=_synth.mulligan_training_games())
    _synth.write_mull_cards_csv()
    _synth.write_cardfeats()
    _curate_replay()
    return dest


def test_feature_columns_match_frozen_layout():
    columns = mdata.feature_columns()
    assert len(columns) == 391
    for needed in ["type_land", "type_creature", "cmc_scaled", "pip_r",
                   "color_w"]:
        assert needed in columns


def test_arena_row_lookup_maps_every_printing(data_root):
    _synth.write_mull_cards_csv()
    frame = _synth.write_cardfeats()
    _, row_by_norm = mdata.load_card_matrix()
    lookup = mdata.arena_row_lookup(row_by_norm)
    row_a = list(frame["name_display"]).index(_synth.CARD_A)
    assert lookup[_synth.RID_A] == row_a
    assert lookup[_synth.RID_A_ALT] == row_a  # second printing, same name
    with pytest.raises(ValueError, match="no cardfeats row"):
        mdata.hand_feature_rows(np.full((1, 7), _synth.RID_GHOST), lookup)


def test_load_dataset_hand_computed(mulligan_data):
    data = mulligan_data
    assert data.n_rows == 8            # rg3's subset anomaly dropped
    assert data.hand_rows.shape == (8, 7) and (data.hand_rows >= 0).all()
    assert data.kept.tolist() == [True, False, True, False, False, True,
                                  True, True]
    assert data.hand_size.tolist() == [7, 7, 6, 7, 6, 5, 7, 7]
    assert data.input_dim == 3 * 391 + len(mdata.EXTRA_COLUMNS)

    ex = dict(zip(mdata.EXTRA_COLUMNS, data.extras[0]))  # rg0 kept row
    assert ex["on_play"] == 1.0
    assert [ex["hand_size_7"], ex["hand_size_6"], ex["hand_size_5"],
            ex["hand_size_le4"]] == [1.0, 0.0, 0.0, 0.0]
    assert ex["n_lands"] == pytest.approx(3 / 7)
    assert ex["n_cheap"] == pytest.approx(3 / 7)
    assert ex["color_match"] == pytest.approx(0.4)
    assert [ex["deck_w"], ex["deck_u"], ex["deck_b"], ex["deck_r"],
            ex["deck_g"]] == pytest.approx([0.2, 0.2, 0.0, 0.4, 0.2])
    assert ex["deck_lands"] == 0.0

    # rg2's kept-at-5 row: one-hot lands in the 5 slot.
    ex5 = dict(zip(mdata.EXTRA_COLUMNS, data.extras[5]))
    assert ex5["hand_size_5"] == 1.0 and ex5["hand_size_7"] == 0.0


def test_assemble_pools_hand_and_deck(mulligan_data):
    data = mulligan_data
    x = mdata.assemble(data, np.array([0]))
    assert x.shape == (1, data.input_dim)
    columns = mdata.feature_columns()
    land, cmc = columns.index("type_land"), columns.index("cmc_scaled")
    creature = columns.index("type_creature")
    assert x[0, land] == pytest.approx(3 / 7)          # hand mean pool
    assert x[0, 391 + cmc] == pytest.approx(5 / 8)     # hand max pool: D cmc 5
    assert x[0, 2 * 391 + creature] == pytest.approx(3 / 5)  # deck mean pool


def test_anchors_hand_computed(mulligan_data):
    anchors = mdata.mulligan_anchors(mulligan_data)
    assert anchors == {
        0: {"n": 3, "win_rate": pytest.approx(2 / 3)},
        1: {"n": 1, "win_rate": 0.0},
        2: {"n": 1, "win_rate": 0.0},
    }
    mdata.verify_anchors(anchors, {0: 0.667, 1: 0.0})
    with pytest.raises(ValueError, match="anchor mismatch"):
        mdata.verify_anchors(anchors, {0: 0.562})
    with pytest.raises(ValueError, match="anchor mismatch"):
        mdata.verify_anchors(anchors, {3: 0.1})


def test_continuation_table_and_fallbacks(mulligan_data):
    table = mdata.continuation_table(mulligan_data)
    assert table["n_mulled"] == 3
    assert table["cells"] == [
        {"hand_size": 7, "on_play": True, "n": 1, "win_rate": 0.0},
        {"hand_size": 7, "on_play": False, "n": 1, "win_rate": 0.0},
        {"hand_size": 6, "on_play": True, "n": 1, "win_rate": 0.0},
    ]
    assert [p["n"] for p in table["pooled"]] == [2, 1]
    # Exact cell when populated enough; pooled and larger-size fallbacks.
    assert mdata.continuation_value(table, 7, True, min_n=1) == 0.0
    assert mdata.continuation_value(table, 6, False, min_n=1) == 0.0  # pooled 6
    assert mdata.continuation_value(table, 5, False) == 0.0  # borrows size 6
    with pytest.raises(ValueError, match="no usable rows"):
        mdata.continuation_value({"cells": [], "pooled": []}, 7, True)


def test_roc_auc_and_calibration():
    assert mtrain.roc_auc([0, 0, 1, 1], [0.1, 0.4, 0.35, 0.8]) == pytest.approx(0.75)
    assert mtrain.roc_auc([0, 1], [0.5, 0.5]) == pytest.approx(0.5)  # tie-aware
    assert np.isnan(mtrain.roc_auc([1, 1], [0.2, 0.8]))
    cal = mtrain.calibration([0, 1, 0, 1], [0.2, 0.2, 0.8, 0.8], n_bins=2)
    assert cal["ece"] == pytest.approx(0.3)
    assert [b["n"] for b in cal["reliability"]] == [2, 2]
    assert [b["frac_won"] for b in cal["reliability"]] == [0.5, 0.5]


def test_decision_analysis_cells(mulligan_data):
    data = mulligan_data
    idx = np.arange(data.n_rows)
    table = mdata.continuation_table(data)  # every threshold falls back to 0.0
    pred = np.full(data.n_rows, 0.5)
    result = mtrain.decision_analysis(data, idx, pred, table)
    assert result["model_keep_rate"] == 1.0        # 0.5 > 0.0 everywhere
    assert result["human_keep_rate"] == pytest.approx(5 / 8)
    assert result["agreement"] == pytest.approx(5 / 8)
    assert result["cells"]["human_keep_model_keep"]["n"] == 5
    assert result["cells"]["human_mull_model_keep"]["n"] == 3
    assert result["cells"]["human_keep_model_mull"]["n"] == 0
    assert result["cells"]["human_keep_model_mull"]["win_rate"] is None
    assert result["cells_at_7"]["human_keep_model_keep"]["n"] == 3
    assert result["thresholds"]["7_play"] == 0.0


def test_model_forward_and_predict(mulligan_data):
    import torch

    data = mulligan_data
    model = MulliganNet(data.input_dim, hidden=(8,), dropout=0.0)
    logits = model(torch.from_numpy(mdata.assemble(data, np.arange(4))))
    assert logits.shape == (4,)
    proba = predict_proba(model, data, np.arange(data.n_rows), batch_size=3)
    assert proba.shape == (data.n_rows,)
    assert ((proba > 0) & (proba < 1)).all()


def test_train_smoke_artifacts_and_ledger(training_raw, tmp_path, monkeypatch):
    import torch

    from mtga.foundation import runlog

    model, report, context = mtrain.train(
        _synth.SET, _synth.FMT, epochs=2, batch_size=16, lr=1e-2,
        hidden=(8,), seed=3, patience=3, val_permille=500, progress=lambda *_: None)

    assert report["n_decisions"] == 48 and report["n_kept"] == 40
    assert report["n_train"] == 17 and report["n_val_kept"] == 23
    assert 0.0 <= report["outcome_head"]["auc"] <= 1.0
    assert 0.0 <= report["outcome_head"]["ece"] <= 1.0
    assert report["outcome_head"]["reliability"]
    assert report["anchors"]["0"]["n"] == 32 and report["anchors"]["1"]["n"] == 8
    # Train-split continuation: mulled games 5/10/15/20; 10 and 20 won.
    assert report["continuation"]["pooled"][0] == {
        "hand_size": 7, "n": 4, "win_rate": 0.5}
    assert report["decision"]["thresholds"] == {
        "7_play": 0.5, "7_draw": 0.5, "6_play": 0.5, "6_draw": 0.5}
    assert 0.0 <= report["decision"]["agreement"] <= 1.0
    assert set(report["sanity"]) == {"by_n_lands_at_7", "by_hand_size",
                                     "by_on_play"}
    # 23 kept val rows, of which 4 (mulled games 0/25/30/35) kept at 6.
    assert report["sanity"]["by_n_lands_at_7"][3]["n"] == 19
    assert report["sanity"]["by_hand_size"][6]["n"] == 4

    out_dir = mtrain.save_version(model, report, context, tag="v1-test")
    assert out_dir == paths.MODELS_DIR / "_mulligan" / "v1-test"
    for artifact in ["checkpoint.pt", "meta.json", "metrics.json",
                     "continuation.json"]:
        assert (out_dir / artifact).exists()
    with open(out_dir / "meta.json") as fh:
        meta = json.load(fh)
    assert meta["model_id"] == "_mulligan/v1-test"
    assert meta["data_etag"] == "etag-replay-1"
    with open(out_dir / "continuation.json") as fh:
        assert json.load(fh) == report["continuation"]

    # The checkpoint round-trips into a fresh net.
    checkpoint = torch.load(out_dir / "checkpoint.pt", weights_only=False)
    fresh = MulliganNet(checkpoint["config"]["input_dim"],
                        hidden=tuple(checkpoint["config"]["hidden"]))
    fresh.load_state_dict(checkpoint["model"])

    monkeypatch.setattr(runlog, "LEDGER", tmp_path / "ledger.jsonl")
    record = mtrain.ledger_run(report, context, out_dir)
    lines = (tmp_path / "ledger.jsonl").read_text().strip().splitlines()
    assert len(lines) == 1
    logged = json.loads(lines[0])
    assert logged["run_id"] == record["run_id"]
    assert logged["metrics"]["auc"] == report["outcome_head"]["auc"]
    assert logged["artifacts"]["checkpoint_sha256"]

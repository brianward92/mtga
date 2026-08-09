"""mtga/models/draftnet.py: split/mask/baseline units, train smoke, promote."""

import json
import os
import zlib

import numpy as np
import pandas as pd
import pytest

import _synth
from _synth import CARD_A, FMT, SET, VOCAB
from mtga.lands import etl, paths
from mtga.models import draftnet

torch = pytest.importorskip("torch")


# -- split_by_draft ----------------------------------------------------------


def test_split_by_draft_deterministic_and_disjoint():
    ids = np.array([f"draft-{i}" for i in range(4000)])
    train, val = draftnet.split_by_draft(ids)
    assert (train ^ val).all()  # exact partition: disjoint and complete
    # ~5% of ids in val (50/1000 crc32 buckets); 4000 ids -> ~6 sigma bounds.
    assert 0.02 < val.mean() < 0.09
    train2, val2 = draftnet.split_by_draft(ids)
    assert np.array_equal(train, train2) and np.array_equal(val, val2)
    # Membership follows the documented crc32 rule exactly.
    for i in [0, 17, 3999]:
        assert val[i] == ((zlib.crc32(ids[i].encode()) % 1000) < 50)


def test_split_by_draft_groups_all_picks_of_a_draft_together():
    ids = np.array([f"draft-{i}" for i in range(500)])
    picks = pd.Series(np.repeat(ids, 3))  # 3 picks per draft, pandas input
    _, val = draftnet.split_by_draft(picks)
    per_draft = val.reshape(-1, 3)
    assert (per_draft == per_draft[:, :1]).all()  # no draft straddles the split


def test_split_by_draft_permille_bounds():
    ids = np.array([f"d{i}" for i in range(100)])
    train, val = draftnet.split_by_draft(ids, val_permille=1000)
    assert val.all() and not train.any()
    train, val = draftnet.split_by_draft(ids, val_permille=0)
    assert train.all() and not val.any()


# -- model building blocks ---------------------------------------------------


def test_build_model_shape():
    model = draftnet.build_model(6, hidden=[8, 4], dropout=0.0)
    linears = [m for m in model if isinstance(m, torch.nn.Linear)]
    assert [(l.in_features, l.out_features) for l in linears] == [
        (6, 8),
        (8, 4),
        (4, 6),
    ]
    model.eval()
    out = model(torch.zeros(3, 6))
    assert out.shape == (3, 6)


def test_masked_logits():
    logits = torch.tensor([[1.0, 2.0, 3.0], [4.0, 5.0, 6.0]])
    pack = torch.tensor([[1.0, 0.0, 2.0], [0.0, 1.0, 0.0]])
    masked = draftnet.masked_logits(logits, pack)
    assert masked[0].tolist() == [1.0, float("-inf"), 3.0]
    assert masked[1].tolist() == [float("-inf"), 5.0, float("-inf")]


def test_baseline_agreement_argmax_and_argmin():
    pack = np.array([[1, 1, 0], [0, 1, 1]])
    picks = np.array([0, 2])
    # argmax of [3,1,2] over each pack: row0 -> 0, row1 -> 2: both match.
    assert draftnet.baseline_agreement(pack, picks, np.array([3.0, 1.0, 2.0])) == 1.0
    # ALSA-style: argmin of [1,3,2]: row0 -> 0, row1 -> 2: both match.
    assert (
        draftnet.baseline_agreement(
            pack, picks, np.array([1.0, 3.0, 2.0]), take_min=True
        )
        == 1.0
    )


def test_baseline_agreement_nan_cards_never_chosen():
    pack = np.array([[1, 1, 0], [0, 1, 1]])
    values = np.array([np.nan, 1.0, 2.0])
    # argmax: NaN -> -inf, so row0 must choose card 1, missing pick 0.
    assert draftnet.baseline_agreement(pack, np.array([0, 2]), values) == 0.5
    # argmin: NaN -> +inf, so row0 must still choose card 1 (not the NaN).
    assert (
        draftnet.baseline_agreement(pack, np.array([1, 1]), values, take_min=True)
        == 1.0
    )


# -- end-to-end train smoke ---------------------------------------------------


def _signal_draft_rows():
    """~200 picks with an obvious signal: always take the lowest vocab index.

    Also one low-skill draft that the wr-bucket filter must drop.
    """
    train_ids, val_ids = [], []
    i = 0
    while len(train_ids) < 30 or len(val_ids) < 3:
        draft_id = f"draft{i:04d}"
        if (zlib.crc32(draft_id.encode()) % 1000) < draftnet.VAL_PERMILLE:
            if len(val_ids) < 3:
                val_ids.append(draft_id)
        elif len(train_ids) < 30:
            train_ids.append(draft_id)
        i += 1

    rng = np.random.default_rng(11)
    rows = []
    for draft_id in train_ids + val_ids:
        pool = {}
        for pick_number in range(6):
            in_pack = sorted(rng.choice(len(VOCAB), rng.integers(2, 5), replace=False))
            best = VOCAB[in_pack[0]]
            rows.append(
                dict(
                    draft_id=draft_id,
                    pack_number=1,
                    pick_number=pick_number,
                    pick=best,
                    pack={VOCAB[j]: 1 for j in in_pack},
                    pool=dict(pool),
                )
            )
            pool[best] = pool.get(best, 0) + 1
    for pick_number in range(6):  # filtered out: wr bucket below 0.55
        rows.append(
            dict(
                draft_id="lowskill",
                pack_number=1,
                pick_number=pick_number,
                pick=VOCAB[0],
                pack={VOCAB[0]: 1},
                wr_bucket=0.40,
            )
        )
    return rows


@pytest.fixture
def signal_curated(data_root):
    dest = paths.raw_dataset_path("draft", SET, FMT)
    _synth.write_draft_csv(dest, _signal_draft_rows())
    assert etl.curate_draft(SET, FMT)["status"] == "CURATED"


def test_load_pick_arrays_applies_skill_filter(signal_curated):
    pool, pack, picks, meta, vocab = draftnet.load_pick_arrays(SET, FMT)
    assert vocab == VOCAB
    assert pool.shape == pack.shape == (198, 4)  # 33 drafts x 6; lowskill gone
    assert pool.dtype == pack.dtype == np.int8
    assert picks.shape == (198,)
    assert "lowskill" not in set(meta["draft_id"])
    # Every recorded pick was actually in the pack.
    assert (pack[np.arange(len(picks)), picks] > 0).all()


def test_train_save_promote_and_serve(signal_curated, card_store):
    model, report, context = draftnet.train(
        SET,
        FMT,
        epochs=2,
        batch_size=32,
        hidden=[8],
        seed=17,
        progress=lambda *a: None,
    )
    assert report["n_train"] == 180 and report["n_val"] == 18
    for key in ["val", "val_top_quartile", "per_pack", "baselines"]:
        assert key in report
    assert set(report["val"]) == {"top1", "top3", "log_loss"}
    assert 1 in report["per_pack"]
    # No metrics exist in this layout: baselines record the failure but the
    # zero-parameter random baseline is always present.
    assert "error" in report["baselines"]
    assert 0.0 < report["baselines"]["random"] <= 1.0
    # The signal is trivially learnable (constant ordering wins every pick).
    assert report["val"]["top1"] >= report["baselines"]["random"]

    out_dir = draftnet.save_version(model, report, context, tag="vtest")
    assert out_dir == paths.model_dir(SET, FMT, "vtest")
    for artifact in ["model.onnx", "meta.json", "metrics.json", "checkpoint.pt"]:
        assert (out_dir / artifact).exists()
    meta = json.loads((out_dir / "meta.json").read_text())
    assert meta["model_id"] == f"{SET}/{FMT}/vtest"
    assert meta["data_etag"] == "etag-draft-1"  # provenance chain from raw
    entry = meta["vocab"][0]
    assert entry == {
        "index": 0,
        "name": CARD_A,
        "grp_id": 101,
        "grp_ids": [101, 201, 301],
    }
    assert json.loads((out_dir / "metrics.json").read_text())["n_val"] == 18

    # First promotion has no incumbent -> always promoted.
    assert draftnet.promote(out_dir) is True

    # Serving: registry resolves the promoted model from the latest symlink.
    from mtga.models import registry

    served = registry.resolve(SET, FMT)
    assert isinstance(served, registry.OnnxEVModel)
    assert served.model_id == f"{SET}/{FMT}/vtest"
    assert served.fallback is False

    scores = served.score_pack([301, 104], [102])
    assert {s.rank for s in scores} == {1, 2}
    assert all(isinstance(s.ev, float) for s in scores)
    assert sum(s.prob for s in scores) == pytest.approx(1.0)
    # Alias grpId 301 resolves to the same vocab slot as canonical 101.
    canonical = served.score_pack([101, 104], [102])
    assert [s.ev for s in scores] == [s.ev for s in canonical]
    # Unknown grpIds degrade to ev None and rank last.
    unknown = served.score_pack([101, 999], [])
    assert unknown[-1].grp_id == 999 and unknown[-1].ev is None


# -- promote -----------------------------------------------------------------


def _fabricate_version(tag, top1):
    version_dir = paths.model_dir(SET, FMT, tag)
    version_dir.mkdir(parents=True, exist_ok=True)
    with open(version_dir / "metrics.json", "w") as fh:
        json.dump({"val_top_quartile": {"top1": top1}}, fh)
    return version_dir


def test_promote_gate(data_root, capsys):
    latest = paths.model_dir(SET, FMT, "x").parent / "latest"

    v1 = _fabricate_version("v1", 0.50)
    assert draftnet.promote(v1) is True  # no incumbent
    assert os.readlink(latest) == "v1"

    # Worse than incumbent - tolerance: rejected, symlink untouched.
    v2 = _fabricate_version("v2", 0.49)
    assert draftnet.promote(v2, tolerance=0.005) is False
    assert os.readlink(latest) == "v1"
    assert "NOT promoted" in capsys.readouterr().out

    # Slightly worse but within tolerance: promoted (avoids churn flapping).
    v3 = _fabricate_version("v3", 0.4999)
    assert draftnet.promote(v3, tolerance=0.005) is True
    assert os.readlink(latest) == "v3"

    # Clearly better: promoted.
    v4 = _fabricate_version("v4", 0.55)
    assert draftnet.promote(v4, tolerance=0.005) is True
    assert os.readlink(latest) == "v4"

    # force overrides the gate.
    assert draftnet.promote(v2, force=True) is True
    assert os.readlink(latest) == "v2"

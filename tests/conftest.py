"""Shared fixtures for the draft-assistant test suite.

mtga.lands.paths freezes DATA_ROOT (and every derived constant) from the
MTGA_DATA_ROOT env var at import time, so the env var is set here BEFORE any
mtga import. Individual tests then get a per-test data root by monkeypatching
every paths constant via the `data_root` fixture; module code always reads
them through the `paths` module at call time, so this is complete isolation.
"""

import os
import shutil
import sys
import tempfile

_SESSION_DATA_ROOT = tempfile.mkdtemp(prefix="mtga-test-data-")
os.environ["MTGA_DATA_ROOT"] = _SESSION_DATA_ROOT

import pytest  # noqa: E402

import _synth  # noqa: E402  (imports mtga.lands.paths — env var is set above)
from mtga.lands import paths  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def _session_data_root():
    yield _SESSION_DATA_ROOT
    shutil.rmtree(_SESSION_DATA_ROOT, ignore_errors=True)


@pytest.fixture
def data_root(tmp_path, monkeypatch):
    """Per-test data root: repoint every paths constant and reset caches."""
    root = tmp_path / "dat"
    lands = root / "17lands"
    layout = {
        "DATA_ROOT": root,
        "LANDS_DIR": lands,
        "RAW_DIR": lands / "raw",
        "CARDS_DIR": lands / "cards",
        "CARD_RATINGS_DIR": lands / "card_ratings",
        "COLOR_RATINGS_DIR": lands / "color_ratings",
        "CURATED_DIR": lands / "curated",
        "METRICS_DIR": lands / "metrics",
        "MODELS_DIR": root / "models",
        "SCRYFALL_PROCESSED_DIR": root / "processed",
        "SCRYFALL_CARDS_PARQUET": root / "processed" / "cards.parquet",
        "SCRYFALL_SETS_PARQUET": root / "processed" / "sets.parquet",
        "CARD_STORE_PARQUET": lands / "cards" / "card_store.parquet",
        "CARDS_CSV": lands / "cards" / "cards.csv",
        "ABILITIES_CSV": lands / "cards" / "abilities.csv",
    }
    for name, value in layout.items():
        monkeypatch.setattr(paths, name, value)
    for name in ["RAW_DIR", "CARDS_DIR", "CARD_RATINGS_DIR", "COLOR_RATINGS_DIR",
                 "CURATED_DIR", "METRICS_DIR", "MODELS_DIR",
                 "SCRYFALL_PROCESSED_DIR"]:
        layout[name].mkdir(parents=True, exist_ok=True)

    # The registry cache key omits the data root itself (it hashes symlink
    # targets/mtimes, all "-" when nothing exists), so stale entries from a
    # previous test's layout would otherwise be served. Same for the API hub.
    from mtga.models import registry

    registry._cache.clear()
    if "mtga.draft_api" in sys.modules:
        hub = sys.modules["mtga.draft_api"].HUB
        hub._cards, hub._ratings, hub._p1p1, hub._global = {}, {}, {}, None

    return root


@pytest.fixture
def card_store(data_root):
    return _synth.write_card_store()


@pytest.fixture
def ratings_cache(data_root):
    """Cached 17Lands card_ratings JSON with a `latest.json` symlink."""
    return _synth.write_ratings_cache()


@pytest.fixture
def draft_raw(data_root):
    """Hand-computed raw draft CSV (0-indexed pick_number) for (TST, Premier)."""
    dest = paths.raw_dataset_path("draft", _synth.SET, _synth.FMT)
    _synth.write_draft_csv(dest, _synth.hand_draft_rows(pick_base=0))
    return dest


@pytest.fixture
def game_raw(data_root):
    dest = paths.raw_dataset_path("game", _synth.SET, _synth.FMT)
    _synth.write_game_csv(dest)
    return dest


@pytest.fixture
def curated_draft(draft_raw):
    from mtga.lands import etl

    result = etl.curate_draft(_synth.SET, _synth.FMT)
    assert result["status"] == "CURATED"
    return result


@pytest.fixture
def curated_game(game_raw):
    from mtga.lands import etl

    result = etl.curate_game(_synth.SET, _synth.FMT)
    assert result["status"] == "CURATED"
    return result


@pytest.fixture
def make_onnx_version(data_root):
    """Factory: write a deterministic ONNX model version dir + latest symlink.

    The network is Linear(4,4) with zero weights and a fixed bias, so the
    score of vocab slot i is exactly bias[i] regardless of the pool.
    """
    def factory(set_code=_synth.SET, limited_type=_synth.FMT, tag="v1",
                bias=(3.0, 2.0, 1.0, 0.0), point_latest=True, top1=None):
        import json

        import torch

        out_dir = paths.model_dir(set_code, limited_type, tag)
        out_dir.mkdir(parents=True, exist_ok=True)
        n = len(_synth.VOCAB)
        linear = torch.nn.Linear(n, n)
        with torch.no_grad():
            linear.weight.zero_()
            linear.bias.copy_(torch.tensor(bias, dtype=torch.float32))
        torch.onnx.export(
            linear, torch.zeros(1, n), str(out_dir / "model.onnx"),
            input_names=["pool"], output_names=["scores"],
            dynamic_axes={"pool": {0: "batch"}, "scores": {0: "batch"}},
            opset_version=17,
        )
        vocab_entries = [
            {"index": i, "name": name, "grp_id": _synth.GRP[name],
             "grp_ids": _synth.ALIASES_A if name == _synth.CARD_A
             else [_synth.GRP[name]]}
            for i, name in enumerate(_synth.VOCAB)
        ]
        meta = {
            "model_id": f"{set_code}/{limited_type}/{tag}",
            "kind": "draftnet-mlp",
            "arch": {"hidden": [n], "dropout": 0.0, "pool_cap": 8},
            "vocab": vocab_entries,
        }
        with open(out_dir / "meta.json", "w") as fh:
            json.dump(meta, fh)
        if top1 is not None:
            with open(out_dir / "metrics.json", "w") as fh:
                json.dump({"val_top_quartile": {"top1": top1}}, fh)
        if point_latest:
            latest = out_dir.parent / "latest"
            if latest.is_symlink():
                latest.unlink()
            latest.symlink_to(out_dir.name)
        return out_dir

    return factory

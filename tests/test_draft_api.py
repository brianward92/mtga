"""mtga/draft_api.py: handler-level contract plus one live HTTP round-trip."""

import json
import threading
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

import pytest

from _synth import CARD_A, FMT, SET
from mtga import draft_api
from mtga.lands import config


@pytest.fixture
def api_env(card_store, ratings_cache, monkeypatch):
    """Card store + cached ratings under a fresh root, with TST tracked.

    data_root (via card_store) already reset HUB and the registry cache.
    """
    monkeypatch.setattr(config, "TRACKED_SETS", [SET])


def _score(payload):
    return draft_api.handle_score(json.dumps(payload).encode())


def test_handle_score_valid_body(api_env):
    result = _score({"set": SET, "format": FMT, "pack": [104, 101, 103],
                     "pool": []})
    assert not isinstance(result, tuple)  # 200 path
    assert result["set"] == SET and result["format"] == FMT
    assert result["model"]["kind"] == "heuristic-ratings"
    assert result["model"]["fallback"] is True
    assert result["attribution"] == config.ATTRIBUTION

    cards = result["cards"]
    assert [c["rank"] for c in cards] == [1, 2, 3]  # response sorted by rank
    # Empty pool -> pure quality: grp 101 (GIH .62) on top (see test_heuristic).
    assert cards[0]["grp_id"] == 101
    assert cards[0]["name"] == CARD_A            # identity from the card store
    assert cards[0]["rarity"] == "common"
    assert cards[0]["image_small"].endswith("101-small.jpg")
    assert cards[0]["gih_wr"] == 0.62            # stats from the ratings cache
    assert sum(c["prob"] for c in cards) == pytest.approx(1.0)


def test_handle_score_unknown_and_out_of_set_grp_ids(api_env):
    result = _score({"set": SET, "pack": [101, 301, 999], "pool": []})
    by_grp = {c["grp_id"]: c for c in result["cards"]}
    # 301 is an out-of-set printing: identity comes from the global store,
    # but the ratings model doesn't know it -> ev None, never a 500.
    assert by_grp[301]["name"] == CARD_A
    assert by_grp[301]["ev"] is None
    # 999 is nowhere: all-null identity, ev None.
    assert by_grp[999]["name"] is None
    assert by_grp[999]["ev"] is None
    assert by_grp[101]["ev"] is not None


def test_handle_score_pool_commitment_changes_ranking(api_env):
    # 18x G in the pool: on-lane W uncommon must outrank the off-lane R
    # bomb (hand math in test_heuristic).
    result = _score({"set": SET, "pack": [101, 102], "pool": [104] * 18})
    assert result["cards"][0]["grp_id"] == 102


def test_handle_score_invalid_json_is_400(api_env):
    payload, status = draft_api.handle_score(b"{not json")
    assert status == 400
    assert "invalid JSON" in payload["error"]
    assert draft_api.handle_score(None)[1] == 400


def test_handle_score_empty_pack_is_400(api_env):
    assert _score({"set": SET, "pack": []})[1] == 400
    assert _score({"set": SET})[1] == 400  # missing pack entirely


@pytest.mark.parametrize("payload", [
    None,
    [],
    {"pack": 7},
    {"pack": ["not-an-int"]},
    {"pack": [True]},
    {"pack": [1.5]},
    {"pack": [-1]},
    {"pack": [101], "pool": {}},
    {"pack": [101], "set": 7},
    {"pack": [101], "format": []},
])
def test_handle_score_malformed_payload_is_400(api_env, payload):
    body, status = _score(payload)
    assert status == 400
    assert body["error"]


def test_infer_set_majority_rule(api_env):
    # A clear majority (here: half or more) of the pack must belong to a set.
    assert draft_api._infer_set([101, 104]) == SET
    assert draft_api._infer_set([101, 999]) == SET  # 1 of 2: exactly half
    assert draft_api._infer_set([101, 998, 999]) is None  # minority match
    assert draft_api._infer_set([998, 999]) is None


def test_handle_score_infers_set_when_omitted(api_env):
    result = _score({"pack": [104, 101]})
    assert result["set"] == SET
    payload, status = _score({"pack": [997, 998, 999]})
    assert status == 400
    assert "could not be inferred" in payload["error"]


def test_health_round_trip_over_http(api_env):
    server = ThreadingHTTPServer(("127.0.0.1", 0), draft_api.DraftApiHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        port = server.server_address[1]
        with urllib.request.urlopen(
            f"http://127.0.0.1:{port}/api/v1/health", timeout=10
        ) as response:
            assert response.status == 200
            assert response.headers["Content-Type"] == "application/json"
            payload = json.loads(response.read())
        assert payload["ok"] is True
        assert payload["uptime_s"] >= 0
        assert payload["sets"][SET]["model_kind"] == "heuristic-ratings"
        assert payload["sets"][SET]["fallback"] is True
        assert payload["attribution"] == config.ATTRIBUTION

        # Unknown routes 404 as JSON, not a stack trace.
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/api/v1/nope",
                                   timeout=10)
            raise AssertionError("expected HTTP 404")
        except urllib.error.HTTPError as err:
            assert err.code == 404
    finally:
        server.shutdown()
        thread.join(timeout=5)
        server.server_close()

"""mtga/replay/etl.py: replay-dump curation into mulligan/turn-state parquet."""

import importlib.util
import json
import sys
from pathlib import Path

import pandas as pd
import pytest

import _synth
from _synth import (
    FMT, SET,
    RID_A, RID_B, RID_C, RID_D, RID_GHOST, RID_L1, RID_L2, RID_OPP,
)
from mtga.lands import paths
from mtga.replay import etl

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"


def _load_script(name):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def replay_script():
    return _load_script("run_replay_etl")


def _rows(frame, **filters):
    for column, value in filters.items():
        frame = frame[frame[column] == value]
    return frame


# ---------------------------------------------------------------------------
# Pure helpers


def test_replay_paths_derive_from_curated_dir(data_root):
    assert paths.replay_mull_path(SET, FMT) == \
        paths.CURATED_DIR / "replay_mull" / f"{SET}.{FMT}.parquet"
    assert paths.replay_turns_path(SET, FMT) == \
        paths.CURATED_DIR / "replay_turns" / f"{SET}.{FMT}.parquet"
    assert paths.replay_games_path(SET, FMT) == \
        paths.CURATED_DIR / "replay_turns" / f"{SET}.{FMT}.games.parquet"


def test_replay_columns_typing():
    header = ["draft_id", "num_turns", "won", "candidate_hand_1",
              "opening_hand", "user_turn_3_eot_user_life",
              "user_turn_3_eot_oppo_cards_in_hand",
              "user_turn_3_user_mana_spent",
              "user_turn_3_user_combat_damage_taken",  # int-as-string, signed
              "user_turn_3_eot_user_cards_in_hand",    # pipe list
              "oppo_turn_3_eot_user_life",             # unconsumed -> VARCHAR
              f"deck_{_synth.CARD_C}", f"sideboard_{_synth.CARD_B}"]
    columns = etl.replay_columns(header)
    assert columns["draft_id"] == "VARCHAR"
    assert columns["num_turns"] == "SMALLINT"
    assert columns["won"] == "BOOLEAN"
    assert columns["candidate_hand_1"] == "VARCHAR"
    assert columns["user_turn_3_eot_user_life"] == "FLOAT"
    assert columns["user_turn_3_eot_oppo_cards_in_hand"] == "FLOAT"
    assert columns["user_turn_3_user_mana_spent"] == "FLOAT"
    assert columns["user_turn_3_user_combat_damage_taken"] == "VARCHAR"
    assert columns["user_turn_3_eot_user_cards_in_hand"] == "VARCHAR"
    assert columns["oppo_turn_3_eot_user_life"] == "VARCHAR"
    assert columns[f"deck_{_synth.CARD_C}"] == "TINYINT"
    assert columns[f"sideboard_{_synth.CARD_B}"] == "TINYINT"


def test_user_turn_count():
    header = [f"user_turn_{t}_eot_user_life" for t in (1, 2, 3)] + ["draft_id"]
    assert etl.user_turn_count(header) == 3
    with pytest.raises(ValueError, match="non-contiguous"):
        etl.user_turn_count(["user_turn_2_eot_user_life"])
    with pytest.raises(ValueError, match="non-contiguous"):
        etl.user_turn_count(["draft_id"])


def test_game_decisions_anomaly_reasons():
    seven = [1, 2, 3, 4, 5, 6, 7]
    raw = "1|2|3|4|5|6|7"
    # A clean keep-at-7.
    reason, expanded = etl._game_decisions(0, [raw, None], raw)
    assert reason is None
    hands, kept, bottomed = expanded
    assert hands == [seven] and kept == seven and bottomed == []
    assert etl._game_decisions(None, [raw], raw)[0] == "bad_num_mulligans"
    assert etl._game_decisions(-1, [raw], raw)[0] == "bad_num_mulligans"
    # num_mulligans exceeds the available candidate columns / filled hands.
    assert etl._game_decisions(2, [raw, None], raw)[0] == "missing_candidate"
    assert etl._game_decisions(1, [raw, None], "1|2|3|4|5|6")[0] == "missing_candidate"
    # A candidate hand beyond num_mulligans+1 should not exist.
    assert etl._game_decisions(0, [raw, raw], raw)[0] == "extra_candidate"
    # Candidate hands are always exactly 7 cards.
    assert etl._game_decisions(0, ["1|2|3"], "1|2|3")[0] == "candidate_size"
    assert etl._game_decisions(0, [raw], None)[0] == "missing_opening"
    # opening_hand size must be 7 - num_mulligans.
    assert etl._game_decisions(0, [raw], "1|2|3|4|5|6")[0] == "opening_size"
    # Multiset containment: two 7s kept but the candidate has only one.
    assert etl._game_decisions(1, [raw, raw], "1|2|3|4|5|7")[0] is None
    assert etl._game_decisions(1, [raw, raw], "1|2|3|4|7|7")[0] == "subset_violation"
    assert etl._game_decisions(0, [raw.replace("7", "x")], raw)[0] == "unparseable_hand"


# ---------------------------------------------------------------------------
# curate_mulligans


def test_curate_mulligans_hand_rows(replay_raw):
    result = etl.curate_mulligans(SET, FMT)
    assert result["status"] == "CURATED"
    assert result["rows"] == 8       # 1 + 2 + 3 + 0 (dropped) + 1 + 1
    assert result["games"] == 6
    assert result["dropped"] == 1

    frame = pd.read_parquet(paths.replay_mull_path(SET, FMT))
    assert len(frame) == 8
    # One decision row per candidate hand, num_mulligans+1 per surviving game.
    assert frame.groupby("draft_id").size().to_dict() == {
        "rg0": 1, "rg1": 2, "rg2": 3, "rg4": 1, "rg5": 1}
    assert "rg3" not in set(frame["draft_id"])  # subset anomaly dropped
    # game_seq is the file row ordinal (rg3 still occupies ordinal 3).
    assert frame.set_index("draft_id")["game_seq"].to_dict() == {
        "rg0": 0, "rg1": 1, "rg2": 2, "rg4": 4, "rg5": 5}

    # Keep-at-7: kept row is decision 1; opening == candidate; nothing
    # bottomed (empty list, NOT null).
    rg0 = _rows(frame, draft_id="rg0").iloc[0]
    assert bool(rg0.kept) and rg0.decision_index == 1
    assert rg0.hand_size_if_kept == 7
    assert list(rg0.hand_card_ids) == [RID_A, RID_B, RID_C, RID_D, RID_L1, RID_L1, RID_L2]
    assert list(rg0.kept_card_ids) == list(rg0.hand_card_ids)
    assert list(rg0.bottomed_card_ids) == []
    assert bool(rg0.on_play) and bool(rg0.won)
    assert rg0.num_mulligans == 0 and rg0.opp_num_mulligans == 1

    # Single mulligan: the mulled-away 7-card hand is decision 1 with NULL
    # bottoming info; the kept 6-card decision carries kept/bottomed ids.
    rg1 = _rows(frame, draft_id="rg1").sort_values("decision_index")
    assert list(rg1["decision_index"]) == [1, 2]
    assert list(rg1["kept"]) == [False, True]
    assert list(rg1["hand_size_if_kept"]) == [7, 6]
    first, kept = rg1.iloc[0], rg1.iloc[1]
    assert list(first.hand_card_ids) == [RID_A, RID_B, RID_C, RID_D, RID_L1, RID_L2, RID_A]
    assert first.kept_card_ids is None and first.bottomed_card_ids is None
    assert list(kept.hand_card_ids) == [RID_A, RID_A, RID_B, RID_C, RID_L1, RID_L1, RID_L2]
    assert list(kept.kept_card_ids) == [RID_A, RID_B, RID_C, RID_L1, RID_L1, RID_L2]
    assert list(kept.bottomed_card_ids) == [RID_A]  # duplicate 101 bottomed
    assert not bool(kept.on_play) and not bool(kept.won)
    assert kept.user_game_win_rate_bucket == pytest.approx(0.54)

    # Double mulligan: three decisions, sizes 7/6/5, multiset bottoming of 2.
    rg2 = _rows(frame, draft_id="rg2").sort_values("decision_index")
    assert list(rg2["hand_size_if_kept"]) == [7, 6, 5]
    assert list(rg2["kept"]) == [False, False, True]
    kept2 = rg2.iloc[2]
    assert list(kept2.kept_card_ids) == [RID_B, RID_C, RID_L1, RID_L2, RID_A]
    assert list(kept2.bottomed_card_ids) == [RID_D, RID_A]

    # Compact dtypes survive the arrow schema.
    assert frame["decision_index"].dtype == "int8"
    assert frame["num_mulligans"].dtype == "int8"
    assert frame["user_n_games_bucket"].dtype == "int32"
    assert frame["kept"].dtype == bool

    meta = json.loads(paths.meta_path(paths.replay_mull_path(SET, FMT)).read_text())
    assert meta == {"source_etag": "etag-replay-1", "rows": 8,
                    "set": SET, "format": FMT, "games": 6,
                    "games_dropped": 1,
                    "anomalies": {"subset_violation": 1}}


def test_curate_mulligans_skip_and_force(replay_raw):
    assert etl.curate_mulligans(SET, FMT)["status"] == "CURATED"
    assert etl.curate_mulligans(SET, FMT)["status"] == "SKIPPED"
    assert etl.curate_mulligans(SET, FMT, force=True)["status"] == "CURATED"
    with open(paths.meta_path(replay_raw), "w") as fh:
        json.dump({"etag": "etag-replay-2"}, fh)
    assert etl.curate_mulligans(SET, FMT)["status"] == "CURATED"


def test_curate_mulligans_missing_raw(data_root):
    assert etl.curate_mulligans("NOP", FMT)["status"] == "MISSING_RAW"


# ---------------------------------------------------------------------------
# curate_turn_states


def test_curate_turn_states_hand_rows(replay_raw):
    result = etl.curate_turn_states(SET, FMT)
    assert result["status"] == "CURATED"
    assert result["rows"] == 12      # num_turns 3+2+2+1+2+2
    assert result["games"] == 6

    frame = pd.read_parquet(paths.replay_turns_path(SET, FMT))
    assert len(frame) == 12
    # Strict truncation at num_turns: the zero-fill padding on turns 3/4 of
    # rg4 (life '0.0', damage '0') must never surface as rows.
    assert frame.groupby("draft_id")["turn"].max().to_dict() == {
        "rg0": 3, "rg1": 2, "rg2": 2, "rg3": 1, "rg4": 2, "rg5": 2}
    assert (frame["turn"] <= frame["num_turns"]).all()
    assert (frame["user_life"] != 0).all()  # no padding zeros leaked

    rg0 = _rows(frame, draft_id="rg0").sort_values("turn")
    assert list(rg0["user_life"]) == [20, 20, 17]
    assert list(rg0["oppo_life"]) == [20, 18, 12]
    assert list(rg0["oppo_hand_count"]) == [7, 5, 4]
    assert list(rg0["user_hand_count"]) == [6, 4, 5]
    assert list(rg0["user_lands_count"]) == [1, 2, 2]
    assert list(rg0["oppo_lands_count"]) == [0, 1, 2]
    assert list(rg0["user_creatures_count"]) == [0, 1, 1]
    assert list(rg0["oppo_creatures_count"]) == [0, 1, 1]
    assert list(rg0["oppo_noncreatures_count"]) == [0, 0, 1]
    assert list(rg0["user_lands_played_cum"]) == [1, 2, 2]
    assert list(rg0["user_mana_spent"]) == [0, 2, 3]
    assert list(rg0["oppo_mana_spent"]) == [1, 2, 0]
    assert list(rg0["user_combat_damage_taken"]) == [0, 0, 3]
    assert list(rg0["oppo_combat_damage_taken"]) == [0, 2, 0]
    t1, t2 = rg0.iloc[0], rg0.iloc[1]
    # NaN list within num_turns means EMPTY: on the play, no turn-1 draw.
    assert list(t1.user_cards_drawn_ids) == []
    assert list(t2.user_cards_drawn_ids) == [RID_A]
    assert list(t1.user_hand_ids) == [RID_A, RID_B, RID_C, RID_D, RID_L1, RID_L2]
    assert list(t2.user_creatures_ids) == [RID_B]
    assert list(t2.oppo_creatures_ids) == [RID_OPP]
    assert (rg0["on_play"].all() and rg0["won"].all()
            and (rg0["num_turns"] == 3).all())

    # Cumulative lands stall when a land drop is missed (rg1 turn 2).
    rg1 = _rows(frame, draft_id="rg1").sort_values("turn")
    assert list(rg1["user_lands_played_cum"]) == [1, 1]
    assert list(rg1["user_combat_damage_taken"]) == [0, 4]
    assert not rg1["on_play"].any()

    # Signed combat damage and an empty (hellbent) hand within range.
    rg5 = _rows(frame, draft_id="rg5", turn=2).iloc[0]
    assert rg5.user_combat_damage_taken == -2
    assert rg5.oppo_combat_damage_taken == 6
    assert list(rg5.user_hand_ids) == []
    assert rg5.user_hand_count == 0
    assert rg5.user_life == 22 and rg5.oppo_life == 14
    assert list(rg5.user_creatures_ids) == [RID_B, RID_B]

    # The mull-anomaly game rg3 still curates here (drop is mull-only).
    assert len(_rows(frame, draft_id="rg3")) == 1

    assert frame["turn"].dtype == "int8"
    assert frame["user_life"].dtype == "int16"
    assert frame["user_combat_damage_taken"].dtype == "int16"
    assert frame["user_n_games_bucket"].dtype == "int32"

    meta = json.loads(paths.meta_path(paths.replay_turns_path(SET, FMT)).read_text())
    assert meta == {"source_etag": "etag-replay-1", "rows": 12,
                    "set": SET, "format": FMT, "games": 6,
                    "max_turn_columns": 4, "games_truncated_at_max_turn": 0,
                    "null_state_rows": 0}


def test_curate_turn_states_games_sidecar(replay_raw):
    etl.curate_turn_states(SET, FMT)
    games = pd.read_parquet(paths.replay_games_path(SET, FMT))
    assert len(games) == 6
    # game_seq is the file row ordinal; deck name-counts live here ONCE per
    # game (not duplicated onto ~9 turn rows/game) as wide TINYINT columns.
    assert list(games["game_seq"]) == [0, 1, 2, 3, 4, 5]
    assert list(games["draft_id"]) == [f"rg{i}" for i in range(6)]
    assert games[f"deck_{_synth.CARD_A}"].dtype == "int8"
    assert list(games[f"deck_{_synth.CARD_A}"]) == [2, 2, 0, 1, 2, 0]
    # Maindeck only: sideboard_* stays behind in the raw file.
    assert not [c for c in games.columns if c.startswith("sideboard_")]
    assert list(games["num_mulligans"]) == [0, 1, 2, 0, 0, 0]
    assert list(games["num_turns"]) == [3, 2, 2, 1, 2, 2]
    assert list(games["won"]) == [True, False, False, True, False, True]
    assert games["opp_rank"].isna().all()  # blank in source -> NULL

    meta = json.loads(paths.meta_path(paths.replay_games_path(SET, FMT)).read_text())
    assert meta == {"source_etag": "etag-replay-1", "rows": 6,
                    "set": SET, "format": FMT, "deck_columns": 4}

    # game_seq agrees across ALL THREE outputs (it is the join key).
    turns = pd.read_parquet(paths.replay_turns_path(SET, FMT))
    mull_result = etl.curate_mulligans(SET, FMT)
    assert mull_result["status"] == "CURATED"
    mull = pd.read_parquet(paths.replay_mull_path(SET, FMT))
    by_seq = games.set_index("game_seq")["draft_id"]
    assert (turns["game_seq"].map(by_seq) == turns["draft_id"]).all()
    assert (mull["game_seq"].map(by_seq) == mull["draft_id"]).all()


def test_curate_turn_states_skip_and_force(replay_raw):
    assert etl.curate_turn_states(SET, FMT)["status"] == "CURATED"
    assert etl.curate_turn_states(SET, FMT)["status"] == "SKIPPED"
    assert etl.curate_turn_states(SET, FMT, force=True)["status"] == "CURATED"
    # Losing one of the two outputs invalidates the pair.
    paths.replay_games_path(SET, FMT).unlink()
    assert etl.curate_turn_states(SET, FMT)["status"] == "CURATED"


def test_curate_turn_states_missing_raw(data_root):
    assert etl.curate_turn_states("NOP", FMT)["status"] == "MISSING_RAW"


# ---------------------------------------------------------------------------
# scripts/run_replay_etl.py


def test_cli_default_runs_only_existing_replay_raw(replay_script, data_root,
                                                   monkeypatch, capsys):
    for set_code, fmt in [("DSK", "PremierDraft"), ("FIN", "TradDraft")]:
        dest = paths.raw_dataset_path("replay", set_code, fmt)
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.touch()
    calls = []
    monkeypatch.setattr(replay_script.etl, "curate_mulligans",
                        lambda s, f, force=False: calls.append(("mull", s, f, force))
                        or {"status": "X"})
    monkeypatch.setattr(replay_script.etl, "curate_turn_states",
                        lambda s, f, force=False: calls.append(("turns", s, f, force))
                        or {"status": "X"})
    monkeypatch.setattr(sys, "argv", ["prog", "--force"])
    replay_script.main()
    assert calls == [("mull", "DSK", "PremierDraft", True),
                     ("turns", "DSK", "PremierDraft", True),
                     ("mull", "FIN", "TradDraft", True),
                     ("turns", "FIN", "TradDraft", True)]


def test_cli_refuses_eval_only(replay_script, monkeypatch, capsys):
    monkeypatch.setattr(sys, "argv", ["prog", "--sets", "MSH"])
    with pytest.raises(SystemExit) as excinfo:
        replay_script.main()
    assert excinfo.value.code == 2
    assert "EVAL_ONLY" in capsys.readouterr().err


def test_cli_allow_eval_only_override(replay_script, data_root, monkeypatch,
                                      capsys):
    monkeypatch.setattr(
        sys, "argv",
        ["prog", "--sets", "MSH", "--formats", "PremierDraft",
         "--allow-eval-only"])
    replay_script.main()   # no raw on disk -> both curations report missing
    out = capsys.readouterr().out
    assert out.count("MISSING_RAW") == 2


def test_cli_rejects_unknown_set(replay_script, monkeypatch, capsys):
    monkeypatch.setattr(sys, "argv", ["prog", "--sets", "ZZZ"])
    with pytest.raises(SystemExit) as excinfo:
        replay_script.main()
    assert excinfo.value.code == 2
    assert "not in the corpus registry" in capsys.readouterr().err

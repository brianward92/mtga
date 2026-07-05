"""Win-probability v1 data assembly: (game, user-turn) states -> arrays.

Sources (all resolved through mtga.lands.paths at call time):
  replay_turns parquet   one row per (game, user turn t) with end-of-turn
                         life/hand/board counts (mtga/replay/etl.py). Rows
                         are file-ordered: games contiguous, turn running
                         1..num_turns within a game. load_dataset hard-
                         verifies that ordering because the cumulative-draw
                         feature depends on it.
  .games.parquet sidecar per-game meta (num_mulligans both sides, draft_id)
                         plus deck_* TINYINT name counts; joined on game_seq
                         exactly like mtga/mulligan/data.py.

v1 features (FEATURES, 25 columns) are TABULAR ONLY — counts, life totals,
mana, mulligans, and pilot-skill buckets. No card identity anywhere; that is
the v2 feature set.

Derived columns:
  *_diff            user minus oppo (life, hand, lands, creatures,
                    non-creatures) — the summaries every baseline uses.
  user_drawn_cum    cards drawn through end of turn t (per-turn draw-list
                    lengths, cumulative within game). Excludes tutored
                    cards, which are not curated per turn.
  library_approx    deck_size - 7 + num_mulligans - user_drawn_cum. London
                    mulligans shuffle back and bottom, so each mulligan
                    LEAVES one extra card in the library. Ignores tutors and
                    mill (not in the turn curation), so it can read a card
                    or two high late in the game.
  user_wr_bucket    user_game_win_rate_bucket with its rare NaNs filled by
                    the column median (fill value kept on the dataset).

The split key (draft_id) is stored ONCE PER GAME (game_draft_id) with a
game_pos row->game map, not per turn row — ~9M python strings would dwarf
the feature matrix. Split masks expand as game_mask[data.game_pos].
"""

from dataclasses import dataclass

import numpy as np
import pandas as pd
import pyarrow.compute as pc
import pyarrow.parquet as pq

from mtga.lands import paths

FULL_HAND = 7
DECK_PREFIX = "deck_"
ANCHOR_TURN = 7
SCALE_FLOOR = 1e-6

FEATURES = [
    "turn", "on_play",
    "user_life", "oppo_life", "life_diff",
    "user_hand_count", "oppo_hand_count", "hand_diff",
    "user_lands_count", "oppo_lands_count", "lands_diff",
    "user_creatures_count", "oppo_creatures_count", "creatures_diff",
    "user_noncreatures_count", "oppo_noncreatures_count", "noncreatures_diff",
    "user_mana_spent", "oppo_mana_spent", "user_drawn_cum",
    "num_mulligans", "opp_num_mulligans",
    "user_wr_bucket", "user_n_games_bucket", "library_approx",
]

TURN_COLUMNS = [
    "game_seq", "turn", "user_life", "oppo_life",
    "user_hand_count", "oppo_hand_count",
    "user_lands_count", "oppo_lands_count",
    "user_creatures_count", "oppo_creatures_count",
    "user_noncreatures_count", "oppo_noncreatures_count",
    "user_cards_drawn_ids", "user_mana_spent", "oppo_mana_spent",
    "on_play", "won",
]


@dataclass
class WinProbData:
    """Model-ready arrays plus per-row labels/metadata."""

    X: np.ndarray             # float32 [N, len(FEATURES)] RAW feature values
    won: np.ndarray           # float32 [N] game outcome (repeated per turn)
    turn: np.ndarray          # int16 [N]
    game_pos: np.ndarray      # int32 [N] row of the per-game arrays
    game_draft_id: pd.Series  # [G] split key, one per game
    game_seq: np.ndarray      # int64 [N] join key back to the parquets
    wr_fill: float            # median used for missing wr buckets

    @property
    def n_rows(self):
        return len(self.won)

    @property
    def n_games(self):
        return len(self.game_draft_id)


def _verify_row_order(game_seq, turn):
    """Hard-fail unless rows are game-contiguous with turn = 1..n per game.

    The ETL writes this order (duckdb preserve_insertion_order stays true);
    the cumulative-draw feature silently corrupts if it ever changes, so it
    is a load-time invariant, not an assumption.
    """
    if len(game_seq) == 0:
        raise ValueError("turn-state parquet has no rows")
    step = np.diff(game_seq)
    if (step < 0).any():
        raise ValueError("turn rows are not game-contiguous "
                         "(game_seq decreases) — refusing to load")
    new_game = np.empty(len(game_seq), dtype=bool)
    new_game[0] = True
    new_game[1:] = step != 0
    if int(turn[0]) != 1 or (turn[new_game] != 1).any():
        raise ValueError("games do not start at turn 1 — refusing to load")
    within = ~new_game[1:]
    if (np.diff(turn.astype(np.int32))[within] != 1).any():
        raise ValueError("turns do not increment by 1 within a game "
                         "— refusing to load")
    return new_game


def _cumulative_within_games(values, new_game):
    """Per-row cumulative sum of non-negative values, reset at game starts."""
    cum = np.cumsum(values)
    offset = np.zeros(len(values), dtype=cum.dtype)
    starts = np.flatnonzero(new_game[1:]) + 1
    offset[starts] = cum[starts - 1]
    # cum is non-decreasing (values >= 0), so a running max forward-fills
    # each game's offset without a python-level group loop.
    return cum - np.maximum.accumulate(offset)


def load_games_sidecar(set_code, limited_type):
    """Games sidecar -> per-game arrays + a game_seq -> row lookup."""
    path = paths.replay_games_path(set_code, limited_type)
    deck_cols = [c for c in pq.read_schema(path).names
                 if c.startswith(DECK_PREFIX)]
    table = pq.read_table(
        path, columns=["game_seq", "draft_id", "num_mulligans",
                       "opp_num_mulligans"] + deck_cols)
    game_seq = table.column("game_seq").to_numpy()
    deck_size = np.zeros(len(game_seq), dtype=np.int32)
    for column in deck_cols:
        deck_size += table.column(column).to_numpy().astype(np.int32)
    lookup = np.full(int(game_seq.max()) + 1, -1, dtype=np.int32)
    lookup[game_seq] = np.arange(len(game_seq), dtype=np.int32)
    return {
        "draft_id": table.column("draft_id").to_pandas(),
        "num_mulligans": table.column("num_mulligans").to_numpy(),
        "opp_num_mulligans": table.column("opp_num_mulligans").to_numpy(),
        "deck_size": deck_size,
        "lookup": lookup,
    }


def load_dataset(set_code, limited_type):
    """Both on-disk sources -> one WinProbData (X holds RAW feature units)."""
    path = paths.replay_turns_path(set_code, limited_type)
    table = pq.read_table(
        path, columns=TURN_COLUMNS + ["user_n_games_bucket",
                                      "user_game_win_rate_bucket"])
    game_seq = table.column("game_seq").to_numpy()
    turn = table.column("turn").to_numpy().astype(np.int16)
    new_game = _verify_row_order(game_seq, turn)

    games = load_games_sidecar(set_code, limited_type)
    game_pos = games["lookup"][game_seq]
    if (game_pos < 0).any():
        raise ValueError("turn rows reference game_seq values missing from "
                         "the games sidecar")

    def col(name, dtype=np.float32):
        return table.column(name).to_numpy().astype(dtype)

    draws = pc.list_value_length(
        table.column("user_cards_drawn_ids").combine_chunks()
    ).to_numpy().astype(np.int64)
    drawn_cum = _cumulative_within_games(draws, new_game).astype(np.float32)

    wr = table.column("user_game_win_rate_bucket").to_numpy().astype(np.float64)
    wr_fill = float(np.nanmedian(wr))
    wr = np.where(np.isnan(wr), wr_fill, wr).astype(np.float32)

    user_life, oppo_life = col("user_life"), col("oppo_life")
    user_hand, oppo_hand = col("user_hand_count"), col("oppo_hand_count")
    user_lands, oppo_lands = col("user_lands_count"), col("oppo_lands_count")
    user_creatures = col("user_creatures_count")
    oppo_creatures = col("oppo_creatures_count")
    user_noncre = col("user_noncreatures_count")
    oppo_noncre = col("oppo_noncreatures_count")
    num_mulligans = games["num_mulligans"][game_pos].astype(np.float32)
    library = (games["deck_size"][game_pos].astype(np.float32)
               - FULL_HAND + num_mulligans - drawn_cum)

    columns = {
        "turn": turn.astype(np.float32),
        "on_play": col("on_play"),
        "user_life": user_life,
        "oppo_life": oppo_life,
        "life_diff": user_life - oppo_life,
        "user_hand_count": user_hand,
        "oppo_hand_count": oppo_hand,
        "hand_diff": user_hand - oppo_hand,
        "user_lands_count": user_lands,
        "oppo_lands_count": oppo_lands,
        "lands_diff": user_lands - oppo_lands,
        "user_creatures_count": user_creatures,
        "oppo_creatures_count": oppo_creatures,
        "creatures_diff": user_creatures - oppo_creatures,
        "user_noncreatures_count": user_noncre,
        "oppo_noncreatures_count": oppo_noncre,
        "noncreatures_diff": user_noncre - oppo_noncre,
        "user_mana_spent": col("user_mana_spent"),
        "oppo_mana_spent": col("oppo_mana_spent"),
        "user_drawn_cum": drawn_cum,
        "num_mulligans": num_mulligans,
        "opp_num_mulligans": games["opp_num_mulligans"][game_pos].astype(np.float32),
        "user_wr_bucket": wr,
        "user_n_games_bucket": col("user_n_games_bucket"),
        "library_approx": library,
    }
    X = np.column_stack([columns[name] for name in FEATURES]).astype(np.float32)

    return WinProbData(
        X=X, won=col("won"), turn=turn,
        game_pos=game_pos.astype(np.int32),
        game_draft_id=games["draft_id"], game_seq=game_seq,
        wr_fill=wr_fill)


# ---------------------------------------------------------------------------
# Empirical anchors + input scaling.


def state_anchors(data, turn=ANCHOR_TURN):
    """Mean game length + P(win | life-diff sign at the anchor turn).

    On the DSK Premier file this must reproduce mean_turns 8.995,
    ahead 0.689, behind 0.355 (train.EXPECTED_ANCHORS) — the data-loading
    sanity check.
    """
    diff = data.X[:, FEATURES.index("life_diff")]
    at_turn = data.turn == turn

    def cell(sel):
        n = int(sel.sum())
        return {"n": n, "win_rate": float(data.won[sel].mean()) if n else None}

    return {"mean_turns": float(data.n_rows / data.n_games),
            "turn": int(turn),
            "ahead": cell(at_turn & (diff > 0)),
            "behind": cell(at_turn & (diff < 0))}


def verify_anchors(anchors, expected, decimals=3):
    """Hard-fail unless anchors reproduce the published values exactly."""
    for key, want in expected.items():
        got = anchors.get(key)
        if isinstance(got, dict):
            got = got.get("win_rate")
        if got is None or round(got, decimals) != round(want, decimals):
            raise ValueError(
                f"anchor mismatch at {key!r}: expected {want:.{decimals}f}, "
                f"got {'missing' if got is None else round(got, decimals)}"
                " — data loading is broken, refusing to train")
    return anchors


def fit_scaler(X, idx):
    """Per-feature (mean, std) over the given rows; std floors at 1e-6."""
    sub = X[idx]
    mean = sub.mean(axis=0, dtype=np.float64).astype(np.float32)
    std = sub.std(axis=0, dtype=np.float64).astype(np.float32)
    return mean, np.maximum(std, SCALE_FLOOR)


def standardize(X, mean, std):
    """float32 standardized copy of X (models only ever see this space)."""
    return ((X - mean) / std).astype(np.float32)

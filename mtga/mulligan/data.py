"""Mulligan v1 data assembly: keep/mull decision rows -> model-ready arrays.

Sources (all resolved through mtga.lands.paths at call time):
  replay_mull parquet    one row per keep/mull decision (mtga/replay/etl.py):
                         hand_card_ids is the k-th 7-card candidate hand as
                         ARENA card ids, hand_size_if_kept = 7-(k-1), kept iff
                         k = num_mulligans+1, won is the GAME outcome.
  replay_turns .games.parquet   per-game deck sidecar (deck_<Name> TINYINT
                         counts in the 17Lands NAME namespace), join on
                         game_seq.
  cards.csv              Arena card id -> 17Lands name. Many ids map to one
                         name (alt arts, reprints; basics have several ids).
  cardfeats parquet      frozen 391-d structured card features keyed by
                         name_norm (the names.norm_17lands namespace).

The id join is therefore id -> name -> norm_17lands -> cardfeats row. A
missing link at any hop is a hard failure with the offending ids/names
listed — never silent zeros (featurize.UnmatchedNamesError semantics).

Per-decision features (assemble()):
  mean-pool + max-pool over the 7 candidate cards' 391-d feature rows,
  count-weighted mean-pool over the deck's cards, and EXTRA_COLUMNS:
  on_play, hand-size one-hot (7/6/5/<=4), n_lands/7, n_cheap_spells/7
  (nonland mana value <= 3, a castable-by-turn-3 proxy), the fraction of
  the hand's colored pips inside the deck's top-2 colors, per-color deck
  composition fractions, and the deck's land fraction. Candidate hands are
  always 7 cards (bottoming happens after the keep), so hand pools are
  uniform across hand sizes; the one-hot carries the size signal.

The counterfactual side of the decision is NOT modeled in v1: the
continuation value of mulling a size-h hand is the empirical win rate of
decision rows where a size-h candidate was mulled (those games went on to
keep at h-1 or lower), per (hand_size, on_play) — continuation_table().

Known biases (documented, not corrected in v1):
  * Kept hands are selected-on-keep: P(win | kept) is only observed for
    hands humans chose to keep, so the outcome head inherits that
    selection. v1 mitigates by evaluating the DECISION rule against the
    empirical continuation values rather than trusting calibration
    off-support (v2: IPW or joint keep+outcome modeling).
  * Bo1 (Premier) opening hands are smoothed by Arena: the first 7-card
    candidate comes from a land-count-adjusted deal, mulligan redraws do
    not. 7-card and 6-card hand distributions differ by construction,
    which the hand-size one-hot absorbs.
"""

from dataclasses import dataclass

import numpy as np
import pandas as pd
import pyarrow.compute as pc
import pyarrow.parquet as pq

from mtga.foundation.featurize import feature_blocks
from mtga.lands import names, paths

FULL_HAND = 7
HAND_SIZE_BUCKETS = (7, 6, 5, 4)   # sizes below 4 clamp into the last bucket
CHEAP_CMC = 3.0                     # "castable by turn 3" proxy threshold
TOP_COLORS = 2
MIN_CELL_N = 50                     # continuation cells thinner than this pool
DECK_PREFIX = "deck_"

DECISION_COLUMNS = [
    "draft_id", "game_seq", "decision_index", "hand_size_if_kept",
    "on_play", "kept", "won", "num_mulligans",
]

EXTRA_COLUMNS = [
    "on_play", "hand_size_7", "hand_size_6", "hand_size_5", "hand_size_le4",
    "n_lands", "n_cheap", "color_match",
    "deck_w", "deck_u", "deck_b", "deck_r", "deck_g", "deck_lands",
]


def feature_columns():
    """The 391 structured feature columns, in frozen manifest order."""
    return [c for block in feature_blocks() for c in block["columns"]]


def load_card_matrix(parquet_path=None):
    """cardfeats parquet -> (float32 [n_names, 391], name_norm -> row)."""
    path = paths.CARDFEATS_PARQUET if parquet_path is None else parquet_path
    frame = pd.read_parquet(path)
    matrix = frame[feature_columns()].to_numpy(dtype=np.float32)
    row_by_norm = {n: i for i, n in enumerate(frame["name_norm"])}
    return matrix, row_by_norm


def arena_row_lookup(row_by_norm, cards_csv=None):
    """Arena id -> cardfeats row, as a dense lookup array (-1 = unmapped).

    Unmapped slots are ids absent from cards.csv or whose name has no
    cardfeats row; they only fail if a hand actually references them.
    """
    path = paths.CARDS_CSV if cards_csv is None else cards_csv
    cards = pd.read_csv(path, usecols=["id", "name"])
    lookup = np.full(int(cards["id"].max()) + 1, -1, dtype=np.int32)
    for card_id, name in zip(cards["id"], cards["name"]):
        row = row_by_norm.get(names.norm_17lands(str(name)))
        if row is not None:
            lookup[int(card_id)] = row
    return lookup


def load_decisions(set_code, limited_type):
    """replay_mull parquet -> (meta DataFrame, int32 hand ids [N, 7])."""
    path = paths.replay_mull_path(set_code, limited_type)
    table = pq.read_table(path, columns=DECISION_COLUMNS + ["hand_card_ids"])
    hands = table.column("hand_card_ids").combine_chunks()
    lengths = pc.list_value_length(hands).to_numpy()
    if not (lengths == FULL_HAND).all():
        raise ValueError(
            f"candidate hands must have exactly {FULL_HAND} cards; "
            f"got sizes {sorted(set(lengths) - {FULL_HAND})} in {path}")
    hand_ids = hands.flatten().to_numpy().reshape(-1, FULL_HAND)
    frame = table.drop_columns(["hand_card_ids"]).to_pandas()
    return frame, np.ascontiguousarray(hand_ids, dtype=np.int32)


def hand_feature_rows(hand_ids, lookup):
    """Map Arena hand ids to cardfeats rows; unmapped ids are a hard error."""
    in_range = hand_ids < len(lookup)
    rows = np.where(in_range, lookup[np.minimum(hand_ids, len(lookup) - 1)], -1)
    if (rows < 0).any():
        missing = np.unique(hand_ids[rows < 0])
        raise ValueError(
            f"{len(missing)} Arena card id(s) in hands have no cardfeats row "
            f"(fix cards.csv or the feature parquet): {missing[:20].tolist()}")
    return rows.astype(np.int32)


def load_deck_arrays(set_code, limited_type, row_by_norm):
    """Deck sidecar -> (int8 counts [G, C], deck rows [C], game_seq lookup).

    Column order of the counts matrix matches the sidecar's deck_* columns;
    deck_rows[j] is the cardfeats row of column j's card name.
    """
    path = paths.replay_games_path(set_code, limited_type)
    deck_cols = [c for c in pq.read_schema(path).names
                 if c.startswith(DECK_PREFIX)]
    table = pq.read_table(path, columns=["game_seq"] + deck_cols)
    counts = np.column_stack(
        [table.column(c).to_numpy() for c in deck_cols]).astype(np.int8)
    game_seq = table.column("game_seq").to_numpy()

    unmatched, deck_rows = [], []
    for column in deck_cols:
        name = column[len(DECK_PREFIX):]
        row = row_by_norm.get(names.norm_17lands(name))
        if row is None:
            unmatched.append(name)
        else:
            deck_rows.append(row)
    if unmatched:
        raise ValueError(
            f"{len(unmatched)} deck column name(s) have no cardfeats row: "
            f"{unmatched[:20]}")

    game_pos = np.full(int(game_seq.max()) + 1, -1, dtype=np.int32)
    game_pos[game_seq] = np.arange(len(game_seq), dtype=np.int32)
    return counts, np.asarray(deck_rows, dtype=np.int32), game_pos


@dataclass
class MulliganData:
    """Everything assemble() needs, plus per-row labels/metadata."""

    F: np.ndarray            # float32 [n_names, 391] card features
    hand_rows: np.ndarray    # int32 [N, 7] cardfeats rows of the candidate
    deck_counts: np.ndarray  # int8 [G, C] deck name-counts per game
    F_deck: np.ndarray       # float32 [C, 391] features of the deck columns
    deck_size: np.ndarray    # float32 [G]
    game_pos: np.ndarray     # int32 [N] row of deck_counts for each decision
    extras: np.ndarray       # float32 [N, len(EXTRA_COLUMNS)]
    won: np.ndarray          # float32 [N] game outcome
    kept: np.ndarray         # bool [N]
    on_play: np.ndarray      # bool [N]
    hand_size: np.ndarray    # int8 [N] hand_size_if_kept
    num_mulligans: np.ndarray  # int8 [N]
    draft_id: pd.Series      # [N] split key
    game_seq: np.ndarray     # int64 [N]

    @property
    def n_rows(self):
        return len(self.won)

    @property
    def input_dim(self):
        return 3 * self.F.shape[1] + self.extras.shape[1]


def build_extras(F, hand_rows, deck_counts, F_deck, deck_size, game_pos,
                 on_play, hand_size):
    """float32 [N, len(EXTRA_COLUMNS)] engineered features (see module doc)."""
    col = {name: i for i, name in enumerate(feature_columns())}
    land = F[:, col["type_land"]]
    mana_value = F[:, col["cmc_scaled"]] * 8.0
    cheap = ((land < 0.5) & (mana_value <= CHEAP_CMC + 1e-6)).astype(np.float32)
    pip_cols = [col[f"pip_{c}"] for c in "wubrg"]
    pips = F[:, pip_cols] * 4.0
    color_cols = [col[f"color_{c}"] for c in "wubrg"]

    n_lands = land[hand_rows].sum(axis=1)
    n_cheap = cheap[hand_rows].sum(axis=1)
    hand_pips = pips[hand_rows].sum(axis=1)              # [N, 5]

    counts = deck_counts.astype(np.float32)
    deck_colors = counts @ F_deck[:, color_cols]          # [G, 5]
    deck_lands = counts @ F_deck[:, col["type_land"]]     # [G]

    # Top-2 deck colors (ties resolve in WUBRG order); zero-count colors
    # never count as "top" even in near-colorless decks.
    order = np.argsort(-deck_colors, axis=1, kind="stable")
    top_mask = np.zeros_like(deck_colors)
    np.put_along_axis(top_mask, order[:, :TOP_COLORS], 1.0, axis=1)
    top_mask *= deck_colors > 0

    row_top = top_mask[game_pos]
    total_pips = hand_pips.sum(axis=1)
    color_match = np.where(
        total_pips > 0,
        (hand_pips * row_top).sum(axis=1) / np.maximum(total_pips, 1e-9),
        1.0)  # a hand with no colored pips casts in any deck

    sizes = np.clip(hand_size, HAND_SIZE_BUCKETS[-1], FULL_HAND)
    onehot = (sizes[:, None]
              == np.asarray(HAND_SIZE_BUCKETS, dtype=sizes.dtype)[None, :])

    return np.column_stack([
        on_play.astype(np.float32),
        onehot.astype(np.float32),
        n_lands / FULL_HAND,
        n_cheap / FULL_HAND,
        color_match,
        (deck_colors / deck_size[:, None])[game_pos],
        (deck_lands / deck_size)[game_pos],
    ]).astype(np.float32)


def load_dataset(set_code, limited_type):
    """All on-disk sources -> one MulliganData."""
    F, row_by_norm = load_card_matrix()
    lookup = arena_row_lookup(row_by_norm)
    frame, hand_ids = load_decisions(set_code, limited_type)
    hand_rows = hand_feature_rows(hand_ids, lookup)
    deck_counts, deck_rows, game_lookup = load_deck_arrays(
        set_code, limited_type, row_by_norm)

    game_seq = frame["game_seq"].to_numpy()
    game_pos = game_lookup[game_seq]
    if (game_pos < 0).any():
        raise ValueError("decision rows reference game_seq values missing "
                         "from the deck sidecar")

    deck_size = np.maximum(
        deck_counts.sum(axis=1, dtype=np.int32), 1).astype(np.float32)
    on_play = frame["on_play"].to_numpy().astype(bool)
    hand_size = frame["hand_size_if_kept"].to_numpy()
    F_deck = F[deck_rows]
    extras = build_extras(F, hand_rows, deck_counts, F_deck, deck_size,
                          game_pos, on_play, hand_size)

    return MulliganData(
        F=F, hand_rows=hand_rows, deck_counts=deck_counts, F_deck=F_deck,
        deck_size=deck_size, game_pos=game_pos, extras=extras,
        won=frame["won"].to_numpy().astype(np.float32),
        kept=frame["kept"].to_numpy().astype(bool),
        on_play=on_play, hand_size=hand_size,
        num_mulligans=frame["num_mulligans"].to_numpy(),
        draft_id=frame["draft_id"], game_seq=game_seq)


def assemble(data, idx):
    """Model input for a row-index batch: float32 [B, data.input_dim]."""
    hand = data.F[data.hand_rows[idx]]                    # [B, 7, 391]
    pos = data.game_pos[idx]
    counts = data.deck_counts[pos].astype(np.float32)
    deck_mean = counts @ data.F_deck / data.deck_size[pos][:, None]
    return np.concatenate(
        [hand.mean(axis=1), hand.max(axis=1), deck_mean, data.extras[idx]],
        axis=1)


# ---------------------------------------------------------------------------
# Empirical anchors + the counterfactual continuation table.


def mulligan_anchors(data, mask=None):
    """Win rate of KEPT rows by num_mulligans: {mulls: {n, win_rate}}.

    On the DSK Premier file this must reproduce 0 -> 0.562, 1 -> 0.416,
    2 -> 0.248 (see train.EXPECTED_ANCHORS) — the data-loading sanity check.
    """
    sel = data.kept if mask is None else (data.kept & mask)
    out = {}
    for mulls in sorted(np.unique(data.num_mulligans[sel])):
        cell = sel & (data.num_mulligans == mulls)
        out[int(mulls)] = {"n": int(cell.sum()),
                           "win_rate": float(data.won[cell].mean())}
    return out


def verify_anchors(anchors, expected, decimals=3):
    """Hard-fail unless anchors reproduce the published win rates exactly."""
    for mulls, want in expected.items():
        got = anchors.get(int(mulls))
        if got is None or round(got["win_rate"], decimals) != round(want, decimals):
            raise ValueError(
                f"anchor mismatch at {mulls} mulligan(s): expected "
                f"{want:.{decimals}f}, got "
                f"{'missing' if got is None else round(got['win_rate'], decimals)}"
                " — data loading is broken, refusing to train")
    return anchors


def continuation_table(data, mask=None, min_cell_n=MIN_CELL_N):
    """Empirical E[win | mulled a size-h hand], per (hand_size, on_play).

    A mulled decision row at hand_size h means the game continued to keep
    at h-1 or lower, so its outcome IS the observed continuation value of
    mulling from h. Pooled per-size rows back up sparse cells.
    """
    mulled = ~data.kept if mask is None else (~data.kept & mask)
    cells, pooled = [], []
    for size in sorted(np.unique(data.hand_size[mulled]), reverse=True):
        at_size = mulled & (data.hand_size == size)
        for play in (True, False):
            sel = at_size & (data.on_play == play)
            if sel.any():
                cells.append({"hand_size": int(size), "on_play": play,
                              "n": int(sel.sum()),
                              "win_rate": float(data.won[sel].mean())})
        pooled.append({"hand_size": int(size), "n": int(at_size.sum()),
                       "win_rate": float(data.won[at_size].mean())})
    return {"cells": cells, "pooled": pooled, "min_cell_n": int(min_cell_n),
            "n_mulled": int(mulled.sum())}


def continuation_value(table, hand_size, on_play, min_n=None):
    """Continuation value of mulling from hand_size, with sparse fallbacks.

    Preference order: the (hand_size, on_play) cell if it has min_n
    observations, else the pooled hand_size row (any n), else the nearest
    LARGER size's pooled row (sizes this small are essentially unobserved;
    borrowing a larger size's value overstates the continuation, which
    only nudges the rule toward mulling on a handful of rows).
    """
    min_n = table.get("min_cell_n", MIN_CELL_N) if min_n is None else min_n
    cells = {(c["hand_size"], c["on_play"]): c for c in table["cells"]}
    pooled = {c["hand_size"]: c for c in table["pooled"]}
    for size in range(int(min(hand_size, FULL_HAND)), FULL_HAND + 1):
        cell = cells.get((size, bool(on_play)))
        if cell is not None and cell["n"] >= min_n:
            return cell["win_rate"]
        pool = pooled.get(size)
        if pool is not None and pool["n"] > 0:
            return pool["win_rate"]
    raise ValueError("continuation table has no usable rows")

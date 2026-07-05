"""Curate raw 17Lands replay dumps into decision- and state-level parquet.

Replay files are one row per game and ~2,500 columns wide: game meta,
deck_*/sideboard_* card-NAME counts, candidate_hand_1..7 + opening_hand
(pipe-delimited ARENA CARD IDS — a different namespace than the name-keyed
count columns; ids resolve via cards.csv), and up to 30 per-player-turn
blocks user_turn_N_*/oppo_turn_N_*.

Two curations, both streaming (duckdb scans the csv.gz; nothing is ever
fully materialized):

curate_mulligans -> curated/replay_mull/<SET>.<FMT>.parquet
    ONE ROW PER KEEP/MULL DECISION: the k-th 7-card candidate hand for
    k = 1..num_mulligans+1, kept iff k == num_mulligans+1. The kept row also
    carries the London-bottoming outcome: kept_card_ids (opening_hand, the
    post-bottoming hand) and bottomed_card_ids (last candidate minus
    opening, a multiset difference). Games whose mulligan record is
    inconsistent (opening_hand not a multiset-subset of the last candidate,
    wrong hand sizes, missing candidate hands — ~1 per 2,000 games) are
    dropped, with per-reason counters in the .meta.json sidecar.

curate_turn_states -> curated/replay_turns/<SET>.<FMT>.parquet
                      (+ <SET>.<FMT>.games.parquet)
    ONE ROW PER (game, user turn t) for t = 1..num_turns: end-of-turn life,
    hand/board identities and counts, that turn's draws, mana spent, and
    signed combat damage (negative values occur). THE BIG FOOTGUN: numeric
    turn columns ZERO-FILL past the end of the game (life reads 0.0 through
    turn 30), so rows are emitted strictly for t <= num_turns and values
    past num_turns are never read. NULL list fields within range mean EMPTY
    and become []. The 40-card deck is NOT duplicated onto the ~9 turn rows
    per game: it lives once per game in the .games.parquet sidecar (wide
    TINYINT name-count columns, mirroring the curated game-data layout,
    which keeps the turn table lean and lets deck-aware models join on
    game_seq).

game_seq is the 0-based CSV row ordinal — the join key across all three
outputs. Both curations scan with duckdb's default
preserve_insertion_order=true (never disable it here), which pins result
order to file order; curate_turn_states additionally hard-verifies that its
two outputs agree per game_seq.

Not curated in v1: abilities columns (ability-ID namespace, not card IDs),
the oppo_turn_N_* snapshot blocks, and attack/block/kill lists.
"""

import re
from collections import Counter

import duckdb
import pyarrow as pa
import pyarrow.parquet as pq

from mtga.lands import decode, paths
from mtga.lands.etl import (
    GAME_META_TYPES,
    _columns_struct,
    _is_current,
    _quote,
    _source_etag,
    _write_curated_meta,
    read_header,
)

DECK_PREFIX = "deck_"
SIDEBOARD_PREFIX = "sideboard_"
FULL_HAND = 7
BATCH_ROWS = 65536

_CANDIDATE = re.compile(r"^candidate_hand_(\d+)$")
_USER_TURN_LIFE = re.compile(r"^user_turn_(\d+)_eot_user_life$")
# Turn columns read as FLOAT (the official helper says float16, which crashes
# pandas — and duckdb has no float16 anyway). Everything else in the turn
# blocks stays VARCHAR: pipe-lists, and combat_damage_taken (int-as-string,
# can be NEGATIVE).
_FLOAT_TURN = re.compile(
    r"^user_turn_\d+_(eot_user_life|eot_oppo_life|eot_oppo_cards_in_hand"
    r"|user_mana_spent|oppo_mana_spent)$"
)

REQUIRED_MULL_COLUMNS = (
    "draft_id", "on_play", "won", "num_mulligans", "candidate_hand_1", "opening_hand",
)
REQUIRED_TURNS_COLUMNS = ("draft_id", "on_play", "won", "num_turns")

# Per-turn columns curate_turn_states consumes (suffixes of user_turn_N_).
TURN_FIELDS = (
    "cards_drawn", "lands_played",
    "user_mana_spent", "oppo_mana_spent",
    "user_combat_damage_taken", "oppo_combat_damage_taken",
    "eot_user_cards_in_hand", "eot_oppo_cards_in_hand",
    "eot_user_lands_in_play", "eot_oppo_lands_in_play",
    "eot_user_creatures_in_play", "eot_oppo_creatures_in_play",
    "eot_user_non_creatures_in_play", "eot_oppo_non_creatures_in_play",
    "eot_user_life", "eot_oppo_life",
)

MULL_SCHEMA = pa.schema([
    ("draft_id", pa.string()),
    ("game_seq", pa.int64()),
    ("match_number", pa.int8()),
    ("game_number", pa.int8()),
    ("game_time", pa.string()),
    ("decision_index", pa.int8()),      # k, 1-based
    ("hand_card_ids", pa.list_(pa.int32())),
    ("hand_size_if_kept", pa.int8()),   # 7 - (k-1)
    ("on_play", pa.bool_()),
    ("kept", pa.bool_()),               # k == num_mulligans + 1
    ("won", pa.bool_()),
    ("kept_card_ids", pa.list_(pa.int32())),      # kept row only, else NULL
    ("bottomed_card_ids", pa.list_(pa.int32())),  # kept row only, else NULL
    ("num_mulligans", pa.int8()),
    ("opp_num_mulligans", pa.int8()),
    ("user_n_games_bucket", pa.int32()),
    ("user_game_win_rate_bucket", pa.float32()),
])


def replay_columns(header):
    """read_csv column->duckdb-type map for a replay header.

    Only consumed columns need real types (duckdb's CSV reader has
    projection pushdown); the rest read as VARCHAR if ever touched.
    """
    columns = {}
    for column in header:
        if column in GAME_META_TYPES:
            columns[column] = GAME_META_TYPES[column]
        elif column.startswith(DECK_PREFIX) or column.startswith(SIDEBOARD_PREFIX):
            columns[column] = "TINYINT"
        elif _FLOAT_TURN.match(column):
            columns[column] = "FLOAT"
        else:
            columns[column] = "VARCHAR"
    return columns


def user_turn_count(header):
    """Number of user_turn_N blocks (30 in real files; synthetic files vary)."""
    turns = sorted(int(m.group(1)) for c in header if (m := _USER_TURN_LIFE.match(c)))
    if turns != list(range(1, len(turns) + 1)) or not turns:
        raise ValueError(f"non-contiguous user_turn blocks in header: {turns}")
    return turns[-1]


def _require(header, names, source):
    missing = [c for c in names if c not in header]
    if missing:
        raise ValueError(f"required replay columns missing from {source}: {missing}")


def _meta_expr(name, present):
    """Canonical meta projection: absent columns become typed NULLs."""
    if name in present:
        return _quote(name)
    return f"CAST(NULL AS {GAME_META_TYPES[name]}) AS {_quote(name)}"


def _connect(workdir):
    con = duckdb.connect()
    con.execute("SET memory_limit='8GB'")
    # game_seq is row_number() over the csv scan; file order is only
    # guaranteed while preserve_insertion_order stays at its default (true).
    con.execute(f"SET temp_directory='{workdir / '.duckdb_tmp'}'")
    return con


# --------------------------------------------------------------------------
# Turn-state curation


def _ids_expr(column):
    """Pipe-list VARCHAR -> INTEGER[]; NULL (empty within range) -> []."""
    q = _quote(column)
    return (f"coalesce(TRY_CAST(string_split({q}, '|') AS INTEGER[]), "
            f"CAST([] AS INTEGER[]))")


def _len_expr(column):
    q = _quote(column)
    return f"CASE WHEN {q} IS NULL THEN 0 ELSE len(string_split({q}, '|')) END"


def _count_expr(column):
    return f"CAST({_len_expr(column)} AS SMALLINT)"


def _turn_struct(t):
    """struct_pack of one user turn's state (field order = output order)."""
    def col(field):
        return f"user_turn_{t}_{field}"

    def life(field):  # FLOAT-read '20.0'; NULL preserved (padding never read)
        return f"CAST({_quote(col(field))} AS SMALLINT)"

    def mana(field):
        return f"CAST(coalesce({_quote(col(field))}, 0) AS SMALLINT)"

    def damage(field):  # int-as-string, may be negative
        return f"coalesce(TRY_CAST({_quote(col(field))} AS SMALLINT), 0)"

    lands_cum = " + ".join(
        _len_expr(f"user_turn_{i}_lands_played") for i in range(1, t + 1))
    fields = [
        f"turn := CAST({t} AS TINYINT)",
        f"user_life := {life('eot_user_life')}",
        f"oppo_life := {life('eot_oppo_life')}",
        f"user_hand_ids := {_ids_expr(col('eot_user_cards_in_hand'))}",
        f"user_hand_count := {_count_expr(col('eot_user_cards_in_hand'))}",
        f"oppo_hand_count := CAST({_quote(col('eot_oppo_cards_in_hand'))} AS SMALLINT)",
        f"user_lands_count := {_count_expr(col('eot_user_lands_in_play'))}",
        f"oppo_lands_count := {_count_expr(col('eot_oppo_lands_in_play'))}",
        f"user_creatures_count := {_count_expr(col('eot_user_creatures_in_play'))}",
        f"oppo_creatures_count := {_count_expr(col('eot_oppo_creatures_in_play'))}",
        f"user_noncreatures_count := {_count_expr(col('eot_user_non_creatures_in_play'))}",
        f"oppo_noncreatures_count := {_count_expr(col('eot_oppo_non_creatures_in_play'))}",
        f"user_creatures_ids := {_ids_expr(col('eot_user_creatures_in_play'))}",
        f"oppo_creatures_ids := {_ids_expr(col('eot_oppo_creatures_in_play'))}",
        f"user_lands_played_cum := CAST({lands_cum} AS SMALLINT)",
        f"user_cards_drawn_ids := {_ids_expr(col('cards_drawn'))}",
        f"user_mana_spent := {mana('user_mana_spent')}",
        f"oppo_mana_spent := {mana('oppo_mana_spent')}",
        f"user_combat_damage_taken := {damage('user_combat_damage_taken')}",
        f"oppo_combat_damage_taken := {damage('oppo_combat_damage_taken')}",
    ]
    return "struct_pack(" + ", ".join(fields) + ")"


_TURN_STATE_FIELDS = (
    "turn", "user_life", "oppo_life", "user_hand_ids", "user_hand_count",
    "oppo_hand_count", "user_lands_count", "oppo_lands_count",
    "user_creatures_count", "oppo_creatures_count",
    "user_noncreatures_count", "oppo_noncreatures_count",
    "user_creatures_ids", "oppo_creatures_ids", "user_lands_played_cum",
    "user_cards_drawn_ids", "user_mana_spent", "oppo_mana_spent",
    "user_combat_damage_taken", "oppo_combat_damage_taken",
)

# Meta layout of the per-game sidecar (canonical order; deck_* follow).
GAMES_META = tuple(GAME_META_TYPES)


def curate_turn_states(set_code, limited_type, force=False):
    """Replay csv.gz -> turn-state parquet + per-game deck sidecar."""
    raw = paths.raw_dataset_path("replay", set_code, limited_type)
    out_turns = paths.replay_turns_path(set_code, limited_type)
    out_games = paths.replay_games_path(set_code, limited_type)
    if not raw.exists():
        return {"status": "MISSING_RAW", "path": str(raw)}
    raw_etag = _source_etag(raw)
    if not force and _is_current(out_turns, raw_etag) and _is_current(out_games, raw_etag):
        return {"status": "SKIPPED", "path": str(out_turns)}
    source = decode.ensure_decoded(raw)

    header = read_header(source)
    _require(header, REQUIRED_TURNS_COLUMNS, source)
    max_turn = user_turn_count(header)
    _require(header, [f"user_turn_{t}_{f}" for t in range(1, max_turn + 1)
                      for f in TURN_FIELDS], source)
    present = set(header)
    columns_arg = _columns_struct(replay_columns(header))
    deck_cols = [c for c in header if c.startswith(DECK_PREFIX)]

    out_turns.parent.mkdir(parents=True, exist_ok=True)
    games_tmp = out_games.parent / f".{out_games.name}.part"
    turns_tmp = out_turns.parent / f".{out_turns.name}.part"
    con = _connect(out_turns.parent)

    games_select = ", ".join(
        ["row_number() OVER () - 1 AS game_seq"]
        + [_meta_expr(name, present) for name in GAMES_META]
        + [_quote(c) for c in deck_cols])
    con.execute(
        f"""
        COPY (SELECT {games_select} FROM read_csv(?, header=true, columns={columns_arg}))
        TO '{games_tmp}' (FORMAT PARQUET, COMPRESSION ZSTD)
        """,
        [str(source)],
    )

    structs = ", ".join(_turn_struct(t) for t in range(1, max_turn + 1))
    scalars = ["on_play", "won", "num_turns",
               "user_n_games_bucket", "user_game_win_rate_bucket"]
    scalar_select = ", ".join(_meta_expr(name, present) for name in scalars)
    state_select = ", ".join(f"s.{f} AS {f}" for f in _TURN_STATE_FIELDS)
    con.execute(
        f"""
        COPY (
            SELECT draft_id, game_seq, {state_select},
                   on_play, won, num_turns,
                   user_n_games_bucket, user_game_win_rate_bucket
            FROM (
                SELECT * EXCLUDE (turns), unnest(turns) AS s
                FROM (
                    SELECT row_number() OVER () - 1 AS game_seq,
                           draft_id, {scalar_select},
                           [{structs}][1:least(greatest(coalesce(num_turns, 0), 0), {max_turn})] AS turns
                    FROM read_csv(?, header=true, columns={columns_arg})
                )
            )
        ) TO '{turns_tmp}' (FORMAT PARQUET, COMPRESSION ZSTD)
        """,
        [str(source)],
    )

    # game_seq is the cross-output join key: verify the two scans agreed.
    mismatched = con.execute(
        f"""
        SELECT count(*) FROM read_parquet('{turns_tmp}') t
        JOIN read_parquet('{games_tmp}') g USING (game_seq)
        WHERE t.draft_id <> g.draft_id
        """
    ).fetchone()[0]
    game_rows, want_turn_rows, truncated = con.execute(
        f"""
        SELECT count(*),
               coalesce(sum(least(greatest(coalesce(num_turns, 0), 0), {max_turn})), 0),
               coalesce(sum(CASE WHEN num_turns > {max_turn} THEN 1 ELSE 0 END), 0)
        FROM read_parquet('{games_tmp}')
        """
    ).fetchone()
    turn_rows, null_state = con.execute(
        f"""
        SELECT count(*),
               coalesce(sum(CASE WHEN user_life IS NULL OR oppo_life IS NULL
                                   OR oppo_hand_count IS NULL THEN 1 ELSE 0 END), 0)
        FROM read_parquet('{turns_tmp}')
        """
    ).fetchone()
    con.close()
    if mismatched or turn_rows != want_turn_rows:
        games_tmp.unlink(missing_ok=True)
        turns_tmp.unlink(missing_ok=True)
        raise RuntimeError(
            f"game_seq mismatch between turn and game outputs for "
            f"{set_code}.{limited_type}: {mismatched} conflicting rows, "
            f"{turn_rows} turn rows vs {want_turn_rows} expected")

    turns_tmp.replace(out_turns)
    games_tmp.replace(out_games)
    _write_curated_meta(
        out_turns, raw_etag, int(turn_rows),
        set=set_code, format=limited_type, games=int(game_rows),
        max_turn_columns=max_turn, games_truncated_at_max_turn=int(truncated),
        null_state_rows=int(null_state))
    _write_curated_meta(
        out_games, raw_etag, int(game_rows),
        set=set_code, format=limited_type, deck_columns=len(deck_cols))
    return {"status": "CURATED", "path": str(out_turns),
            "games_path": str(out_games), "rows": int(turn_rows),
            "games": int(game_rows)}


# --------------------------------------------------------------------------
# Mulligan curation


def _split_ids(raw):
    if not raw:
        return None
    return [int(x) for x in raw.split("|")]


def _game_decisions(num_mulligans, candidates, opening):
    """(anomaly_reason, None) or (None, (hands, kept_ids, bottomed_ids)).

    hands = the num_mulligans+1 candidate hands actually drawn; kept_ids =
    opening_hand (post-bottoming); bottomed_ids = last candidate minus
    kept_ids as a multiset (order follows the candidate list; list order is
    not meaningful in the source data).
    """
    if num_mulligans is None or num_mulligans < 0:
        return "bad_num_mulligans", None
    kept_index = num_mulligans + 1
    if kept_index > len(candidates):
        return "missing_candidate", None
    try:
        hands = [_split_ids(c) for c in candidates]
        kept_ids = _split_ids(opening)
    except ValueError:
        return "unparseable_hand", None
    if any(hands[k] is None for k in range(kept_index)):
        return "missing_candidate", None
    if any(hands[k] is not None for k in range(kept_index, len(hands))):
        return "extra_candidate", None
    if any(len(hands[k]) != FULL_HAND for k in range(kept_index)):
        return "candidate_size", None
    if kept_ids is None:
        return "missing_opening", None
    if len(kept_ids) != FULL_HAND - num_mulligans:
        return "opening_size", None

    need = Counter(kept_ids)
    bottomed = []
    for card_id in hands[kept_index - 1]:
        if need[card_id] > 0:
            need[card_id] -= 1
        else:
            bottomed.append(card_id)
    if +need:  # kept cards not present in the last candidate hand
        return "subset_violation", None
    return None, (hands[:kept_index], kept_ids, bottomed)


def curate_mulligans(set_code, limited_type, force=False):
    """Replay csv.gz -> one-row-per-keep/mull-decision parquet."""
    raw = paths.raw_dataset_path("replay", set_code, limited_type)
    out = paths.replay_mull_path(set_code, limited_type)
    if not raw.exists():
        return {"status": "MISSING_RAW", "path": str(raw)}
    raw_etag = _source_etag(raw)
    if not force and _is_current(out, raw_etag):
        return {"status": "SKIPPED", "path": str(out)}
    source = decode.ensure_decoded(raw)

    header = read_header(source)
    _require(header, REQUIRED_MULL_COLUMNS, source)
    present = set(header)
    columns_arg = _columns_struct(replay_columns(header))
    cand_cols = sorted((c for c in header if _CANDIDATE.match(c)),
                       key=lambda c: int(_CANDIDATE.match(c).group(1)))

    meta_cols = ["draft_id", "match_number", "game_number", "game_time",
                 "on_play", "won", "num_mulligans", "opp_num_mulligans",
                 "user_n_games_bucket", "user_game_win_rate_bucket"]
    select = ", ".join([_meta_expr(name, present) for name in meta_cols]
                       + [_quote(c) for c in cand_cols] + [_quote("opening_hand")])

    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.parent / f".{out.name}.part"
    con = _connect(out.parent)
    result = con.execute(
        f"SELECT {select} FROM read_csv(?, header=true, columns={columns_arg})",
        [str(source)],
    )
    reader = (result.to_arrow_reader(BATCH_ROWS)
              if hasattr(result, "to_arrow_reader")
              else result.fetch_record_batch(BATCH_ROWS))

    anomalies = Counter()
    game_seq = 0
    decisions = 0
    writer = pq.ParquetWriter(tmp, MULL_SCHEMA, compression="zstd")
    try:
        for batch in reader:
            data = batch.to_pydict()
            hands_in = [data[c] for c in cand_cols] + [data["opening_hand"]]
            out_cols = {name: [] for name in MULL_SCHEMA.names}
            for (draft_id, match_number, game_number, game_time, on_play, won,
                 num_mulligans, opp_num_mulligans, n_games, wr_bucket,
                 *hands) in zip(*(data[c] for c in meta_cols), *hands_in):
                seq = game_seq
                game_seq += 1
                reason, expanded = _game_decisions(num_mulligans, hands[:-1], hands[-1])
                if reason:
                    anomalies[reason] += 1
                    continue
                cand_hands, kept_ids, bottomed = expanded
                for k, hand in enumerate(cand_hands, start=1):
                    kept = k == len(cand_hands)
                    out_cols["draft_id"].append(draft_id)
                    out_cols["game_seq"].append(seq)
                    out_cols["match_number"].append(match_number)
                    out_cols["game_number"].append(game_number)
                    out_cols["game_time"].append(game_time)
                    out_cols["decision_index"].append(k)
                    out_cols["hand_card_ids"].append(hand)
                    out_cols["hand_size_if_kept"].append(FULL_HAND - (k - 1))
                    out_cols["on_play"].append(on_play)
                    out_cols["kept"].append(kept)
                    out_cols["won"].append(won)
                    out_cols["kept_card_ids"].append(kept_ids if kept else None)
                    out_cols["bottomed_card_ids"].append(bottomed if kept else None)
                    out_cols["num_mulligans"].append(num_mulligans)
                    out_cols["opp_num_mulligans"].append(opp_num_mulligans)
                    out_cols["user_n_games_bucket"].append(n_games)
                    out_cols["user_game_win_rate_bucket"].append(wr_bucket)
                    decisions += 1
            if out_cols["draft_id"]:
                writer.write_batch(
                    pa.RecordBatch.from_pydict(out_cols, schema=MULL_SCHEMA))
    finally:
        writer.close()
        con.close()
    tmp.replace(out)

    dropped = sum(anomalies.values())
    _write_curated_meta(
        out, raw_etag, decisions,
        set=set_code, format=limited_type, games=game_seq,
        games_dropped=dropped, anomalies=dict(anomalies))
    return {"status": "CURATED", "path": str(out), "rows": decisions,
            "games": game_seq, "dropped": dropped}

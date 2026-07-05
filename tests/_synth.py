"""Synthetic-data builders shared by the draft-assistant tests.

All builders write into whatever the (monkeypatched) mtga.lands.paths layout
points at, so tests stay hermetic. Card names deliberately cover the nasty
header cases: commas, apostrophes, and embedded double quotes.
"""

import csv
import gzip
import json

import pandas as pd

from mtga.lands import paths

SET = "TST"
FMT = "PremierDraft"

# Vocabulary in deliberate non-alphabetical order (order preservation matters).
CARD_A = "Lightning Bolt"               # grp 101; alt art 201; out-of-set 301
CARD_B = "Alibou, Ancient Witness"      # grp 102 (comma)
CARD_C = 'Henzie "Toolbox" Torre'       # grp 103 (embedded double quote)
CARD_D = "Kaito's Pursuit"              # grp 104 (apostrophe)
VOCAB = [CARD_A, CARD_B, CARD_C, CARD_D]

GRP = {CARD_A: 101, CARD_B: 102, CARD_C: 103, CARD_D: 104}
ALIASES_A = [101, 201, 301]  # booster, in-set alt art, out-of-set printing

DRAFT_META_COLS = [
    "expansion", "event_type", "draft_id", "rank",
    "event_match_wins", "event_match_losses",
    "pack_number", "pick_number", "pick",
    "user_n_games_bucket", "user_game_win_rate_bucket",
    "mystery_meta",  # not in DRAFT_META_TYPES -> must classify as VARCHAR
]

GAME_META_COLS = [
    "expansion", "event_type", "draft_id", "game_time", "build_index",
    "match_number", "game_number", "main_colors", "on_play",
    "num_mulligans", "num_turns", "won",
    "user_n_games_bucket", "user_game_win_rate_bucket",
]

GAME_PREFIXES = ["opening_hand_", "drawn_", "tutored_", "deck_", "sideboard_"]


def write_draft_csv(dest, rows, vocab=None, pool_order=None, etag="etag-draft-1"):
    """Write a gzipped 17Lands-style draft CSV plus its .meta.json sidecar.

    rows: dicts with draft_id, pack_number, pick_number, pick, and optional
    pack/pool ({name: count}) and games_bucket/wr_bucket overrides.
    """
    vocab = VOCAB if vocab is None else vocab
    pool_order = vocab if pool_order is None else pool_order
    header = (
        DRAFT_META_COLS
        + [f"pack_card_{n}" for n in vocab]
        + [f"pool_{n}" for n in pool_order]
    )
    dest.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(dest, "wt", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(header)
        for row in rows:
            meta = [
                SET, FMT, row["draft_id"], "gold", 3, 1,
                row["pack_number"], row["pick_number"], row["pick"],
                row.get("games_bucket", 500), row.get("wr_bucket", 0.60),
                "arbitrary",
            ]
            pack = [row.get("pack", {}).get(n, 0) for n in vocab]
            pool = [row.get("pool", {}).get(n, 0) for n in pool_order]
            writer.writerow(meta + pack + pool)
    if etag is not None:
        with open(paths.meta_path(dest), "w") as fh:
            json.dump({"etag": etag}, fh)


OLD_DRAFT_META_COLS = [
    "user_n_matches_bucket", "user_match_win_rate_bucket",
    "expansion", "event_type", "draft_id", "draft_time",
    "event_match_wins", "event_match_losses",
    "pack_number", "pick_number", "pick",
    "mystery_meta",
]


def write_old_draft_csv(dest, rows, era="match_buckets", vocab=None,
                        etag="etag-old-1"):
    """2021-era draft CSV: match buckets first, no rank/pick_2/*_rate columns.

    era="match_buckets_rank" adds the MID/VOW `user_rank` column. rows use
    the same dict shape as write_draft_csv (plus optional user_rank).
    """
    vocab = VOCAB if vocab is None else vocab
    meta_cols = list(OLD_DRAFT_META_COLS)
    if era == "match_buckets_rank":
        meta_cols.insert(2, "user_rank")
    header = (
        meta_cols
        + [f"pack_card_{n}" for n in vocab]
        + [f"pool_{n}" for n in vocab]
    )
    dest.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(dest, "wt", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(header)
        for row in rows:
            values = {
                "user_n_matches_bucket": row.get("games_bucket", 100),
                "user_match_win_rate_bucket": row.get("wr_bucket", 0.54),
                "user_rank": row.get("user_rank", "platinum"),
                "expansion": SET, "event_type": FMT,
                "draft_id": row["draft_id"],
                "draft_time": "2021-04-20 12:00:00",
                "event_match_wins": 3, "event_match_losses": 1,
                "pack_number": row["pack_number"],
                "pick_number": row["pick_number"],
                "pick": row["pick"],
                "mystery_meta": "arbitrary",
            }
            meta = [values[c] for c in meta_cols]
            pack = [row.get("pack", {}).get(n, 0) for n in vocab]
            pool = [row.get("pool", {}).get(n, 0) for n in vocab]
            writer.writerow(meta + pack + pool)
    if etag is not None:
        with open(paths.meta_path(dest), "w") as fh:
            json.dump({"etag": etag}, fh)


def hand_draft_rows(pick_base=0):
    """Two clean 4-pick drafts plus one unknown-pick row.

    Hand-computed expectations (offset normalizes picks to 1-indexed):
      ATA:  A 1.5, B 1.5, C 3.5, D 3.5   (pick_count 2 each)
      ALSA: A 1.5, B 1.5, C 3.5, D 3.5   (seen_count 2 each)
    d3's pack columns are all zero, so it adds nothing to ALSA/seen.
    """
    A, B, C, D = VOCAB

    def pk(*names):
        return {n: 1 for n in names}

    b = pick_base
    return [
        dict(draft_id="d1", pack_number=1, pick_number=b + 0, pick=A,
             pack=pk(A, B, C, D), pool={}),
        dict(draft_id="d1", pack_number=1, pick_number=b + 1, pick=B,
             pack=pk(B, C, D), pool=pk(A)),
        dict(draft_id="d1", pack_number=1, pick_number=b + 2, pick=C,
             pack=pk(C, D), pool=pk(A, B)),
        dict(draft_id="d1", pack_number=1, pick_number=b + 3, pick=D,
             pack=pk(D), pool=pk(A, B, C)),
        dict(draft_id="d2", pack_number=1, pick_number=b + 0, pick=B,
             pack=pk(A, B, C, D), pool={}),
        dict(draft_id="d2", pack_number=1, pick_number=b + 1, pick=A,
             pack=pk(A, C, D), pool=pk(B)),
        dict(draft_id="d2", pack_number=1, pick_number=b + 2, pick=D,
             pack=pk(C, D), pool=pk(A, B)),
        dict(draft_id="d2", pack_number=1, pick_number=b + 3, pick=C,
             pack=pk(C), pool=pk(A, B, D)),
        # Pick name outside the vocabulary -> pick_index -1 (warning path).
        dict(draft_id="d3", pack_number=1, pick_number=b + 0,
             pick="Unknown Card", pack={}, pool={}),
    ]


def write_game_csv(dest, games=None, names=None, prefix_names=None,
                   etag="etag-game-1"):
    """Write a gzipped 17Lands-style game CSV plus its .meta.json sidecar.

    games: dicts with won, main_colors, and per-prefix {name: count} maps
    (keys oh/drawn/tutored/deck/sideboard). prefix_names overrides the card
    list for individual prefixes (to provoke the mismatch ValueError).
    """
    names = VOCAB if names is None else names
    games = hand_game_rows() if games is None else games
    prefix_names = prefix_names or {}
    per_prefix = {p: prefix_names.get(p, names) for p in GAME_PREFIXES}
    header = GAME_META_COLS + [
        f"{p}{n}" for p in GAME_PREFIXES for n in per_prefix[p]
    ]
    key = {"opening_hand_": "oh", "drawn_": "drawn", "tutored_": "tutored",
           "deck_": "deck", "sideboard_": "sideboard"}
    dest.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(dest, "wt", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(header)
        for i, game in enumerate(games):
            meta = [
                SET, FMT, f"gd{i}", "2026-01-01 00:00:00", 0, 1, 1,
                game["main_colors"], "true", 0, 9,
                "true" if game["won"] else "false", 500, 0.60,
            ]
            counts = [
                game.get(key[p], {}).get(n, 0)
                for p in GAME_PREFIXES
                for n in per_prefix[p]
            ]
            writer.writerow(meta + counts)
    if etag is not None:
        with open(paths.meta_path(dest), "w") as fh:
            json.dump({"etag": etag}, fh)


def hand_game_rows():
    """Six games with hand-computable per-card win rates.

    Per card (games in which it appears / wins), with won = [T,T,F,T,F,T]:
      A: oh {1,3} w{1} -> 0.5 | drawn {2,3} w{2} -> 0.5 | deck {1..5} w{1,2,4} -> 0.6
         GIH = oh|drawn = {1,2,3} w{1,2} -> 2/3 | GNS = deck&~GIH = {4,5} w{4} -> 0.5
         IWD = 2/3 - 1/2 = 1/6
      B: oh {1,2,3,4} w{1,2,4} -> 0.75 | drawn none -> NaN | deck {1..6} -> 2/3
         GIH {1,2,3,4} -> 0.75 | GNS {5,6} w{6} -> 0.5 | IWD 0.25
      C: deck {1} only, never seen -> GIH NaN (0 games), GNS {1} -> 1.0
      D: sideboard only -> every family 0 games, shrunk == p0
    GIH pooled: wins 2+3=5 over games 3+4=7 -> p0 = 5/7.
    Colors: WU 4 games 3 wins (0.75), BR 2 games 1 win (0.5).
    """
    A, B, C, D = VOCAB
    return [
        dict(won=True, main_colors="WU", oh={A: 1, B: 1},
             deck={A: 1, B: 1, C: 1}, sideboard={D: 1}),
        dict(won=True, main_colors="WU", oh={B: 1}, drawn={A: 1},
             deck={A: 1, B: 1}),
        dict(won=False, main_colors="WU", oh={A: 1, B: 1}, drawn={A: 1},
             deck={A: 2, B: 1}),
        dict(won=True, main_colors="WU", oh={B: 1}, deck={A: 1, B: 1}),
        dict(won=False, main_colors="BR", deck={A: 1, B: 1}),
        dict(won=True, main_colors="BR", deck={B: 1}),
    ]


def write_card_store():
    """Synthetic card_store.parquet at paths.CARD_STORE_PARQUET.

    Lightning Bolt has three printings (in-set booster 101, in-set alt art
    201, out-of-set 301); "Alt Only" exists only as in-set non-booster (501)
    and out-of-set booster (502); "Bonus Blast" (401) only outside TST.
    """
    def row(grp_id, expansion, name, rarity, colors, mv, booster):
        return dict(
            grp_id=grp_id, expansion=expansion, name=name, base_name=name,
            rarity=rarity, color_identity=colors, mana_value=float(mv),
            types="Creature", is_booster=booster,
            scryfall_id=f"scry-{grp_id}", collector_number=str(grp_id),
            colors=colors, mana_cost=f"{{{int(mv)}}}", type_line="Creature",
            image_small_url=f"https://img.test/{grp_id}-small.jpg",
            image_normal_url=f"https://img.test/{grp_id}.jpg",
            match="exact",
        )

    frame = pd.DataFrame([
        row(101, SET, CARD_A, "common", "R", 1, True),
        row(201, SET, CARD_A, "common", "R", 1, False),
        row(301, "OTH", CARD_A, "common", "R", 1, True),
        row(102, SET, CARD_B, "uncommon", "W", 3, True),
        row(103, SET, CARD_C, "rare", "U", 3, True),
        row(104, SET, CARD_D, "common", "G", 2, True),
        row(401, "BON", "Bonus Blast", "rare", "R", 2, True),
        row(501, SET, "Alt Only", "common", "B", 2, False),
        row(502, "OTH", "Alt Only", "common", "B", 2, True),
    ])
    paths.CARD_STORE_PARQUET.parent.mkdir(parents=True, exist_ok=True)
    frame.to_parquet(paths.CARD_STORE_PARQUET, index=False)
    return frame


def ratings_rows():
    """17Lands card_ratings-style payload; all common so rarity prior is 0.

    Quality math for HeuristicRatingsModel (n=5000 >> MIN_GIH_GAMES=200):
      rates [.62, .60, .59, .55] -> mean .59; only 4 trusted -> std fixed .03
      z = [1, 1/3, 0, -4/3]; weight = 5000/5200; quality = weight * z
    """
    stats = [(CARD_A, 101, "R", 0.62), (CARD_B, 102, "W", 0.60),
             (CARD_C, 103, "U", 0.59), (CARD_D, 104, "G", 0.55)]
    rows = [
        dict(name=name, mtga_id=grp, color=color, rarity="common",
             ever_drawn_win_rate=wr, ever_drawn_game_count=5000,
             opening_hand_win_rate=wr - 0.01, drawn_win_rate=wr - 0.02,
             drawn_improvement_win_rate=0.04, avg_seen=2.5, avg_pick=2.0,
             url=f"https://img.17l/{grp}.png")
        for name, grp, color, wr in stats
    ]
    # No mtga_id -> must be skipped by every consumer.
    rows.append(dict(name="No Arena Id", mtga_id=None, color="W",
                     rarity="common", ever_drawn_win_rate=0.5,
                     ever_drawn_game_count=10))
    return rows


def write_ratings_cache(set_code=SET, limited_type=FMT, date_str="2026-01-01",
                        rows=None):
    dated = paths.card_ratings_path(set_code, limited_type, date_str)
    dated.parent.mkdir(parents=True, exist_ok=True)
    with open(dated, "w") as fh:
        json.dump(ratings_rows() if rows is None else rows, fh)
    return paths.repoint_latest(dated)


# ---------------------------------------------------------------------------
# Replay fixtures (mtga/replay/etl.py). Arena card ids are plain ints in a
# namespace unrelated to the deck_*/sideboard_* card-NAME count columns.

REPLAY_TURN_COLS = 4  # real files carry 30 user_turn blocks; synth carries 4

# Arena ids used by the hand-computed replay games.
RID_A, RID_B, RID_C, RID_D = 101, 102, 103, 104   # spells (match GRP values)
RID_L1, RID_L2 = 111, 112                         # lands
RID_OPP = 555                                     # an opponent creature
RID_GHOST = 999                                   # never in any candidate hand

REPLAY_META_COLS = [
    "expansion", "event_type", "draft_id", "draft_time", "build_index",
    "match_number", "game_number", "game_time", "rank", "opp_rank",
    "main_colors", "splash_colors", "on_play", "num_mulligans",
    "opp_num_mulligans", "opp_colors", "num_turns", "won",
]

# user_turn_N_* suffixes exactly as in the real DSK header (32 columns).
USER_TURN_SUFFIXES = [
    "cards_drawn", "cards_tutored", "cards_discarded", "lands_played",
    "creatures_cast", "non_creatures_cast",
    "user_instants_sorceries_cast", "oppo_instants_sorceries_cast",
    "user_abilities", "oppo_abilities",
    "creatures_attacked", "creatures_blocked", "creatures_unblocked",
    "creatures_blocking",
    "oppo_combat_damage_taken", "user_combat_damage_taken",
    "user_creatures_killed_combat", "oppo_creatures_killed_combat",
    "user_creatures_killed_non_combat", "oppo_creatures_killed_non_combat",
    "user_mana_spent", "oppo_mana_spent",
    "eot_user_cards_in_hand", "eot_oppo_cards_in_hand",
    "eot_user_lands_in_play", "eot_oppo_lands_in_play",
    "eot_user_creatures_in_play", "eot_oppo_creatures_in_play",
    "eot_user_non_creatures_in_play", "eot_oppo_non_creatures_in_play",
    "eot_user_life", "eot_oppo_life",
]
# oppo_turn_N_* blocks lack the user-only draw/tutor identity columns.
OPPO_TURN_SUFFIXES = [s for s in USER_TURN_SUFFIXES
                      if s not in ("cards_drawn", "cards_tutored")]


def _replay_zero_fill(suffix):
    """Column value past num_turns: the real files' padding footgun —
    numerics zero-fill (life reads '0.0' through turn 30), lists go empty."""
    if suffix.endswith("_life") or suffix.endswith("mana_spent") \
            or suffix == "eot_oppo_cards_in_hand":
        return "0.0"
    if suffix.endswith("combat_damage_taken"):
        return "0"
    return ""


def _replay_cell(value):
    if isinstance(value, (list, tuple)):
        return "|".join(str(v) for v in value)
    return str(value)


def write_replay_csv(dest, games=None, names=None, etag="etag-replay-1",
                     turn_cols=REPLAY_TURN_COLS):
    """Write a gzipped 17Lands-style replay CSV plus its .meta.json sidecar.

    games: dicts with draft_id, on_play, won, num_mulligans, num_turns,
    candidate_hands (list of id-lists), opening_hand (id list), turns
    ({t: {user_turn suffix: value}}; lists are pipe-joined), deck/sideboard
    ({name: count}), and optional meta overrides. Every turn column not
    supplied gets the zero-fill padding value, exactly like the real files.
    """
    names = VOCAB if names is None else names
    games = hand_replay_games() if games is None else games
    header = (
        REPLAY_META_COLS
        + [f"candidate_hand_{k}" for k in range(1, 8)]
        + ["opening_hand"]
        + [f"{who}_turn_{t}_{s}"
           for t in range(1, turn_cols + 1)
           for who, suffixes in (("user", USER_TURN_SUFFIXES),
                                 ("oppo", OPPO_TURN_SUFFIXES))
           for s in suffixes]
        + ["user_total_cards_drawn", "user_total_mana_spent"]
        + [f"deck_{n}" for n in names]
        + [f"sideboard_{n}" for n in names]
        + ["user_n_games_bucket", "user_game_win_rate_bucket"]
        + [f"oppo_turn_{t}_cards_drawn_or_tutored" for t in range(1, turn_cols + 1)]
        + ["oppo_total_cards_drawn_or_tutored"]
    )
    dest.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(dest, "wt", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(header)
        for i, game in enumerate(games):
            cands = game.get("candidate_hands", [])
            row = [
                SET, FMT, game["draft_id"], "2024-09-24 12:00:00", 0,
                game.get("match_number", 1), 1, "2024-09-24 19:00:00",
                game.get("rank", "gold"), "", game.get("main_colors", "WU"),
                "", game["on_play"], game["num_mulligans"],
                game.get("opp_num_mulligans", 0), "UB", game["num_turns"],
                game["won"],
            ]
            row += [_replay_cell(cands[k]) if k < len(cands) else ""
                    for k in range(7)]
            row.append(_replay_cell(game.get("opening_hand", [])))
            for t in range(1, turn_cols + 1):
                overrides = game.get("turns", {}).get(t, {})
                for who, suffixes in (("user", USER_TURN_SUFFIXES),
                                      ("oppo", OPPO_TURN_SUFFIXES)):
                    for s in suffixes:
                        if who == "user" and s in overrides:
                            row.append(_replay_cell(overrides[s]))
                        else:
                            row.append(_replay_zero_fill(s))
            row += [7, 12]  # unconsumed totals passthrough
            row += [game.get("deck", {}).get(n, 0) for n in names]
            row += [game.get("sideboard", {}).get(n, 0) for n in names]
            row += [game.get("games_bucket", 500), game.get("wr_bucket", 0.60)]
            row += ["0"] * turn_cols + ["9"]
            writer.writerow(row)
    if etag is not None:
        with open(paths.meta_path(dest), "w") as fh:
            json.dump({"etag": etag}, fh)


def hand_replay_games():
    """Six replay games with hand-computable curation output.

    Mulligan decisions (games are file rows 0..5 -> game_seq):
      rg0 keep-at-7 (1 row), rg1 single mull (2), rg2 double mull (3),
      rg3 subset anomaly (DROPPED, 0), rg4 keep (1), rg5 keep (1) -> 8 rows.
    Turn rows: num_turns 3+2+2+1+2+2 = 12, never past num_turns (rg4's
    turn-3/4 columns hold zero-fill padding that must not leak).
    """
    return [
        # rg0: clean keep, on play; 3 turns; turn-1 draw is EMPTY (on play).
        dict(
            draft_id="rg0", on_play=True, won=True, num_mulligans=0,
            opp_num_mulligans=1, num_turns=3,
            candidate_hands=[[RID_A, RID_B, RID_C, RID_D, RID_L1, RID_L1, RID_L2]],
            opening_hand=[RID_A, RID_B, RID_C, RID_D, RID_L1, RID_L1, RID_L2],
            deck={CARD_A: 2, CARD_B: 1, CARD_C: 1, CARD_D: 1},
            sideboard={CARD_D: 1},
            turns={
                1: {"lands_played": [RID_L1],
                    "eot_user_cards_in_hand": [RID_A, RID_B, RID_C, RID_D, RID_L1, RID_L2],
                    "eot_oppo_cards_in_hand": "7.0",
                    "eot_user_lands_in_play": [RID_L1],
                    "eot_user_life": "20.0", "eot_oppo_life": "20.0",
                    "user_mana_spent": "0.0", "oppo_mana_spent": "1.0"},
                2: {"cards_drawn": [RID_A], "lands_played": [RID_L2],
                    "eot_user_cards_in_hand": [RID_A, RID_A, RID_C, RID_D],
                    "eot_oppo_cards_in_hand": "5.0",
                    "eot_user_lands_in_play": [RID_L1, RID_L2],
                    "eot_oppo_lands_in_play": [RID_L1],
                    "eot_user_creatures_in_play": [RID_B],
                    "eot_oppo_creatures_in_play": [RID_OPP],
                    "eot_user_life": "20.0", "eot_oppo_life": "18.0",
                    "user_mana_spent": "2.0", "oppo_mana_spent": "2.0",
                    "oppo_combat_damage_taken": "2"},
                3: {"cards_drawn": [RID_L2],
                    "eot_user_cards_in_hand": [RID_A, RID_A, RID_C, RID_D, RID_L2],
                    "eot_oppo_cards_in_hand": "4.0",
                    "eot_user_lands_in_play": [RID_L1, RID_L2],
                    "eot_oppo_lands_in_play": [RID_L1, RID_L2],
                    "eot_user_creatures_in_play": [RID_B],
                    "eot_oppo_creatures_in_play": [RID_OPP],
                    "eot_oppo_non_creatures_in_play": [RID_OPP],
                    "eot_user_life": "17.0", "eot_oppo_life": "12.0",
                    "user_mana_spent": "3.0", "oppo_mana_spent": "0.0",
                    "user_combat_damage_taken": "3"},
            },
        ),
        # rg1: single mulligan on the draw; bottoming drops a duplicate 101.
        dict(
            draft_id="rg1", on_play=False, won=False, num_mulligans=1,
            num_turns=2, wr_bucket=0.54,
            candidate_hands=[
                [RID_A, RID_B, RID_C, RID_D, RID_L1, RID_L2, RID_A],
                [RID_A, RID_A, RID_B, RID_C, RID_L1, RID_L1, RID_L2],
            ],
            opening_hand=[RID_A, RID_B, RID_C, RID_L1, RID_L1, RID_L2],
            deck={CARD_A: 2, CARD_B: 2},
            turns={
                1: {"cards_drawn": [RID_D],
                    "eot_user_cards_in_hand": [RID_A, RID_B, RID_C, RID_D, RID_L1, RID_L2],
                    "eot_oppo_cards_in_hand": "6.0",
                    "eot_user_lands_in_play": [RID_L1],
                    "lands_played": [RID_L1],
                    "eot_user_life": "20.0", "eot_oppo_life": "20.0"},
                2: {"cards_drawn": [RID_B],
                    "eot_user_cards_in_hand": [RID_A, RID_B, RID_B, RID_C, RID_D, RID_L2],
                    "eot_oppo_cards_in_hand": "5.0",
                    "eot_user_lands_in_play": [RID_L1],
                    "eot_oppo_lands_in_play": [RID_L1, RID_L2],
                    "eot_oppo_creatures_in_play": [RID_OPP],
                    "eot_user_life": "16.0", "eot_oppo_life": "20.0",
                    "user_combat_damage_taken": "4"},
            },
        ),
        # rg2: double mulligan; kept 5, bottomed [104, 101] in candidate order.
        dict(
            draft_id="rg2", on_play=True, won=False, num_mulligans=2,
            num_turns=2,
            candidate_hands=[
                [RID_A, RID_B, RID_C, RID_D, RID_L1, RID_L2, RID_B],
                [RID_B, RID_C, RID_D, RID_D, RID_L1, RID_L1, RID_L2],
                [RID_B, RID_C, RID_D, RID_L1, RID_L2, RID_A, RID_A],
            ],
            opening_hand=[RID_B, RID_C, RID_L1, RID_L2, RID_A],
            deck={CARD_B: 1, CARD_C: 1},
            turns={
                1: {"lands_played": [RID_L1],
                    "eot_user_cards_in_hand": [RID_B, RID_C, RID_L2, RID_A],
                    "eot_oppo_cards_in_hand": "7.0",
                    "eot_user_lands_in_play": [RID_L1],
                    "eot_user_life": "20.0", "eot_oppo_life": "20.0"},
                2: {"eot_user_cards_in_hand": [RID_B, RID_C, RID_L2, RID_A],
                    "eot_oppo_cards_in_hand": "6.0",
                    "eot_user_lands_in_play": [RID_L1],
                    "eot_user_life": "15.0", "eot_oppo_life": "20.0"},
            },
        ),
        # rg3: subset anomaly — opening_hand holds an id (999) that is not in
        # candidate_hand_1. Dropped from replay_mull only; its turn/game rows
        # still curate.
        dict(
            draft_id="rg3", on_play=True, won=True, num_mulligans=0,
            num_turns=1,
            candidate_hands=[[RID_A, RID_B, RID_C, RID_D, RID_L1, RID_L2, RID_L2]],
            opening_hand=[RID_A, RID_B, RID_C, RID_D, RID_L1, RID_L2, RID_GHOST],
            deck={CARD_A: 1},
            turns={
                1: {"eot_user_cards_in_hand": [RID_A, RID_B, RID_C, RID_D, RID_L1, RID_L2],
                    "eot_oppo_cards_in_hand": "7.0", "lands_played": [RID_L2],
                    "eot_user_lands_in_play": [RID_L2],
                    "eot_user_life": "20.0", "eot_oppo_life": "20.0"},
            },
        ),
        # rg4: zero-fill padding — num_turns=2, turn 3/4 columns keep padding
        # values ('0.0' life etc.) that must never surface as rows.
        dict(
            draft_id="rg4", on_play=False, won=False, num_mulligans=0,
            num_turns=2,
            candidate_hands=[[RID_A, RID_A, RID_B, RID_C, RID_L1, RID_L1, RID_L2]],
            opening_hand=[RID_A, RID_A, RID_B, RID_C, RID_L1, RID_L1, RID_L2],
            deck={CARD_A: 2, CARD_B: 1, CARD_C: 1},
            turns={
                1: {"cards_drawn": [RID_D], "lands_played": [RID_L1],
                    "eot_user_cards_in_hand": [RID_A, RID_A, RID_B, RID_C, RID_D, RID_L1, RID_L2],
                    "eot_oppo_cards_in_hand": "7.0",
                    "eot_user_lands_in_play": [RID_L1],
                    "eot_user_life": "20.0", "eot_oppo_life": "20.0"},
                2: {"cards_drawn": [RID_C], "lands_played": [RID_L1],
                    "eot_user_cards_in_hand": [RID_A, RID_A, RID_B, RID_C, RID_C, RID_D, RID_L2],
                    "eot_oppo_cards_in_hand": "6.0",
                    "eot_user_lands_in_play": [RID_L1, RID_L1],
                    "eot_user_life": "18.0", "eot_oppo_life": "19.0"},
            },
        ),
        # rg5: negative combat damage on turn 2, and an EMPTY hand within
        # range (hellbent) that must curate as [] rather than NULL.
        dict(
            draft_id="rg5", on_play=True, won=True, num_mulligans=0,
            num_turns=2,
            candidate_hands=[[RID_B, RID_B, RID_C, RID_D, RID_L1, RID_L2, RID_L2]],
            opening_hand=[RID_B, RID_B, RID_C, RID_D, RID_L1, RID_L2, RID_L2],
            deck={CARD_B: 2},
            turns={
                1: {"lands_played": [RID_L1],
                    "eot_user_cards_in_hand": [RID_B, RID_B, RID_C, RID_D, RID_L2, RID_L2],
                    "eot_oppo_cards_in_hand": "7.0",
                    "eot_user_lands_in_play": [RID_L1],
                    "eot_user_life": "20.0", "eot_oppo_life": "20.0"},
                2: {"eot_user_cards_in_hand": [],
                    "eot_oppo_cards_in_hand": "5.0",
                    "eot_user_lands_in_play": [RID_L1],
                    "eot_user_creatures_in_play": [RID_B, RID_B],
                    "eot_user_life": "22.0", "eot_oppo_life": "14.0",
                    "user_combat_damage_taken": "-2",
                    "oppo_combat_damage_taken": "6",
                    "user_mana_spent": "4.0"},
            },
        ),
    ]


# ---------------------------------------------------------------------------
# Mulligan-model fixtures (mtga/mulligan): the Arena-id -> 17Lands-name map
# (cards.csv) and a hand-computable frozen card-feature parquet covering the
# replay games' hand ids. Lands 111/112 appear only in hands, never in the
# deck_* name columns, exactly like the real files' basics.

CARD_L1, CARD_L2 = "Plains", "Island"
RID_A_ALT = 201  # second printing of CARD_A: many ids map to one name

# name -> (mana value, {pip color: count}, colors, type). CARD_D's mana value
# 5 makes it the only non-land above the cheap-spell threshold (cmc <= 3).
CARDFEAT_SPEC = {
    CARD_A: (1, {"r": 1}, "r", "instant"),
    CARD_B: (3, {"w": 1}, "w", "creature"),
    CARD_C: (3, {"u": 2}, "u", "creature"),
    CARD_D: (5, {"g": 1}, "g", "creature"),
    CARD_L1: (0, {}, "", "land"),
    CARD_L2: (0, {}, "", "land"),
}


def write_mull_cards_csv():
    """cards.csv (17Lands id->name map) for the replay fixtures' Arena ids."""
    rows = [
        (RID_A, CARD_A), (RID_A_ALT, CARD_A), (RID_B, CARD_B),
        (RID_C, CARD_C), (RID_D, CARD_D), (RID_L1, CARD_L1), (RID_L2, CARD_L2),
    ]
    paths.CARDS_CSV.parent.mkdir(parents=True, exist_ok=True)
    with open(paths.CARDS_CSV, "w", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(["id", "expansion", "name", "rarity", "color_identity",
                         "mana_value", "types", "is_booster"])
        for card_id, name in rows:
            writer.writerow([card_id, SET, name, "common", "C", 1.0,
                             "Creature", True])
    return paths.CARDS_CSV


def write_cardfeats():
    """Synthetic cardfeats parquet with the real 391-column frozen layout."""
    from mtga.foundation.featurize import feature_blocks
    from mtga.lands import names

    columns = [c for block in feature_blocks() for c in block["columns"]]
    rows = []
    for name, (mana_value, pips, colors, card_type) in CARDFEAT_SPEC.items():
        row = dict.fromkeys(columns, 0.0)
        row["cmc_scaled"] = mana_value / 8.0
        row[f"cmc_is_{mana_value}"] = 1.0
        for color, count in pips.items():
            row[f"pip_{color}"] = count / 4.0
        for color in colors:
            row[f"color_{color}"] = 1.0
        row[f"type_{card_type}"] = 1.0
        rows.append({"name_display": name,
                     "name_norm": names.norm_17lands(name), **row})
    frame = pd.DataFrame(rows)
    paths.CARDFEATS_PARQUET.parent.mkdir(parents=True, exist_ok=True)
    frame.to_parquet(paths.CARDFEATS_PARQUET, index=False)
    return frame


def mulligan_training_games(n=40):
    """n replay games with a deterministic crc32 split behavior.

    draft_id mull00..mull{n-1}: game i wins iff i is even, mulligans once
    iff i % 5 == 0 (so both the crc32-val and train halves see kept wins,
    kept losses, and mulled decisions for n >= 40 at val_permille=500).
    """
    keep7 = [RID_A, RID_B, RID_C, RID_D, RID_L1, RID_L1, RID_L2]
    mull7 = [RID_A, RID_A, RID_B, RID_C, RID_L1, RID_L1, RID_L2]
    games = []
    for i in range(n):
        mulls = 1 if i % 5 == 0 else 0
        games.append(dict(
            draft_id=f"mull{i:02d}", on_play=i % 2 == 0, won=i % 2 == 0,
            num_mulligans=mulls, num_turns=1,
            candidate_hands=[keep7] if mulls == 0 else [keep7, mull7],
            opening_hand=keep7 if mulls == 0
            else [RID_A, RID_A, RID_B, RID_C, RID_L1, RID_L2],
            deck={CARD_A: 7, CARD_B: 6, CARD_C: 5, CARD_D: 2},
        ))
    return games


WINPROB_TURN_COLS = 12  # up to 11 user turns in the win-prob training fixture


def winprob_training_games(n=60):
    """n multi-turn replay games for the win-probability v1 smoke test.

    draft_id wp00..wp{n-1} (the crc32 split at permille 500 leaves both
    outcomes in train and val). game i wins iff i is even; num_turns ramps
    3..11 so all four turn buckets (1-3/4-6/7-9/10+) are populated. Life
    trajectories:
      i % 3 in (0, 1): the winner pulls ahead on life (life_diff sign tracks
                       `won`, so the models have real signal), and
      i % 3 == 2:      both players stay at life parity (life_diff == 0),
                       seeding the economics parity-curve/exchange states.
    Every turn from 2 on draws one card, so user_drawn_cum increments.
    """
    hand = [RID_A, RID_B, RID_C]
    games = []
    for i in range(n):
        won = i % 2 == 0
        on_play = i % 2 == 0
        num_turns = 3 + (i % 9)         # 3..11
        parity = i % 3 == 2
        turns = {}
        for t in range(1, num_turns + 1):
            decay = min(2 * t, 19)
            if parity:
                user_life = oppo_life = 20 - min(t, 19)
            elif won:
                user_life, oppo_life = 20, 20 - decay
            else:
                user_life, oppo_life = 20 - decay, 20
            spec = {
                "eot_user_cards_in_hand": hand,
                "eot_oppo_cards_in_hand": f"{max(7 - t, 0)}.0",
                "eot_user_lands_in_play": [RID_L1] * min(t, 6),
                "eot_oppo_lands_in_play": [RID_L2] * min(t, 6),
                "eot_user_creatures_in_play": [RID_B] * min(t, 3),
                "eot_oppo_creatures_in_play": [RID_OPP] * min(max(t - 1, 0), 3),
                "eot_user_life": f"{user_life}.0",
                "eot_oppo_life": f"{oppo_life}.0",
                "user_mana_spent": f"{min(t, 6)}.0",
                "oppo_mana_spent": f"{min(t, 6)}.0",
            }
            if t >= 2 or not on_play:
                spec["cards_drawn"] = [RID_A]
            if t <= 6:
                spec["lands_played"] = [RID_L1]
            turns[t] = spec
        games.append(dict(
            draft_id=f"wp{i:02d}", on_play=on_play, won=won,
            num_mulligans=i % 3, opp_num_mulligans=(i + 1) % 3,
            num_turns=num_turns, deck={CARD_A: 17, CARD_B: 12, CARD_C: 11},
            turns=turns,
        ))
    return games


# ---------------------------------------------------------------------------
# DraftFM foundation serving fixtures (registry tier + OnnxDraftFMModel).

FOUNDATION_MANIFEST_HASH = "synth-manifest-hash"
DRAFTFM_D = 4          # stub embedding dim == feature dim (identity encoder)
DRAFTFM_NULL = 7.0     # constants.npz pool_null_input fill value


class StubOrtSession:
    """Deterministic stand-in for onnxruntime.InferenceSession over the three
    DraftFM graphs. card_encoder is the identity (feat dim == d), set_encoder
    is the mean card embedding, and the scorer scores each pack candidate by
    the sum of its embedding — so with diag features the ranking is exact.
    The scorer's feeds are captured for input-wiring assertions."""

    last_scorer_feeds = None

    def __init__(self, path, providers=None):
        self.path = str(path)

    def run(self, outputs, feeds):
        import numpy as np

        if self.path.endswith("card_encoder.onnx"):
            return [feeds["features"].astype(np.float32)]
        if self.path.endswith("set_encoder.onnx"):
            return [feeds["card_emb"].mean(axis=0)]
        StubOrtSession.last_scorer_feeds = {
            k: np.array(v) for k, v in feeds.items()
        }
        logits = feeds["pack_emb"].sum(axis=-1).astype(np.float32)
        logits[feeds["pack_mask"]] = float("-inf")
        return [logits]


def write_foundation_version(tag="v1", fmt=None, wr_id=33, games_id=6,
                             manifest_hash=FOUNDATION_MANIFEST_HASH,
                             point_latest=True):
    """Foundation version dir (3 stub graphs + constants + meta) + latest."""
    import numpy as np

    base = paths.MODELS_DIR / "_foundation"
    out = (base / fmt / tag) if fmt else (base / tag)
    out.mkdir(parents=True, exist_ok=True)
    for graph in ["card_encoder.onnx", "set_encoder.onnx", "scorer.onnx"]:
        (out / graph).write_bytes(b"stub-onnx")
    np.savez(out / "constants.npz",
             pool_null_input=np.full(DRAFTFM_D, DRAFTFM_NULL,
                                     dtype=np.float32))
    meta = {
        "model_id": f"_foundation/{tag}",
        "kind": "draftfm-zeroshot",
        "manifest_hash": manifest_hash,
        "serving": {"wr_id": wr_id, "games_id": games_id},
        "config": {"d_model": DRAFTFM_D},
    }
    with open(out / "meta.json", "w") as fh:
        json.dump(meta, fh)
    if point_latest:
        latest = out.parent / "latest"
        if latest.is_symlink():
            latest.unlink()
        latest.symlink_to(out.name)
    return out


def write_draftfm_assets(set_code=SET,
                         manifest_hash=FOUNDATION_MANIFEST_HASH,
                         picks_per_pack=14):
    """Per-set assets npz: diag features so stub scores are A>B>C>D (3,2,1,0);
    Lightning Bolt carries its alias grpIds (alt art + out-of-set)."""
    import numpy as np

    features = np.diag([3.0, 2.0, 1.0, 0.0]).astype(np.float16)
    grp_lists = {
        CARD_A: ALIASES_A,
        CARD_B: [GRP[CARD_B]],
        CARD_C: [GRP[CARD_C]],
        CARD_D: [GRP[CARD_D]],
    }
    path = paths.set_assets_path(set_code)
    path.parent.mkdir(parents=True, exist_ok=True)
    np.savez(path,
             features=features,
             rarity_ids=np.array([0, 1, 2, 0], dtype=np.uint8),
             names=np.array(VOCAB),
             grp_ids=json.dumps(grp_lists),
             manifest_hash=manifest_hash,
             picks_per_pack=picks_per_pack,
             set=set_code)
    return path

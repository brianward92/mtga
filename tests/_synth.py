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

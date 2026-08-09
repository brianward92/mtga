"""Curate raw 17Lands CSV dumps into typed parquet via duckdb.

The raw files are wide (2 columns per card for draft data, 5 per card for
game data; 700-1,900 columns total) and 0.5-5M rows. duckdb streams the
gzipped CSV straight to zstd parquet with card-count columns as TINYINT,
which turns ~150MB gz / ~2GB decoded CSV into a fast columnar file.

Draft files also gain a `pick_index` column: the picked card's index in the
pack-card vocabulary (the ordered pack_card_* column suffixes). That ordering
is written to a .vocab.json sidecar and becomes the model vocabulary for the
set — treat it as immutable once a model has trained against it.

Schema-era normalization: 17Lands draft files come in three header eras
(match_buckets: STX/AFR; match_buckets_rank: MID/VOW; modern: NEO onward).
curate_draft projects every era onto one canonical modern column layout —
old names renamed via DRAFT_META_ALIASES, absent canonical columns emitted
as typed NULLs — so downstream code never branches on era. Modern files
(e.g. SOS/MSH) curate byte-identically to the pre-normalization output.
"""

import csv
import gzip
import json

import duckdb

from mtga.lands import decode, paths

PACK_PREFIX = "pack_card_"
POOL_PREFIX = "pool_"
GAME_CARD_PREFIXES = ["opening_hand_", "drawn_", "tutored_", "deck_", "sideboard_"]

DRAFT_META_TYPES = {
    "expansion": "VARCHAR",
    "event_type": "VARCHAR",
    "draft_id": "VARCHAR",
    "draft_time": "VARCHAR",
    "rank": "VARCHAR",
    "event_match_wins": "TINYINT",
    "event_match_losses": "TINYINT",
    "pack_number": "TINYINT",
    "pick_number": "TINYINT",
    "pick": "VARCHAR",
    "pick_2": "VARCHAR",
    "pick_maindeck_rate": "FLOAT",
    "pick_sideboard_in_rate": "FLOAT",
    "user_n_games_bucket": "INTEGER",
    "user_game_win_rate_bucket": "FLOAT",
}

# 2021-era headers use match-based skill buckets (and MID/VOW a `user_rank`
# column); project them onto the modern names so every curated parquet shares
# one canonical schema. In Bo1 Premier match == game, so bucket values carry
# over unchanged; STX TradDraft keeps match semantics (the skill bucket is
# ordinal — no value rewriting, per the corpus plan).
DRAFT_META_ALIASES = {
    "user_n_matches_bucket": "user_n_games_bucket",
    "user_match_win_rate_bucket": "user_game_win_rate_bucket",
    "user_rank": "rank",
}

# Cannot be NULL-filled: a draft file missing any of these is unusable.
REQUIRED_DRAFT_COLUMNS = ("expansion", "draft_id", "pack_number", "pick_number", "pick")

# Canonical output layout mirrors the modern 17Lands files exactly: leading
# meta columns, then the card columns, then the two skill buckets (which
# 17Lands writes after the pool_ block), then pick_index.
_DRAFT_TRAILING_META = ("user_n_games_bucket", "user_game_win_rate_bucket")
_DRAFT_LEADING_META = tuple(
    c for c in DRAFT_META_TYPES if c not in _DRAFT_TRAILING_META
)

GAME_META_TYPES = {
    "expansion": "VARCHAR",
    "event_type": "VARCHAR",
    "draft_id": "VARCHAR",
    "draft_time": "VARCHAR",
    "game_time": "VARCHAR",
    "build_index": "TINYINT",
    "match_number": "TINYINT",
    "game_number": "TINYINT",
    "rank": "VARCHAR",
    "opp_rank": "VARCHAR",
    "main_colors": "VARCHAR",
    "splash_colors": "VARCHAR",
    "on_play": "BOOLEAN",
    "num_mulligans": "TINYINT",
    "opp_num_mulligans": "TINYINT",
    "opp_colors": "VARCHAR",
    "num_turns": "SMALLINT",
    "won": "BOOLEAN",
    "user_n_games_bucket": "INTEGER",
    "user_game_win_rate_bucket": "FLOAT",
}


def read_header(gz_path):
    with gzip.open(gz_path, "rt", newline="") as file:
        return next(csv.reader(file))


def classify_columns(header, card_prefixes, meta_types):
    """Split header into (column->type mapping in file order, card name lists)."""
    columns = {}
    cards_by_prefix = {p: [] for p in card_prefixes}
    for column in header:
        matched = None
        for prefix in card_prefixes:
            if column.startswith(prefix):
                matched = prefix
                break
        if matched:
            cards_by_prefix[matched].append(column[len(matched) :])
            columns[column] = "TINYINT"
        else:
            columns[column] = meta_types.get(column, "VARCHAR")
    return columns, cards_by_prefix


def _quote(identifier):
    return '"' + identifier.replace('"', '""') + '"'


def _columns_struct(columns):
    """read_csv columns= struct literal with identifier-quoted keys.

    json.dumps would backslash-escape embedded double quotes (e.g.
    `pack_card_Henzie "Toolbox" Torre`), which DuckDB identifier syntax
    rejects — identifiers escape quotes by doubling them.
    """
    return "{" + ", ".join(f"{_quote(n)}: '{t}'" for n, t in columns.items()) + "}"


def detect_schema_era(header):
    """ "match_buckets" (STX/AFR) | "match_buckets_rank" (MID/VOW) | "modern"."""
    if "user_n_matches_bucket" in header:
        return "match_buckets_rank" if "user_rank" in header else "match_buckets"
    return "modern"


def _draft_select_exprs(header):
    """SELECT expressions projecting any schema era onto the canonical layout.

    Column order matches the modern files exactly — leading canonical meta,
    unrecognized meta passthrough, card columns in file order, trailing skill
    buckets — so curated parquets are schema-identical across eras (and a
    modern file curates byte-identically to the pre-normalization output).
    DRAFT_META_ALIASES sources are renamed; canonical columns absent from the
    header are emitted as typed NULLs.
    """
    present = set(header)
    alias_source = {
        canon: old
        for old, canon in DRAFT_META_ALIASES.items()
        if old in present and canon not in present
    }

    def canonical(name):
        if name in present:
            return f"d.{_quote(name)}"
        if name in alias_source:
            return f"d.{_quote(alias_source[name])} AS {_quote(name)}"
        return f"CAST(NULL AS {DRAFT_META_TYPES[name]}) AS {_quote(name)}"

    def is_card(column):
        return column.startswith(PACK_PREFIX) or column.startswith(POOL_PREFIX)

    claimed = set(DRAFT_META_TYPES) | set(DRAFT_META_ALIASES)
    passthrough = [c for c in header if not is_card(c) and c not in claimed]
    card_cols = [c for c in header if is_card(c)]
    return (
        [canonical(c) for c in _DRAFT_LEADING_META]
        + [f"d.{_quote(c)}" for c in passthrough]
        + [f"d.{_quote(c)}" for c in card_cols]
        + [canonical(c) for c in _DRAFT_TRAILING_META]
    )


def _source_etag(raw_path):
    meta = paths.meta_path(raw_path)
    if meta.exists():
        with open(meta) as file:
            return json.load(file).get("etag")
    return None


def _is_current(out_path, raw_etag):
    meta = paths.meta_path(out_path)
    if not (out_path.exists() and meta.exists()):
        return False
    with open(meta) as file:
        recorded = json.load(file).get("source_etag")
    return raw_etag is not None and recorded == raw_etag


def _write_curated_meta(out_path, raw_etag, rows, **extra):
    with open(paths.meta_path(out_path), "w") as file:
        json.dump({"source_etag": raw_etag, "rows": rows, **extra}, file, indent=2)


def _connect():
    con = duckdb.connect()
    con.execute("SET preserve_insertion_order=false")
    con.execute("SET memory_limit='16GB'")
    return con


def curate_draft(set_code, limited_type, force=False):
    raw = paths.raw_dataset_path("draft", set_code, limited_type)
    out = paths.curated_path("draft", set_code, limited_type)
    if not raw.exists():
        return {"status": "MISSING_RAW", "path": str(raw)}
    raw_etag = _source_etag(raw)
    if not force and _is_current(out, raw_etag):
        return {"status": "SKIPPED", "path": str(out)}
    # 2021-era files are gzipped tarballs; curation reads the decoded twin,
    # but the skip logic above stays keyed on the original S3 file's etag.
    source = decode.ensure_decoded(raw)

    header = read_header(source)
    era = detect_schema_era(header)
    columns, cards = classify_columns(
        header, [PACK_PREFIX, POOL_PREFIX], DRAFT_META_TYPES
    )
    for old, canonical in DRAFT_META_ALIASES.items():
        if old in columns:
            columns[old] = DRAFT_META_TYPES[canonical]
    available = set(header) | {
        DRAFT_META_ALIASES[c] for c in header if c in DRAFT_META_ALIASES
    }
    missing = [c for c in REQUIRED_DRAFT_COLUMNS if c not in available]
    if missing:
        raise ValueError(f"required draft columns missing from {source}: {missing}")
    vocab = cards[PACK_PREFIX]
    # Some dumps (e.g. DMU) order the pool_ block differently from the
    # pack_card_ block. Harmless — every consumer selects these columns by
    # name — so only a genuine card-set difference is an error.
    if set(cards[POOL_PREFIX]) != set(vocab):
        raise ValueError(f"pack/pool card-name mismatch in {source}")

    out.parent.mkdir(parents=True, exist_ok=True)
    con = _connect()
    con.execute("CREATE TEMP TABLE vocab (name VARCHAR, idx INTEGER)")
    con.executemany(
        "INSERT INTO vocab VALUES (?, ?)", list(zip(vocab, range(len(vocab))))
    )

    columns_arg = _columns_struct(columns)
    select_cols = ", ".join(_draft_select_exprs(header))
    tmp = out.parent / f".{out.name}.part"
    con.execute(
        f"""
        COPY (
            SELECT {select_cols}, COALESCE(v.idx, -1) AS pick_index
            FROM read_csv(?, header=true, columns={columns_arg}) d
            LEFT JOIN vocab v ON d.pick = v.name
        ) TO '{tmp}' (FORMAT PARQUET, COMPRESSION ZSTD)
        """,
        [str(source)],
    )
    rows, unmatched, max_pick, p1p1_rows = con.execute(
        f"SELECT count(*), sum(CASE WHEN pick_index = -1 THEN 1 ELSE 0 END), "
        f"max(pick_number), "
        f"sum(CASE WHEN pack_number = 0 AND pick_number = 0 THEN 1 ELSE 0 END) "
        f"FROM read_parquet('{tmp}')"
    ).fetchone()
    con.close()
    tmp.replace(out)

    with open(paths.vocab_path(set_code, limited_type), "w") as file:
        json.dump(
            {"set": set_code, "format": limited_type, "names": vocab}, file, indent=2
        )
    _write_curated_meta(
        out,
        raw_etag,
        rows,
        schema_era=era,
        p1p1_missing=not p1p1_rows,
        picks_per_pack=None if max_pick is None else int(max_pick) + 1,
    )
    if unmatched:
        print(f"WARNING: {unmatched}/{rows} picks did not match the vocabulary")
    return {
        "status": "CURATED",
        "path": str(out),
        "rows": rows,
        "vocab": len(vocab),
        "schema_era": era,
    }


def curate_game(set_code, limited_type, force=False):
    raw = paths.raw_dataset_path("game", set_code, limited_type)
    out = paths.curated_path("game", set_code, limited_type)
    if not raw.exists():
        return {"status": "MISSING_RAW", "path": str(raw)}
    raw_etag = _source_etag(raw)
    if not force and _is_current(out, raw_etag):
        return {"status": "SKIPPED", "path": str(out)}

    header = read_header(raw)
    columns, cards = classify_columns(header, GAME_CARD_PREFIXES, GAME_META_TYPES)
    names = cards[GAME_CARD_PREFIXES[0]]
    for prefix in GAME_CARD_PREFIXES[1:]:
        if sorted(cards[prefix]) != sorted(names):
            raise ValueError(f"card column mismatch across prefixes in {raw}")

    out.parent.mkdir(parents=True, exist_ok=True)
    columns_arg = _columns_struct(columns)
    tmp = out.parent / f".{out.name}.part"
    con = _connect()
    con.execute(
        f"""
        COPY (SELECT * FROM read_csv(?, header=true, columns={columns_arg}))
        TO '{tmp}' (FORMAT PARQUET, COMPRESSION ZSTD)
        """,
        [str(raw)],
    )
    rows = con.execute(f"SELECT count(*) FROM read_parquet('{tmp}')").fetchone()[0]
    con.close()
    tmp.replace(out)
    _write_curated_meta(out, raw_etag, rows)
    return {"status": "CURATED", "path": str(out), "rows": rows, "cards": len(names)}

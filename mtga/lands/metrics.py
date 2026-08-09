"""Card and color-pair metrics computed from raw 17Lands data — never scraped.

Win rates follow the community definitions (GIH = opening hand or drawn,
GNS = in deck but never seen, IWD = GIH WR - GNS WR, ALSA/ATA from draft
data) but every rate ships with an empirical-Bayes shrunk sibling: rates are
pulled toward the format mean with a method-of-moments prior strength, so a
20-game card can't outrank a 2,000-game card on noise. Raw values and sample
sizes are always kept alongside.

Known biases (documented, not corrected in v1): GIH/IWD inflate cards drawn
in long games; the 17Lands population is above-average skill. The overlay
mitigates by showing OH WR next to GIH WR.
"""

import datetime
import json

import duckdb
import numpy as np
import pandas as pd

from mtga.lands import cardstore, paths
from mtga.lands.etl import GAME_CARD_PREFIXES, PACK_PREFIX

ALSA_BATCH = 40
SHRINK_MIN_N = 200
SHRINK_CLAMP = (100.0, 1000.0)


def _quote(identifier):
    return '"' + identifier.replace('"', '""') + '"'


def shrink(wins, games, prior_strength=None):
    """Empirical-Bayes shrinkage of per-card win rates toward the format mean.

    Returns (shrunk_rates, p0, m). With prior_strength=None, m is estimated by
    method of moments over cards with >= SHRINK_MIN_N games and clamped.
    """
    wins = np.asarray(wins, dtype=np.float64)
    games = np.asarray(games, dtype=np.float64)
    total_games = games.sum()
    p0 = wins.sum() / total_games if total_games else 0.5

    if prior_strength is None:
        mask = games >= SHRINK_MIN_N
        if mask.sum() >= 10:
            rates = wins[mask] / games[mask]
            var_obs = rates.var()
            var_samp = np.mean(p0 * (1 - p0) / games[mask])
            tau2 = max(var_obs - var_samp, 1e-6)
            m = p0 * (1 - p0) / tau2
        else:
            m = SHRINK_CLAMP[1]
        m = float(np.clip(m, *SHRINK_CLAMP))
    else:
        m = float(prior_strength)

    shrunk = (wins + m * p0) / (games + m)
    return shrunk, p0, m


def _vocab_names(set_code, limited_type):
    with open(paths.vocab_path(set_code, limited_type)) as file:
        return json.load(file)["names"]


def _card_matrix(con, parquet, prefix, names):
    """Card-count columns for one prefix as an int8 matrix (rows x cards)."""
    cols = ", ".join(_quote(f"{prefix}{n}") for n in names)
    table = con.execute(f"SELECT {cols} FROM '{parquet}'").fetch_arrow_table()
    return np.column_stack(
        [table.column(i).to_numpy() for i in range(table.num_columns)]
    )


def game_card_metrics(set_code, limited_type, prior_strength=None):
    """Per-card win-rate family from the curated game parquet."""
    parquet = paths.curated_path("game", set_code, limited_type)
    con = duckdb.connect()
    names = None
    # Column order is identical across prefixes (asserted at curation time);
    # recover it from the parquet schema for the first prefix.
    schema = (
        con.execute(f"SELECT * FROM '{parquet}' LIMIT 0").fetch_arrow_table().schema
    )
    prefix = GAME_CARD_PREFIXES[0]
    names = [f.name[len(prefix) :] for f in schema if f.name.startswith(prefix)]

    won = (
        con.execute(f"SELECT won FROM '{parquet}'")
        .fetch_arrow_table()["won"]
        .to_numpy()
        .astype(bool)
    )

    oh = _card_matrix(con, parquet, "opening_hand_", names) > 0
    drawn = _card_matrix(con, parquet, "drawn_", names) > 0
    deck = _card_matrix(con, parquet, "deck_", names) > 0
    con.close()

    gih = oh | drawn
    gns = deck & ~gih

    result = pd.DataFrame({"name": names})
    for label, cond in [
        ("gp", deck),
        ("oh", oh),
        ("gd", drawn),
        ("gih", gih),
        ("gns", gns),
    ]:
        games = cond.sum(axis=0)
        wins = (cond & won[:, None]).sum(axis=0)
        with np.errstate(invalid="ignore"):
            rate = np.where(games > 0, wins / np.maximum(games, 1), np.nan)
        shrunk, p0, m = shrink(wins, games, prior_strength)
        result[f"{label}_games"] = games
        result[f"{label}_wr"] = rate
        result[f"{label}_wr_shrunk"] = shrunk
        result.attrs[f"{label}_prior"] = {"p0": p0, "m": m}

    result["iwd"] = result["gih_wr"] - result["gns_wr"]
    result["iwd_shrunk"] = result["gih_wr_shrunk"] - result["gns_wr_shrunk"]
    return result


def draft_card_metrics(set_code, limited_type):
    """ATA / ALSA / seen / pick counts from the curated draft parquet."""
    parquet = paths.curated_path("draft", set_code, limited_type)
    names = _vocab_names(set_code, limited_type)
    con = duckdb.connect()
    con.execute("SET memory_limit='16GB'")

    # 17Lands pick_number indexing has varied; normalize to 1-indexed.
    min_pick = con.execute(f"SELECT MIN(pick_number) FROM '{parquet}'").fetchone()[0]
    offset = 1 if min_pick == 0 else 0

    ata = con.execute(f"""
        SELECT pick_index, AVG(pick_number) + {offset} AS ata, COUNT(*) AS pick_count
        FROM '{parquet}' WHERE pick_index >= 0 GROUP BY pick_index
        """).df().set_index("pick_index")

    alsa = np.full(len(names), np.nan)
    seen = np.zeros(len(names), dtype=np.int64)
    for start in range(0, len(names), ALSA_BATCH):
        batch = names[start : start + ALSA_BATCH]
        last_seen = ", ".join(
            f"MAX(CASE WHEN {_quote(PACK_PREFIX + n)} > 0 THEN pick_number END) AS m{i}"
            for i, n in enumerate(batch)
        )
        outer = ", ".join(
            f"AVG(m{i} + {offset}.0), COUNT(m{i})" for i in range(len(batch))
        )
        row = con.execute(f"""
            SELECT {outer} FROM (
                SELECT {last_seen} FROM '{parquet}' GROUP BY draft_id, pack_number
            )
            """).fetchone()
        for i in range(len(batch)):
            alsa[start + i] = row[2 * i] if row[2 * i] is not None else np.nan
            seen[start + i] = row[2 * i + 1]
    con.close()

    result = pd.DataFrame({"name": names})
    result["ata"] = [ata["ata"].get(i, np.nan) for i in range(len(names))]
    result["pick_count"] = [int(ata["pick_count"].get(i, 0)) for i in range(len(names))]
    result["alsa"] = alsa
    result["seen_count"] = seen
    return result


def color_metrics(set_code, limited_type, prior_strength=None):
    parquet = paths.curated_path("game", set_code, limited_type)
    con = duckdb.connect()
    frame = con.execute(f"""
        SELECT main_colors, COUNT(*) AS games,
               SUM(CASE WHEN won THEN 1 ELSE 0 END) AS wins
        FROM '{parquet}' GROUP BY main_colors ORDER BY games DESC
        """).df()
    con.close()
    frame["wr"] = frame["wins"] / frame["games"]
    frame["wr_shrunk"], _, _ = shrink(frame["wins"], frame["games"], prior_strength)
    return frame


def build_metrics(set_code, limited_type, prior_strength=None, as_of=None):
    """Compute and persist the full metrics table for one (set, format)."""
    date_str = as_of or datetime.date.today().isoformat()

    game = game_card_metrics(set_code, limited_type, prior_strength)
    draft = draft_card_metrics(set_code, limited_type)
    cards = game.merge(draft, on="name", how="outer")

    canonical, _, attrs = cardstore.name_resolution(set_code)
    cards["grp_id"] = cards["name"].map(canonical)
    for field in ["rarity", "color_identity", "mana_value"]:
        cards[field] = cards["name"].map(lambda n, f=field: attrs.get(n, {}).get(f))

    out = paths.metrics_cards_path(set_code, limited_type, date_str)
    out.parent.mkdir(parents=True, exist_ok=True)
    cards.to_parquet(out, index=False)
    paths.repoint_latest(out, prefix="cards_")

    colors = color_metrics(set_code, limited_type, prior_strength)
    colors_out = paths.metrics_colors_path(set_code, limited_type, date_str)
    colors.to_parquet(colors_out, index=False)
    paths.repoint_latest(colors_out, prefix="colors_")

    print(f"metrics: {len(cards)} cards, {len(colors)} color rows -> {out.parent}")
    return cards, colors


def load_latest_metrics(set_code, limited_type):
    dated = paths.metrics_cards_path(set_code, limited_type, "x")
    return pd.read_parquet(paths.latest_symlink(dated, prefix="cards_"))


def report(set_code, limited_type, top=20):
    """Terminal demo: the top cards by shrunk GIH WR with context columns."""
    frame = load_latest_metrics(set_code, limited_type)
    cols = [
        "name",
        "rarity",
        "color_identity",
        "gih_wr_shrunk",
        "gih_wr",
        "gih_games",
        "oh_wr",
        "iwd",
        "alsa",
        "ata",
    ]
    frame = frame.sort_values("gih_wr_shrunk", ascending=False).head(top)
    with pd.option_context("display.width", 200, "display.max_columns", 30):
        print(frame[cols].round(4).to_string(index=False))

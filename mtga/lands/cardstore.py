"""Canonical card table: one row per Arena grpId.

Joins 17Lands cards.csv (whose `id` IS the Arena grpId — the primary
grpId->name source for draftable sets) with the nightly Scryfall parquet for
images, mana costs, and collector numbers. Both sources use full "A // B"
names for multiface cards; the join falls back to front-face and name-only
matches for stragglers.
"""

import pandas as pd

from mtga.lands import paths


def _norm(name):
    return name.casefold().strip()


def _front_face(name):
    return name.split(" // ")[0]


def build_card_store(verbose=True):
    lands = pd.read_csv(paths.CARDS_CSV)
    lands = lands.rename(columns={"id": "grp_id"})
    lands["base_name"] = lands["name"].str.replace(r"^A-", "", regex=True)
    lands["name_norm"] = lands["base_name"].map(_norm)
    lands["set_norm"] = lands["expansion"].str.lower()

    scry_cols = [
        "id",
        "name",
        "set",
        "collector_number",
        "colors",
        "mana_cost",
        "type_line",
        "image_small_url",
        "image_normal_url",
    ]
    try:
        scry = pd.read_parquet(
            paths.SCRYFALL_CARDS_PARQUET, columns=scry_cols + ["digital"]
        )
    except Exception:  # pre-digital-column parquet
        scry = pd.read_parquet(paths.SCRYFALL_CARDS_PARQUET, columns=scry_cols)
    scry = scry.rename(columns={"id": "scryfall_id"})
    sets = pd.read_parquet(paths.SCRYFALL_SETS_PARQUET)
    scry = scry.merge(sets[["set", "released_at"]], on="set", how="left")
    scry["name_norm"] = scry["name"].map(_norm)
    scry["front_norm"] = scry["name"].map(_front_face).map(_norm)
    scry["set_norm"] = scry["set"].str.lower()
    scry = scry.drop(columns=["name"])

    join_cols = [
        "scryfall_id",
        "collector_number",
        "colors",
        "mana_cost",
        "type_line",
        "image_small_url",
        "image_normal_url",
    ]

    def take(frame, on_left, on_right, label):
        candidates = scry.rename(columns={on_right: "_key"})
        # Within a key, prefer paper printings (better images/collector
        # numbers), then the newest.
        if "digital" in candidates.columns:
            candidates = candidates.sort_values(
                ["digital", "released_at"], ascending=[True, False]
            )
        else:
            candidates = candidates.sort_values("released_at", ascending=False)
        merged = frame.merge(
            candidates.drop_duplicates(subset=["_key", "set_norm"])[
                ["_key", "set_norm"] + join_cols
            ],
            left_on=[on_left, "set_norm"],
            right_on=["_key", "set_norm"],
            how="left",
        )
        merged["match"] = merged["scryfall_id"].notna().map({True: label, False: None})
        return merged

    # Pass 1: (name, set) exact.
    result = take(lands, "name_norm", "name_norm", "exact")

    # Pass 2: (front-face name, set).
    missing = result["scryfall_id"].isna()
    if missing.any():
        retry = take(
            lands[missing.values].drop(columns=[], errors="ignore"),
            "name_norm",
            "front_norm",
            "front",
        )
        result.loc[missing, join_cols + ["match"]] = retry[join_cols + ["match"]].values

    # Pass 3: name only, newest printing anywhere.
    missing = result["scryfall_id"].isna()
    if missing.any():
        if "digital" in scry.columns:
            ranked_by_name = scry.sort_values(
                ["digital", "released_at"], ascending=[True, False]
            )
        else:
            ranked_by_name = scry.sort_values("released_at", ascending=False)
        by_name = ranked_by_name.drop_duplicates(subset=["name_norm"]).set_index(
            "name_norm"
        )[join_cols]
        fallback = lands.loc[missing.values, "name_norm"].map(by_name.to_dict("index"))
        rows = fallback.dropna()
        for col in join_cols:
            result.loc[rows.index, col] = rows.map(lambda d, c=col: d[c])
        result.loc[rows.index, "match"] = "name"

    result["match"] = result["match"].fillna("none")
    out_cols = (
        [
            "grp_id",
            "expansion",
            "name",
            "base_name",
            "rarity",
            "color_identity",
            "mana_value",
            "types",
            "is_booster",
        ]
        + join_cols
        + ["match"]
    )
    store = result[out_cols]

    paths.CARD_STORE_PARQUET.parent.mkdir(parents=True, exist_ok=True)
    store.to_parquet(paths.CARD_STORE_PARQUET, index=False)

    if verbose:
        coverage = (
            store.assign(matched=store["match"] != "none")
            .groupby("expansion")["matched"]
            .agg(["mean", "count"])
        )
        recent = coverage.tail(12)
        print(f"card_store: {len(store)} grpIds -> {paths.CARD_STORE_PARQUET}")
        print("match coverage (last 12 expansions):")
        print(
            (recent["mean"] * 100).round(1).astype(str)
            + f"% of "
            + recent["count"].astype(str)
        )
    return store


def load_card_store():
    return pd.read_parquet(paths.CARD_STORE_PARQUET)


def name_resolution(set_code):
    """Name-keyed grpId resolution for one set's card universe.

    Returns (canonical, aliases, attrs):
      canonical: name -> the one grpId to display (prefer in-set + booster)
      aliases:   name -> every grpId sharing that name anywhere (alt arts,
                 bonus-sheet printings under other expansion codes)
      attrs:     name -> {rarity, color_identity, mana_value} from the
                 canonical row
    Names not printed in `set_code` (bonus sheets) still resolve via the
    global fallback, which is exactly the case cards.csv splits across codes.
    """
    store = load_card_store()
    in_set = store["expansion"] == set_code
    ranked = store.assign(
        _pref=(~in_set).astype(int) * 2
        + (~store["is_booster"].astype(bool)).astype(int)
    ).sort_values(["_pref", "grp_id"])

    canonical, aliases, attrs = {}, {}, {}
    for row in ranked.itertuples():
        aliases.setdefault(row.name, []).append(int(row.grp_id))
        if row.name not in canonical:
            canonical[row.name] = int(row.grp_id)
            attrs[row.name] = {
                "rarity": row.rarity,
                "color_identity": row.color_identity,
                "mana_value": row.mana_value,
            }
    return canonical, aliases, attrs

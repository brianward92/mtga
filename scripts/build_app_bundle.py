#!/usr/bin/env python
"""Build the offline per-set bundle the Electron app ships.

For each requested set the bundle directory (default
electron/resources/draftfm/sets/) gets:

  <SET>/assets.npz    exact scripts/build_set_assets.py output (copied from
                      <data root>/foundation/set_assets/<SET>.npz when it
                      exists and matches the frozen manifest, else built
                      through build_set_assets.build). Text embeddings come
                      only from the data root's cache — sentence-transformers
                      is never imported; cache misses are zero-filled and
                      recorded in the npz's text_missing (as production
                      already accepts).
  <SET>/cards.json    one identity row per grpId in the set universe (alt
                      arts, bonus-sheet printings, day-1 ratings-cache
                      grpIds included), Scryfall images/costs when known:
                      {grpId, name, rarity, colors, manaCost, manaValue,
                       type, setCode, imageSmall, imageNormal}
  <SET>/ratings.json  {"attribution", "keyed_by": "name",
                       "formats": {fmt: {name: {gih_wr, oh_wr, gd_wr,
                       gp_wr, iwd, alsa, ata, games, ...}}}}
                      from own metrics parquets when present, else the cached
                      17Lands card_ratings JSON, for every format cached.
                      Skipped (no file) when the set has no ratings at all.
  index.json          {"sets": {SET: {picks_per_pack, manifest_hash, cards,
                       grp_ids, built_at, formats_with_ratings}},
                       "model_manifest_hash", "model_id", "built_at"}
                      merged over any existing index, so sets can be built
                      one at a time.

Identity joins mirror mtga.draft_api.DataHub.cards: card_store.parquet rows
(any expansion, joined by name to the set universe) plus the cached 17Lands
card_ratings rows for grpIds the store doesn't know yet, with a Scryfall
name lookup filling costs/types/images for those.

  build_app_bundle.py --set DSK
  build_app_bundle.py --set MSH --set ECL --out /tmp/sets
  build_app_bundle.py --all-curated
"""

import argparse
import datetime
import importlib.util
import json
import os
import shutil
import sys
from pathlib import Path

import numpy as np

from mtga.foundation import featurize, textemb
from mtga.lands import config, paths

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT = REPO_ROOT / "electron" / "resources" / "draftfm" / "sets"

RARITY_MAP = {"basic": "land"}  # store/17Lands -> app vocabulary
COLOR_ORDER = "WUBRG"


def _load_build_set_assets():
    spec = importlib.util.spec_from_file_location(
        "build_set_assets", Path(__file__).resolve().parent / "build_set_assets.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def create_parser():
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--set", action="append", dest="sets", default=[],
                        metavar="SET", help="set code (repeatable)")
    parser.add_argument("--all-curated", action="store_true",
                        help="every set with a curated draft vocab sidecar")
    parser.add_argument("--out", default=str(DEFAULT_OUT),
                        help=f"bundle root (default: {DEFAULT_OUT})")
    parser.add_argument("--data-root", default=None,
                        help="override MTGA_DATA_ROOT (must be set before "
                             "mtga imports; the script re-execs itself)")
    parser.add_argument("--rebuild-assets", action="store_true",
                        help="rebuild assets.npz even when the data root has "
                             "a matching one")
    return parser


# ---------------------------------------------------------------------------
# assets.npz

def _no_encoder():
    raise ImportError("build_app_bundle never loads sentence-transformers; "
                      "text embeddings come from the data-root cache only")


def _assets_are_current(npz_path, manifest_hash):
    if not npz_path.exists():
        return False
    try:
        with np.load(npz_path) as z:
            return str(z["manifest_hash"]) == manifest_hash
    except Exception:  # unreadable/partial file -> rebuild
        return False


def build_assets(set_code, dest, rebuild=False):
    """Place assets.npz at dest; returns the loaded npz summary dict."""
    bsa = _load_build_set_assets()
    manifest_hash = featurize.load_manifest()["content_hash"]
    source = paths.set_assets_path(set_code)
    if rebuild or not _assets_are_current(source, manifest_hash):
        original = textemb._load_encoder
        textemb._load_encoder = _no_encoder
        try:
            bsa.build(set_code, source, allow_missing_text=True)
        finally:
            textemb._load_encoder = original
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(".npz.tmp")
    shutil.copyfile(source, tmp)
    os.replace(tmp, dest)
    with np.load(dest) as z:
        return {
            "names": [str(n) for n in z["names"]],
            "grp_ids": json.loads(str(z["grp_ids"])),
            "manifest_hash": str(z["manifest_hash"]),
            "picks_per_pack": int(z["picks_per_pack"]),
            "text_missing": json.loads(str(z["text_missing"])),
            "built_at": str(z["built_at"]),
        }


# ---------------------------------------------------------------------------
# cards.json

def _rarity(value):
    value = (value or "").strip().lower()
    return RARITY_MAP.get(value, value)


def _colors(value):
    """Any 'B,U' / 'BU' / 'ub' color string -> WUBRG-ordered letters."""
    letters = {c for c in _str(value).upper() if c in COLOR_ORDER}
    return "".join(c for c in COLOR_ORDER if c in letters)


def _clean(value):
    """NaN/None -> None; numpy scalars -> python."""
    if value is None:
        return None
    try:
        if value != value:
            return None
    except Exception:
        pass
    if isinstance(value, np.generic):
        return value.item()
    return value


def _str(value):
    value = _clean(value)
    return "" if value is None else str(value)


def _mana_value(value):
    value = _clean(value)
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return int(number) if number == int(number) else number


def _ratings_formats(set_code):
    """Every format with a cached card_ratings latest.json, config order first."""
    root = paths.CARD_RATINGS_DIR / set_code
    formats = list(config.FORMATS)
    if root.is_dir():
        for child in sorted(root.iterdir()):
            if child.is_dir() and child.name not in formats:
                formats.append(child.name)
    present = []
    for fmt in formats:
        link = paths.latest_symlink(paths.card_ratings_path(set_code, fmt, "x"))
        if link.exists():
            present.append(fmt)
    return present


def _ratings_rows(set_code, fmt):
    link = paths.latest_symlink(paths.card_ratings_path(set_code, fmt, "x"))
    with open(link) as fh:
        return json.load(fh)


def _scryfall_by_name(names, set_code):
    """name -> Scryfall identity dict for day-1 grpIds the store lacks."""
    if not names or not paths.SCRYFALL_CARDS_PARQUET.exists():
        return {}
    import pandas as pd

    cols = ["name", "set", "rarity", "type_line", "mana_cost", "cmc",
            "color_identity", "image_small_url", "image_normal_url"]
    try:
        scry = pd.read_parquet(paths.SCRYFALL_CARDS_PARQUET,
                               columns=cols + ["digital"])
    except Exception:
        scry = pd.read_parquet(paths.SCRYFALL_CARDS_PARQUET, columns=cols)
        scry["digital"] = False
    from mtga.lands import names as names_mod

    wanted = {names_mod.norm(n): n for n in names}
    scry = scry.assign(_norm=scry["name"].map(names_mod.norm))
    scry = scry[scry["_norm"].isin(wanted)]
    if scry.empty:
        return {}
    scry = scry.assign(
        _in_set=(scry["set"].str.upper() != set_code.upper()).astype(int),
        _digital=scry["digital"].fillna(False).astype(bool).astype(int),
    ).sort_values(["_norm", "_in_set", "_digital"])
    result = {}
    # itertuples() renames underscore-prefixed columns; iterate dicts instead.
    for row in scry.drop_duplicates("_norm").to_dict("records"):
        result[wanted[row["_norm"]]] = {
            "rarity": _str(row["rarity"]),
            "colors": _colors(row["color_identity"]),
            "manaCost": _str(row["mana_cost"]),
            "manaValue": _mana_value(row["cmc"]),
            "type": _str(row["type_line"]),
            "setCode": _str(row["set"]).upper(),
            "imageSmall": _str(row["image_small_url"]) or None,
            "imageNormal": _str(row["image_normal_url"]) or None,
        }
    return result


def build_cards(set_code, grp_lists):
    """[{grpId, name, rarity, colors, manaCost, manaValue, type, setCode,
    imageSmall, imageNormal}] — one row per grpId in the set universe."""
    wanted = {}
    for name, grps in grp_lists.items():
        for grp_id in grps:
            wanted[int(grp_id)] = name

    rows = {}
    if paths.CARD_STORE_PARQUET.exists():
        from mtga.lands import cardstore

        store = cardstore.load_card_store()
        store = store[store["grp_id"].isin(list(wanted))]
        for row in store.itertuples():
            grp_id = int(row.grp_id)
            mana_cost = _str(row.mana_cost)
            mana_value = _mana_value(row.mana_value)
            if not mana_cost and mana_value:
                mana_cost = f"{{{mana_value}}}"
            rows[grp_id] = {
                "grpId": grp_id,
                "name": wanted[grp_id],
                "rarity": _rarity(row.rarity),
                # Printed colours (frame) — what Arena sorts by. Hybrid-cost
                # artifacts like Baseball Bat are colourless here but have a
                # colour identity; keep both.
                "colors": _colors(getattr(row, "colors", None) or ""),
                "colorIdentity": _colors(row.color_identity),
                "manaCost": mana_cost,
                "manaValue": mana_value,
                "type": _str(row.type_line) or _str(row.types),
                "setCode": _str(row.expansion).upper(),
                "imageSmall": _str(row.image_small_url) or None,
                "imageNormal": _str(row.image_normal_url) or None,
            }

    # Day-1 grpIds known only to the ratings cache: identity from the cache
    # row, Scryfall by name for costs/types/images.
    missing = {g: n for g, n in wanted.items() if g not in rows}
    if missing:
        cache_rows = {}
        for fmt in _ratings_formats(set_code):
            for row in _ratings_rows(set_code, fmt):
                grp_id = row.get("mtga_id")
                if grp_id and int(grp_id) in missing:
                    cache_rows.setdefault(int(grp_id), row)
        scry = _scryfall_by_name(sorted(set(missing.values())), set_code)
        for grp_id, name in missing.items():
            cached = cache_rows.get(grp_id, {})
            scry_row = scry.get(name, {})
            types = cached.get("types") or []
            rows[grp_id] = {
                "grpId": grp_id,
                "name": name,
                "rarity": _rarity(cached.get("rarity") or scry_row.get("rarity")),
                "colors": _colors(cached.get("color") or scry_row.get("colors")),
                "manaCost": scry_row.get("manaCost", ""),
                "manaValue": scry_row.get("manaValue"),
                "type": scry_row.get("type") or (types[0] if types else ""),
                "setCode": scry_row.get("setCode") or set_code,
                "imageSmall": scry_row.get("imageSmall") or cached.get("url") or None,
                "imageNormal": scry_row.get("imageNormal") or cached.get("url") or None,
            }
    return [rows[g] for g in sorted(rows)]


# ---------------------------------------------------------------------------
# ratings.json

def _round(value, digits=4):
    value = _clean(value)
    if value is None:
        return None
    try:
        return round(float(value), digits)
    except (TypeError, ValueError):
        return None


def _int(value):
    value = _clean(value)
    if value is None:
        return 0
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def _stats_from_metrics(frame):
    stats = {}
    for row in frame.itertuples():
        stats[row.name] = {
            "gih_wr": _round(row.gih_wr),
            "gih_wr_shrunk": _round(getattr(row, "gih_wr_shrunk", None)),
            "oh_wr": _round(row.oh_wr),
            "gd_wr": _round(row.gd_wr),
            "iwd": _round(row.iwd),
            "alsa": _round(row.alsa),
            "ata": _round(row.ata),
            "games": _int(row.gih_games),
        }
    return stats


def _stats_from_cache(rows):
    stats = {}
    for row in rows:
        name = row.get("name")
        if not name:
            continue
        stats[name] = {
            "gih_wr": _round(row.get("ever_drawn_win_rate")),
            "oh_wr": _round(row.get("opening_hand_win_rate")),
            "gd_wr": _round(row.get("drawn_win_rate")),
            "gp_wr": _round(row.get("win_rate")),
            "iwd": _round(row.get("drawn_improvement_win_rate")),
            "alsa": _round(row.get("avg_seen")),
            "ata": _round(row.get("avg_pick")),
            "games": _int(row.get("ever_drawn_game_count")),
            "gp_games": _int(row.get("game_count")),
            "seen": _int(row.get("seen_count")),
            "picks": _int(row.get("pick_count")),
        }
    return stats


def build_ratings(set_code):
    """{"attribution", "keyed_by", "formats": {fmt: {name: stats}}} or None
    when the set has neither own metrics nor a cached ratings JSON."""
    formats = {}
    sources = {}
    candidates = list(config.FORMATS) + [
        f for f in _ratings_formats(set_code) if f not in config.FORMATS]
    for fmt in candidates:
        metrics_link = paths.latest_symlink(
            paths.metrics_cards_path(set_code, fmt, "x"), prefix="cards_")
        ratings_link = paths.latest_symlink(
            paths.card_ratings_path(set_code, fmt, "x"))
        if metrics_link.exists():
            import pandas as pd

            formats[fmt] = _stats_from_metrics(pd.read_parquet(metrics_link))
            sources[fmt] = "own-metrics"
        elif ratings_link.exists():
            formats[fmt] = _stats_from_cache(_ratings_rows(set_code, fmt))
            sources[fmt] = "17lands-site-cache"
    if not formats:
        return None
    return {
        "set": set_code,
        "attribution": config.ATTRIBUTION,
        "keyed_by": "name",
        "sources": sources,
        "formats": formats,
    }


# ---------------------------------------------------------------------------
# index.json + orchestration

def _write_json(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, separators=(",", ":"),
                  sort_keys=False)
    os.replace(tmp, path)


def model_meta():
    """(manifest_hash, model_id) of the promoted foundation model, else the
    frozen featurizer manifest hash with no model_id."""
    meta_file = paths.MODELS_DIR / "_foundation" / "latest" / "meta.json"
    if meta_file.exists():
        meta = json.loads(meta_file.read_text())
        return meta.get("manifest_hash"), meta.get("model_id")
    return featurize.load_manifest()["content_hash"], None


def curated_sets():
    codes = set()
    for vocab_file in (paths.CURATED_DIR / "draft").glob("*.vocab.json"):
        codes.add(vocab_file.name.split(".")[0])
    return sorted(codes)


def build_set(set_code, out_dir, rebuild_assets=False):
    set_dir = out_dir / set_code
    assets = build_assets(set_code, set_dir / "assets.npz", rebuild=rebuild_assets)
    cards = build_cards(set_code, assets["grp_ids"])
    _write_json(set_dir / "cards.json", cards)

    ratings = build_ratings(set_code)
    ratings_path = set_dir / "ratings.json"
    if ratings is None:
        if ratings_path.exists():
            ratings_path.unlink()
        formats_with_ratings = []
    else:
        _write_json(ratings_path, ratings)
        formats_with_ratings = list(ratings["formats"])

    return {
        "picks_per_pack": assets["picks_per_pack"],
        "manifest_hash": assets["manifest_hash"],
        "cards": len(assets["names"]),
        "grp_ids": len(cards),
        "text_missing": len(assets["text_missing"]),
        "built_at": assets["built_at"],
        "formats_with_ratings": formats_with_ratings,
    }


def update_index(out_dir, entries):
    index_path = out_dir / "index.json"
    existing = {}
    if index_path.exists():
        try:
            existing = json.loads(index_path.read_text()).get("sets", {})
        except (json.JSONDecodeError, AttributeError):
            existing = {}
    manifest_hash, model_id = model_meta()
    stale = sorted(code for code, entry in existing.items()
                   if entry.get("manifest_hash") != manifest_hash
                   and code not in entries)
    existing.update(entries)
    index = {
        "sets": {code: existing[code] for code in sorted(existing)},
        "model_manifest_hash": manifest_hash,
        "model_id": model_id,
        "attribution": config.ATTRIBUTION,
        "built_at": datetime.datetime.now().isoformat(timespec="seconds"),
    }
    _write_json(index_path, index)
    return index, stale


def build(set_codes, out_dir, rebuild_assets=False):
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    entries = {}
    for set_code in set_codes:
        entries[set_code] = build_set(set_code, out_dir, rebuild_assets)
    index, stale = update_index(out_dir, entries)
    return entries, index, stale


def main(argv=None):
    args = create_parser().parse_args(argv)
    if args.data_root and Path(args.data_root).resolve() != paths.DATA_ROOT.resolve():
        # paths freezes DATA_ROOT at import; re-exec with the env var set.
        env = dict(os.environ, MTGA_DATA_ROOT=args.data_root)
        cmd = [sys.executable, str(Path(__file__).resolve())] + [
            a for a in (sys.argv[1:] if argv is None else argv)]
        os.execve(sys.executable, cmd, env)

    set_codes = [s.strip().upper() for s in args.sets if s.strip()]
    if args.all_curated:
        set_codes += [s for s in curated_sets() if s not in set_codes]
    if not set_codes:
        print("nothing to do: pass --set SET (repeatable) or --all-curated",
              file=sys.stderr)
        sys.exit(2)

    try:
        entries, index, stale = build(set_codes, args.out, args.rebuild_assets)
    except (FileNotFoundError, featurize.UnmatchedNamesError,
            RuntimeError) as err:
        print(f"FAILED: {err}", file=sys.stderr)
        sys.exit(2)

    out_dir = Path(args.out)
    print(f"bundle root: {out_dir}")
    print(f"model manifest {str(index['model_manifest_hash'])[:12]} "
          f"({index.get('model_id') or 'featurizer manifest only'})")
    for set_code, entry in entries.items():
        size = sum(f.stat().st_size for f in (out_dir / set_code).iterdir())
        print(f"  {set_code}: {entry['cards']} cards / {entry['grp_ids']} grpIds, "
              f"ppp {entry['picks_per_pack']}, ratings "
              f"{','.join(entry['formats_with_ratings']) or 'none'}, "
              f"text_missing {entry['text_missing']}, "
              f"{size / 1024:.0f} KB")
    if stale:
        print(f"WARNING: index has sets built against another manifest: "
              f"{stale} (rebuild them)", file=sys.stderr)


if __name__ == "__main__":
    main()

"""The draft assistant HTTP API — stdlib only, modeled on scripts/serve_app.py.

Endpoints (all JSON, all carrying 17Lands attribution):
  GET  /api/v1/health
  GET  /api/v1/sets
  GET  /api/v1/cards?set=MSH
  GET  /api/v1/ratings?set=MSH&format=PremierDraft
  GET  /api/v1/models
  POST /api/v1/score   {"set"?, "format", "pack": [grpId], "pool": [grpId],
                        "pack_number"?, "pick_number"?}
  POST /api/v1/deck    {"set"?, "format"?, "deck": [grpId], "deck_size"?,
                        "land_slots"?}  -> land split, curve, cuts, synergies

Card identity merges the card store (Scryfall-joined) with the cached
card_ratings JSON — the latter covers brand-new sets (MSH) whose grpIds
haven't reached cards.csv yet. Unknown grpIds degrade to nulls, never 500s.
"""

import json
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from mtga.lands import config, paths
from mtga.models import registry

START_TIME = time.time()


class DataHub:
    """Lazy, mtime-keyed caches for card info, ratings tables, and P1P1 EVs."""

    def __init__(self):
        self._cards = {}
        self._ratings = {}
        self._p1p1 = {}
        self._text = {}
        self._global = None

    # -- card identity ----------------------------------------------------

    def _ratings_link(self, set_code, limited_type):
        return paths.latest_symlink(
            paths.card_ratings_path(set_code, limited_type, "x")
        )

    def cards(self, set_code):
        """grp_id -> card info dict for one set (store + ratings-cache merge)."""
        store_mtime = (
            paths.CARD_STORE_PARQUET.stat().st_mtime
            if paths.CARD_STORE_PARQUET.exists()
            else 0
        )
        ratings_mtimes = tuple(
            (
                link.stat().st_mtime
                if (link := self._ratings_link(set_code, fmt)).exists()
                else 0
            )
            for fmt in config.FORMATS
        )
        key = (set_code, store_mtime, ratings_mtimes)
        cached = self._cards.get(key)
        if cached is not None:
            return cached

        cards = {}
        if paths.CARD_STORE_PARQUET.exists():
            from mtga.lands import cardstore

            store = cardstore.load_card_store()
            for row in store[store["expansion"] == set_code].itertuples():
                cards[int(row.grp_id)] = {
                    "grp_id": int(row.grp_id),
                    "name": row.name,
                    "colors": row.color_identity or "",
                    "rarity": row.rarity,
                    "mana_value": row.mana_value,
                    "image_small": row.image_small_url,
                    "image_normal": row.image_normal_url,
                }
        for fmt in config.FORMATS:
            link = self._ratings_link(set_code, fmt)
            if not link.exists():
                continue
            with open(link) as file:
                for row in json.load(file):
                    grp_id = row.get("mtga_id")
                    if grp_id and int(grp_id) not in cards:
                        cards[int(grp_id)] = {
                            "grp_id": int(grp_id),
                            "name": row.get("name"),
                            "colors": row.get("color") or "",
                            "rarity": row.get("rarity"),
                            "mana_value": None,
                            "image_small": row.get("url"),
                            "image_normal": row.get("url"),
                        }
            break
        self._cards = {key: cards}
        return cards

    def card_text(self, set_code):
        """grp_id -> {mana_cost, type_line, oracle_text} for one set.

        The card store carries costs but no rules text, so this joins it to the
        nightly Scryfall parquet on scryfall_id. Deck advice needs the text: it
        is what distinguishes a hybrid cost from a gold one and a landcycler
        from a clunky five-drop. Missing parquet degrades to {} rather than
        failing the request — advice without synergy still beats no advice.
        """
        if not (
            paths.CARD_STORE_PARQUET.exists() and paths.SCRYFALL_CARDS_PARQUET.exists()
        ):
            return {}

        store_mtime = paths.CARD_STORE_PARQUET.stat().st_mtime
        scry_mtime = paths.SCRYFALL_CARDS_PARQUET.stat().st_mtime
        key = (set_code, store_mtime, scry_mtime)
        cached = self._text.get(key)
        if cached is not None:
            return cached

        import duckdb

        from mtga.lands import cardstore

        store = cardstore.load_card_store()
        rows = store[store["expansion"] == set_code]
        by_scryfall = {}
        for row in rows.itertuples():
            if row.scryfall_id:
                by_scryfall.setdefault(str(row.scryfall_id), []).append(row)
        if not by_scryfall:
            self._text = {key: {}}
            return {}

        con = duckdb.connect()
        query = (
            "select id, mana_cost, type_line, oracle_text "
            f"from read_parquet('{paths.SCRYFALL_CARDS_PARQUET}') "
            "where id in (select unnest($ids))"
        )
        text = {}
        try:
            fetched = con.execute(query, {"ids": list(by_scryfall)}).fetchall()
        finally:
            con.close()
        for scryfall_id, mana_cost, type_line, oracle_text in fetched:
            for row in by_scryfall.get(str(scryfall_id), []):
                text[int(row.grp_id)] = {
                    "mana_cost": mana_cost or row.mana_cost or "",
                    "type_line": type_line or row.type_line or "",
                    "oracle_text": oracle_text or "",
                }
        self._text = {key: text}
        return text

    def global_cards(self):
        """grp_id -> info across every expansion (bonus sheets, alt arts)."""
        if self._global is None and paths.CARD_STORE_PARQUET.exists():
            from mtga.lands import cardstore

            store = cardstore.load_card_store()
            self._global = {
                int(row.grp_id): {
                    "grp_id": int(row.grp_id),
                    "name": row.name,
                    "colors": row.color_identity or "",
                    "rarity": row.rarity,
                    "mana_value": row.mana_value,
                    "image_small": row.image_small_url,
                    "image_normal": row.image_normal_url,
                }
                for row in store.itertuples()
            }
        return self._global or {}

    # -- stats ------------------------------------------------------------

    def stats(self, set_code, limited_type):
        """name -> stat dict from own metrics, else the ratings cache.

        Formats with no data of their own (QuickDraft — 17Lands has none)
        borrow PremierDraft's stats, mirroring the model fallback.
        """
        metrics_link = paths.latest_symlink(
            paths.metrics_cards_path(set_code, limited_type, "x"), prefix="cards_"
        )
        ratings_link = self._ratings_link(set_code, limited_type)
        if (
            limited_type != "PremierDraft"
            and not metrics_link.exists()
            and not ratings_link.exists()
        ):
            return self.stats(set_code, "PremierDraft")
        mtimes = tuple(
            p.stat().st_mtime if p.exists() else 0 for p in [metrics_link, ratings_link]
        )
        key = (set_code, limited_type, mtimes)
        cached = self._ratings.get(key)
        if cached is not None:
            return cached

        stats, source = {}, None
        if metrics_link.exists():
            import pandas as pd

            frame = pd.read_parquet(metrics_link)
            source = "own-metrics"
            for row in frame.itertuples():
                stats[row.name] = {
                    "gih_wr": _clean(row.gih_wr),
                    "gih_wr_shrunk": _clean(row.gih_wr_shrunk),
                    "gih_n": (
                        int(row.gih_games) if row.gih_games == row.gih_games else 0
                    ),
                    "oh_wr": _clean(row.oh_wr),
                    "gd_wr": _clean(row.gd_wr),
                    "iwd": _clean(row.iwd),
                    "alsa": _clean(row.alsa),
                    "ata": _clean(row.ata),
                }
        elif ratings_link.exists():
            source = "17lands-site-cache"
            with open(ratings_link) as file:
                for row in json.load(file):
                    stats[row["name"]] = {
                        "gih_wr": row.get("ever_drawn_win_rate"),
                        "gih_wr_shrunk": None,
                        "gih_n": row.get("ever_drawn_game_count") or 0,
                        "oh_wr": row.get("opening_hand_win_rate"),
                        "gd_wr": row.get("drawn_win_rate"),
                        "iwd": row.get("drawn_improvement_win_rate"),
                        "alsa": row.get("avg_seen"),
                        "ata": row.get("avg_pick"),
                    }
        result = {"stats": stats, "source": source}
        self._ratings = {key: result}
        return result

    # -- scoring ----------------------------------------------------------

    def p1p1(self, set_code, limited_type, model):
        # cache_token carries the underlying data mtimes (set by the registry)
        # so nightly refreshes invalidate this even for unversioned heuristics.
        key = (set_code, limited_type, getattr(model, "cache_token", model.model_id))
        cached = self._p1p1.get(key)
        if cached is not None:
            return cached
        cards = self.cards(set_code)
        scores = model.score_pack(list(cards), [])
        table = {s.grp_id: s.ev for s in scores}
        self._p1p1 = {key: table}
        return table

    def card_payload(
        self, set_code, limited_type, grp_ids, evs=None, probs=None, ranks=None
    ):
        cards = self.cards(set_code)
        stats = self.stats(set_code, limited_type)["stats"]
        rows = []
        for i, grp_id in enumerate(grp_ids):
            info = (
                cards.get(grp_id)
                or self.global_cards().get(grp_id)
                or {
                    "grp_id": grp_id,
                    "name": None,
                    "colors": None,
                    "rarity": None,
                    "mana_value": None,
                    "image_small": None,
                    "image_normal": None,
                }
            )
            row = dict(info)
            row.update(stats.get(info.get("name"), {}) or {})
            if evs is not None:
                row["ev"] = evs[i]
                row["prob"] = probs[i]
                row["rank"] = ranks[i]
            rows.append(row)
        return rows


def _clean(value):
    """NaN -> None for JSON."""
    return None if value is None or value != value else float(value)


HUB = DataHub()


def handle_health():
    sets = {}
    for set_code in config.TRACKED_SETS:
        model = registry.resolve(set_code, "PremierDraft")
        sets[set_code] = {
            "model_id": model.model_id,
            "model_kind": model.model_kind,
            "fallback": model.fallback,
        }
    return {
        "ok": True,
        "uptime_s": round(time.time() - START_TIME, 1),
        "sets": sets,
        "attribution": config.ATTRIBUTION,
    }


def handle_sets():
    result = {}
    for set_code in config.TRACKED_SETS:
        formats = {}
        for fmt in ["PremierDraft", "TradDraft", "QuickDraft"]:
            model = registry.resolve(set_code, fmt)
            stats = HUB.stats(set_code, "PremierDraft" if fmt == "QuickDraft" else fmt)
            formats[fmt] = {
                "model_id": model.model_id,
                "model_kind": model.model_kind,
                "fallback": model.fallback,
                "stats_source": stats["source"],
            }
        result[set_code] = formats
    return {"sets": result, "attribution": config.ATTRIBUTION}


def handle_models():
    versions = []
    if paths.MODELS_DIR.exists():
        for meta_file in sorted(paths.MODELS_DIR.glob("*/*/*/meta.json")):
            with open(meta_file) as file:
                meta = json.load(file)
            metrics_file = meta_file.parent / "metrics.json"
            entry = {
                "model_id": meta["model_id"],
                "kind": meta["kind"],
                "trained_at": meta.get("trained_at"),
                "is_latest": (meta_file.parent.parent / "latest").resolve()
                == meta_file.parent.resolve(),
            }
            if metrics_file.exists():
                with open(metrics_file) as file:
                    report = json.load(file)
                entry["top1_top_quartile"] = report.get("val_top_quartile", {}).get(
                    "top1"
                )
            versions.append(entry)
    return {"models": versions, "attribution": config.ATTRIBUTION}


def handle_cards(params):
    set_code = params.get("set", [""])[0].upper()
    if not set_code:
        return {"error": "set parameter required"}, 400
    fmt = params.get("format", ["PremierDraft"])[0]
    cards = HUB.card_payload(set_code, fmt, sorted(HUB.cards(set_code)))
    return {"set": set_code, "cards": cards, "attribution": config.ATTRIBUTION}


def handle_ratings(params):
    set_code = params.get("set", [""])[0].upper()
    fmt = params.get("format", ["PremierDraft"])[0]
    if not set_code:
        return {"error": "set parameter required"}, 400
    model = registry.resolve(set_code, fmt)
    p1p1 = HUB.p1p1(set_code, fmt, model)
    grp_ids = sorted(HUB.cards(set_code))
    rows = HUB.card_payload(set_code, fmt, grp_ids)
    for row in rows:
        row["ev_p1p1"] = p1p1.get(row["grp_id"])
    return {
        "set": set_code,
        "format": fmt,
        "model": {
            "id": model.model_id,
            "kind": model.model_kind,
            "fallback": model.fallback,
        },
        "stats_source": HUB.stats(set_code, fmt)["source"],
        "cards": rows,
        "attribution": config.ATTRIBUTION,
    }


def handle_deck(body):
    """POST /api/v1/deck — build advice for a submitted limited deck.

    {"set"?, "format"?, "deck": [grpId, ...], "deck_size"?, "land_slots"?}

    grpIds may repeat (a deck runs multiples); repeats are preserved because
    quantity matters to the curve and the land split. Basic lands in the list
    are ignored on purpose — recommending the split is the point.
    """
    from mtga import deck_advisor

    try:
        payload = json.loads(body)
    except (TypeError, json.JSONDecodeError):
        return {"error": "invalid JSON body"}, 400
    if not isinstance(payload, dict):
        return {"error": "JSON body must be an object"}, 400
    try:
        deck = _grp_id_list(payload, "deck", required=True)
    except ValueError as exc:
        return {"error": str(exc)}, 400

    def _positive_int(key, default):
        value = payload.get(key)
        if value is None:
            return default, None
        if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
            return None, f"{key} must be a positive integer"
        return value, None

    deck_size, err = _positive_int("deck_size", 40)
    if err:
        return {"error": err}, 400
    land_slots, err = _positive_int("land_slots", 17)
    if err:
        return {"error": err}, 400
    if land_slots >= deck_size:
        return {"error": "land_slots must be less than deck_size"}, 400

    raw_format = payload.get("format")
    if raw_format is not None and not isinstance(raw_format, str):
        return {"error": "format must be a string"}, 400
    fmt = raw_format or "PremierDraft"

    raw_set = payload.get("set")
    if raw_set is not None and not isinstance(raw_set, str):
        return {"error": "set must be a string"}, 400
    set_code = (raw_set or _infer_set(deck) or "").upper()
    if not set_code:
        return {"error": "set not provided and could not be inferred"}, 400

    identity = HUB.cards(set_code)
    text = HUB.card_text(set_code)
    stats = {
        row["grp_id"]: row for row in HUB.card_payload(set_code, fmt, sorted(set(deck)))
    }

    cards = []
    unknown = []
    for grp_id in deck:
        info = identity.get(grp_id)
        card_text = text.get(grp_id, {})
        if info is None and not card_text:
            unknown.append(grp_id)
            continue
        stat = stats.get(grp_id, {})
        cards.append(
            {
                "grp_id": grp_id,
                "name": (info or {}).get("name") or stat.get("name"),
                "mana_cost": card_text.get("mana_cost", ""),
                "type_line": card_text.get("type_line", ""),
                "oracle_text": card_text.get("oracle_text", ""),
                "gih_wr": stat.get("gih_wr_shrunk") or stat.get("gih_wr"),
                "alsa": stat.get("alsa"),
            }
        )

    advice = deck_advisor.advise(cards, deck_size=deck_size, land_slots=land_slots)
    advice.update(
        {
            "set": set_code,
            "format": fmt,
            "deck_size": deck_size,
            "land_slots": land_slots,
            "unknown_grp_ids": unknown,
            "has_card_text": bool(text),
            "attribution": config.ATTRIBUTION,
        }
    )
    return advice


MAX_REQUEST_BODY = 1_000_000


def _grp_id_list(payload, key, *, required=False):
    value = payload.get(key)
    if value is None:
        value = []
    if not isinstance(value, list):
        raise ValueError(f"{key} must be a list of grpIds")
    result = []
    for item in value:
        if isinstance(item, int) and not isinstance(item, bool):
            grp_id = item
        elif isinstance(item, str) and item.isdecimal():
            grp_id = int(item)
        else:
            raise ValueError(f"{key} must contain integer grpIds")
        if grp_id <= 0:
            raise ValueError(f"{key} must contain positive grpIds")
        result.append(grp_id)
    if required and not result:
        raise ValueError(f"{key} must be a non-empty list of grpIds")
    return result


def handle_score(body):
    try:
        payload = json.loads(body)
    except (TypeError, json.JSONDecodeError):
        return {"error": "invalid JSON body"}, 400
    if not isinstance(payload, dict):
        return {"error": "JSON body must be an object"}, 400
    try:
        pack = _grp_id_list(payload, "pack", required=True)
        pool = _grp_id_list(payload, "pool")
    except ValueError as exc:
        return {"error": str(exc)}, 400
    raw_format = payload.get("format")
    if raw_format is None or raw_format == "":
        fmt = "PremierDraft"
    elif not isinstance(raw_format, str):
        return {"error": "format must be a string"}, 400
    else:
        fmt = raw_format
    raw_set = payload.get("set")
    if raw_set is None or raw_set == "":
        raw_set = _infer_set(pack) or ""
    elif not isinstance(raw_set, str):
        return {"error": "set must be a string"}, 400
    set_code = raw_set.upper()
    if not set_code:
        return {"error": "set not provided and could not be inferred"}, 400

    model = registry.resolve(set_code, fmt)
    scores = model.score_pack(
        pack, pool, payload.get("pack_number"), payload.get("pick_number")
    )
    by_grp = {s.grp_id: s for s in scores}
    ordered = sorted(pack, key=lambda g: by_grp[g].rank)
    rows = HUB.card_payload(
        set_code,
        fmt,
        ordered,
        evs=[by_grp[g].ev for g in ordered],
        probs=[by_grp[g].prob for g in ordered],
        ranks=[by_grp[g].rank for g in ordered],
    )
    return {
        "set": set_code,
        "format": fmt,
        "model": {
            "id": model.model_id,
            "kind": model.model_kind,
            "fallback": model.fallback,
        },
        "cards": rows,
        "attribution": config.ATTRIBUTION,
    }


def _infer_set(pack):
    best, best_hits = None, 0
    for set_code in config.TRACKED_SETS:
        cards = HUB.cards(set_code)
        hits = sum(1 for g in pack if g in cards)
        if hits > best_hits:
            best, best_hits = set_code, hits
    # Require a clear majority of the pack to belong to the set.
    if best is not None and best_hits * 2 >= len(pack):
        return best
    return None


ROUTES_GET = {
    "/api/v1/health": lambda params: handle_health(),
    "/api/v1/sets": lambda params: handle_sets(),
    "/api/v1/models": lambda params: handle_models(),
    "/api/v1/cards": handle_cards,
    "/api/v1/ratings": handle_ratings,
}


class DraftApiHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "mtga-draft-api/0.1"

    def _send(self, payload, status=200):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)
        handler = ROUTES_GET.get(parsed.path)
        if handler is None:
            self._send({"error": "not found"}, 404)
            return
        try:
            result = handler(parse_qs(parsed.query))
        except Exception as e:  # noqa: BLE001
            self._send({"error": f"{type(e).__name__}: {e}"}, 500)
            return
        if isinstance(result, tuple):
            self._send(result[0], result[1])
        else:
            self._send(result)

    def do_POST(self):
        parsed = urlparse(self.path)
        handlers = {"/api/v1/score": handle_score, "/api/v1/deck": handle_deck}
        handler = handlers.get(parsed.path)
        if handler is None:
            self._send({"error": "not found"}, 404)
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            self._send({"error": "invalid Content-Length"}, 400)
            return
        if length < 0:
            self._send({"error": "invalid Content-Length"}, 400)
            return
        if length > MAX_REQUEST_BODY:
            self.close_connection = True
            self._send({"error": "request body too large"}, 413)
            return
        body = self.rfile.read(length) if length else b""
        try:
            result = handler(body)
        except Exception as e:  # noqa: BLE001
            print(f"{parsed.path} request failed: {type(e).__name__}: {e}")
            self._send({"error": "internal server error"}, 500)
            return
        if isinstance(result, tuple):
            self._send(result[0], result[1])
        else:
            self._send(result)

    def log_message(self, format, *args):  # noqa: A002
        print(f"{self.address_string()} {format % args}")


def serve(host="0.0.0.0", port=8100):
    server = ThreadingHTTPServer((host, port), DraftApiHandler)
    print(f"draft api listening on {host}:{port}")
    server.serve_forever()

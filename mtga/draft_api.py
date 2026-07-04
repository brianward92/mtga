"""The draft assistant HTTP API — stdlib only, modeled on scripts/serve_app.py.

Endpoints (all JSON, all carrying 17Lands attribution):
  GET  /api/v1/health
  GET  /api/v1/sets
  GET  /api/v1/cards?set=MSH
  GET  /api/v1/ratings?set=MSH&format=PremierDraft
  GET  /api/v1/models
  POST /api/v1/score   {"set"?, "format", "pack": [grpId], "pool": [grpId],
                        "pack_number"?, "pick_number"?}

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
            link.stat().st_mtime if (link := self._ratings_link(set_code, fmt)).exists()
            else 0
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
            p.stat().st_mtime if p.exists() else 0
            for p in [metrics_link, ratings_link]
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
                    "gih_n": int(row.gih_games) if row.gih_games == row.gih_games else 0,
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

    def card_payload(self, set_code, limited_type, grp_ids, evs=None, probs=None,
                     ranks=None):
        cards = self.cards(set_code)
        stats = self.stats(set_code, limited_type)["stats"]
        rows = []
        for i, grp_id in enumerate(grp_ids):
            info = cards.get(grp_id) or self.global_cards().get(grp_id) or {
                "grp_id": grp_id, "name": None, "colors": None, "rarity": None,
                "mana_value": None, "image_small": None, "image_normal": None}
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
    return {"ok": True, "uptime_s": round(time.time() - START_TIME, 1), "sets": sets,
            "attribution": config.ATTRIBUTION}


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
            entry = {"model_id": meta["model_id"], "kind": meta["kind"],
                     "trained_at": meta.get("trained_at"),
                     "is_latest": (meta_file.parent.parent / "latest").resolve()
                     == meta_file.parent.resolve()}
            if metrics_file.exists():
                with open(metrics_file) as file:
                    report = json.load(file)
                entry["top1_top_quartile"] = report.get("val_top_quartile", {}).get("top1")
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
        "set": set_code, "format": fmt,
        "model": {"id": model.model_id, "kind": model.model_kind,
                  "fallback": model.fallback},
        "stats_source": HUB.stats(set_code, fmt)["source"],
        "cards": rows,
        "attribution": config.ATTRIBUTION,
    }


def handle_score(body):
    try:
        payload = json.loads(body)
    except (TypeError, json.JSONDecodeError):
        return {"error": "invalid JSON body"}, 400
    pack = [int(g) for g in payload.get("pack") or []]
    pool = [int(g) for g in payload.get("pool") or []]
    if not pack:
        return {"error": "pack must be a non-empty list of grpIds"}, 400
    fmt = payload.get("format") or "PremierDraft"
    set_code = (payload.get("set") or _infer_set(pack) or "").upper()
    if not set_code:
        return {"error": "set not provided and could not be inferred"}, 400

    model = registry.resolve(set_code, fmt)
    scores = model.score_pack(pack, pool, payload.get("pack_number"),
                              payload.get("pick_number"))
    by_grp = {s.grp_id: s for s in scores}
    ordered = sorted(pack, key=lambda g: by_grp[g].rank)
    rows = HUB.card_payload(
        set_code, fmt, ordered,
        evs=[by_grp[g].ev for g in ordered],
        probs=[by_grp[g].prob for g in ordered],
        ranks=[by_grp[g].rank for g in ordered],
    )
    return {
        "set": set_code, "format": fmt,
        "model": {"id": model.model_id, "kind": model.model_kind,
                  "fallback": model.fallback},
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
        if parsed.path != "/api/v1/score":
            self._send({"error": "not found"}, 404)
            return
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else b""
        try:
            result = handle_score(body)
        except Exception as e:  # noqa: BLE001
            self._send({"error": f"{type(e).__name__}: {e}"}, 500)
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

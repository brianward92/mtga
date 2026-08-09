"""Structured card features for DraftFM: F_struct = 391 dims, frozen manifest.

Two phases (architecture doc §1.1):
  build_manifest(names_by_set) freezes the data-dependent vocabularies
    (top-128 subtypes, keywords on >= KEYWORD_MIN_CARDS unique cards), the
    regex flag list, and the feature-block layout into a manifest dict with a
    content hash. Vocabularies are counted over the given TRAINING sets only
    — corpus.EVAL_ONLY sets (MSH) are refused; MSH cards later featurize
    through the frozen manifest (the zero-shot contract).
  featurize(names, manifest) joins every name to Scryfall and returns a
    float32 [N, 391] matrix plus per-name join provenance.

Join contract: names.norm_17lands on the 17Lands side, names.norm on the
Scryfall side; full "A // B" name first, then front-face name. Printing
preference: in-expansion (when the caller passes prefer_sets_by_name), else
newest paper, else newest digital. Unmatched names raise
UnmatchedNamesError — never silent zeros.

Multiface cards (transform/modal_dfc/adventure/split/flip/prepare/
reversible_card) take every numeric block from the FRONT face via
card_faces.parquet; has_back_face and back_is_land live in the layout block.
All scalars are clipped+scaled to ~[0,1]; parse failures set the block's
missing-indicator, never a silent 0.

Layout block note: the design doc lists a 10-way layout one-hot with
has_back_face/back_is_land "folded in". Ten one-hot categories plus two
flags don't fit in the block's 10 dims, so the two categories absent from
the Arena corpus (flip: paper Kamigawa only; meld: 3 BRO pairs) merge into
"other", making room for the explicit has_back_face/back_is_land flags.
"""

import hashlib
import json
import math
import re

import numpy as np
import pandas as pd

from mtga.foundation import textemb
from mtga.lands import corpus, names, paths

MANIFEST_VERSION = "cardfeats_v1"
N_FEATURES = 391
SUBTYPE_SLOTS = 128  # top-128 subtypes by unique-card frequency
KEYWORD_SLOTS = 166  # fixed capacity; a manifest may populate fewer slots
KEYWORD_MIN_CARDS = 8
UNMATCHED_SCALE = 4.0  # count-of-unmatched subtypes/keywords, /4 clipped

CARD_TYPES = [
    "Creature",
    "Instant",
    "Sorcery",
    "Enchantment",
    "Artifact",
    "Planeswalker",
    "Land",
    "Battle",
    "Kindred",
]

# Multiface layouts whose per-face rows exist in card_faces.parquet; numeric
# blocks come from face 0. Physically double-faced layouts set has_back_face.
FACE_LAYOUTS = frozenset(
    {
        "transform",
        "modal_dfc",
        "adventure",
        "split",
        "flip",
        "prepare",
        "reversible_card",
    }
)
BACK_FACE_LAYOUTS = frozenset({"transform", "modal_dfc"})

LAYOUT_CATEGORIES = [
    "normal",
    "transform",
    "modal_dfc",
    "adventure",
    "split",
    "saga_like",
    "leveler_like",
    "other",
]
_LAYOUT_GROUPS = {
    "normal": "normal",
    "transform": "transform",
    "modal_dfc": "modal_dfc",
    "adventure": "adventure",
    "split": "split",
    "saga": "saga_like",
    "class": "saga_like",
    "case": "saga_like",
    "leveler": "leveler_like",
    "prototype": "leveler_like",
    "mutate": "leveler_like",
}

# 24 regex flags evaluated on the casefolded, self-name-masked, newline
# collapsed FRONT-face oracle text. Frozen into the manifest.
TEXT_FLAGS = [
    ("flag_activated", r":"),
    ("flag_triggered", r"\b(?:when|whenever|at the beginning)\b"),
    ("flag_etb", r"\benters\b"),
    ("flag_death_trigger", r"\bdies\b"),
    ("flag_attack_trigger", r"\battacks\b"),
    ("flag_draw", r"\bdraws? (?:a|two|three|four|x|\d+) cards?\b"),
    ("flag_targeted_removal", r"\b(?:destroy|exile) target\b"),
    ("flag_damage", r"\bdeals (?:\d+|x) damage to\b"),
    ("flag_counterspell", r"\bcounter target\b"),
    ("flag_combat_trick", r"target creature gets \+"),
    ("flag_token", r"\bcreates?\b[^.]*\btoken"),
    ("flag_p1p1_counters", r"\+1/\+1 counter"),
    ("flag_lifegain", r"\bgains? (?:\d+|x|that much) life\b"),
    ("flag_discard", r"\bdiscards?\b"),
    ("flag_sacrifice", r"\bsacrifices?\b"),
    ("flag_mill", r"\bmills?\b"),
    ("flag_gy_recursion", r"\breturn\b[^.]*\bfrom (?:your|a|their) graveyard"),
    ("flag_tutor", r"\bsearch(?:es)? your library\b"),
    ("flag_mana_ability", r"\badd \{"),
    ("flag_land_fetch", r"\bsearch(?:es)?\b[^.]*\blibrary\b[^.]*\bland"),
    ("flag_board_wipe", r"\b(?:each creature|all creatures)\b"),
    ("flag_dig", r"\b(?:scry|surveil|look at the top)\b"),
    ("flag_unblockable", r"can't be blocked"),
    ("flag_modal", r"\bchoose (?:one|two|three|one or more)\b"),
]

_SCRYFALL_COLUMNS = [
    "id",
    "name",
    "set",
    "rarity",
    "type_line",
    "mana_cost",
    "cmc",
    "colors",
    "color_identity",
    "oracle_text",
    "power",
    "toughness",
    "loyalty",
    "keywords",
    "layout",
    "digital",
]


class UnmatchedNamesError(ValueError):
    """One or more 17Lands names have no Scryfall row (hard-fail contract)."""

    def __init__(self, unmatched):
        self.names = sorted(unmatched)
        listing = "\n  ".join(self.names)
        super().__init__(
            f"{len(self.names)} name(s) not found in the Scryfall parquet "
            f"(fix names.ALIASES_17L or the parquet; never exclude):\n  {listing}"
        )


# ---------------------------------------------------------------------------
# Feature-block layout (position-stable; vocab entries live in the manifest).


def feature_blocks():
    """Ordered [{name, start, columns}] covering exactly N_FEATURES dims."""
    spec = [
        (
            "mana_value",
            ["cmc_scaled"] + [f"cmc_is_{i}" for i in range(8)] + ["cmc_is_8plus"],
        ),
        (
            "pips",
            [
                "pip_w",
                "pip_u",
                "pip_b",
                "pip_r",
                "pip_g",
                "pip_c",
                "pip_generic",
                "has_x",
                "n_hybrid",
                "n_phyrexian",
            ],
        ),
        (
            "colors",
            [
                "color_w",
                "color_u",
                "color_b",
                "color_r",
                "color_g",
                "n_colors",
                "is_colorless",
                "is_multicolor",
            ],
        ),
        ("color_identity", ["ci_w", "ci_u", "ci_b", "ci_r", "ci_g"]),
        ("supertypes", ["super_legendary", "super_snow", "super_basic"]),
        ("card_types", [f"type_{t.lower()}" for t in CARD_TYPES]),
        (
            "subtypes",
            [f"subtype_{i:03d}" for i in range(SUBTYPE_SLOTS)] + ["subtype_unmatched"],
        ),
        (
            "stats",
            [
                f"{s}_{k}"
                for s in ("power", "toughness", "loyalty")
                for k in ("scaled", "missing", "star")
            ],
        ),
        (
            "rarity",
            [
                "rarity_common",
                "rarity_uncommon",
                "rarity_rare",
                "rarity_mythic",
                "rarity_other",
            ],
        ),
        (
            "keywords",
            [f"keyword_{i:03d}" for i in range(KEYWORD_SLOTS)] + ["keyword_unmatched"],
        ),
        (
            "layout",
            [f"layout_{c}" for c in LAYOUT_CATEGORIES]
            + ["has_back_face", "back_is_land"],
        ),
        ("text", ["text_len", "text_lines"] + [n for n, _ in TEXT_FLAGS]),
    ]
    blocks, start = [], 0
    for name, columns in spec:
        blocks.append({"name": name, "start": start, "columns": columns})
        start += len(columns)
    assert start == N_FEATURES, start
    return blocks


def manifest_columns(manifest):
    """Flat, ordered list of all feature column names."""
    return [c for block in manifest["blocks"] for c in block["columns"]]


# ---------------------------------------------------------------------------
# Scryfall loading + name resolution.


def load_scryfall():
    """(cards, faces) frames; cards carries released_at from sets.parquet."""
    cards = pd.read_parquet(paths.SCRYFALL_CARDS_PARQUET, columns=_SCRYFALL_COLUMNS)
    sets = pd.read_parquet(paths.SCRYFALL_SETS_PARQUET, columns=["set", "released_at"])
    cards = cards.merge(sets, on="set", how="left")
    if paths.SCRYFALL_FACES_PARQUET.exists():
        faces = pd.read_parquet(paths.SCRYFALL_FACES_PARQUET)
    else:
        faces = pd.DataFrame(
            columns=[
                "card_id",
                "face_index",
                "name",
                "mana_cost",
                "type_line",
                "oracle_text",
                "colors",
                "power",
                "toughness",
                "loyalty",
            ]
        )
    return cards, faces


def _s(value):
    """String field with parquet nulls flattened to ''."""
    if value is None:
        return ""
    if isinstance(value, float) and math.isnan(value):
        return ""
    return str(value)


def _front_face(full_name):
    return full_name.split(" // ")[0]


def _back_face(full_name):
    parts = full_name.split(" // ")
    return parts[1] if len(parts) > 1 else None


def resolve_names(query_names, cards=None, faces=None, prefer_sets_by_name=None):
    """Join 17Lands names to one Scryfall printing each.

    Returns a list of records aligned with query_names:
      {name, name_norm, card: row-dict, faces: [face-dicts], match,
       in_expansion}.
    Some transform/MDFC bonus-sheet cards (e.g. LCI's back-face lands) are
    referenced by 17Lands under their BACK face name alone -- back_map is
    the front_map fallback's mirror image for exactly that case.
    Raises UnmatchedNamesError listing every name with no candidate row.
    """
    if cards is None or faces is None:
        cards, faces = load_scryfall()
    prefer_sets_by_name = prefer_sets_by_name or {}

    rows = cards.to_dict("records")
    full_map, front_map, back_map = {}, {}, {}
    for i, row in enumerate(rows):
        full_name = _s(row["name"])
        full = names.norm(full_name)
        full_map.setdefault(full, []).append(i)
        front = names.norm(_front_face(full_name))
        if front != full:
            front_map.setdefault(front, []).append(i)
        back_name = _back_face(full_name)
        if back_name is not None:
            back_map.setdefault(names.norm(back_name), []).append(i)

    faces_by_card = {}
    if len(faces):
        for face in faces.sort_values("face_index").to_dict("records"):
            faces_by_card.setdefault(face["card_id"], []).append(face)

    records, unmatched = [], []
    for query in query_names:
        key = names.norm_17lands(query)
        match = "full"
        candidates = full_map.get(key)
        if not candidates:
            match = "front"
            candidates = front_map.get(key)
        if not candidates:
            match = "back"
            candidates = back_map.get(key)
        if not candidates:
            unmatched.append(query)
            continue
        prefer = {s.lower() for s in prefer_sets_by_name.get(query, ())}
        # Deterministic choice: in-expansion, then paper, then newest
        # released_at, then id as the final tiebreak.
        chosen = min(
            candidates,
            key=lambda i: (
                0 if rows[i]["set"] in prefer else 1,
                1 if bool(rows[i]["digital"]) else 0,
                _released_sort_key(rows[i]["released_at"]),
                _s(rows[i]["id"]),
            ),
        )
        row = rows[chosen]
        records.append(
            {
                "name": query,
                "name_norm": key,
                "card": row,
                "faces": faces_by_card.get(row["id"], []),
                "match": match,
                "in_expansion": row["set"] in prefer,
            }
        )
    if unmatched:
        raise UnmatchedNamesError(unmatched)
    return records


def _released_sort_key(released_at):
    """Newest date first; unknown dates last."""
    date = _s(released_at)
    if not date:
        return "￿"  # sorts after any character-inverted ISO date
    return "".join(chr(255 - ord(c)) for c in date)


# ---------------------------------------------------------------------------
# Per-card field extraction (front face for multiface layouts).


def card_fields(record):
    """Front-face fields + back-face info for one resolved record."""
    card, faces = record["card"], record["faces"]
    layout = _s(card["layout"]) or "normal"
    multiface = layout in FACE_LAYOUTS and len(faces) > 0
    front = faces[0] if multiface else None
    back = faces[1] if multiface and len(faces) > 1 else None

    def pick(field):
        if front is not None and _s(front.get(field)):
            return _s(front[field])
        return _s(card.get(field))

    mana_cost = pick("mana_cost")
    parsed = parse_mana_cost(mana_cost)
    if multiface:
        cmc = parsed["mv"]  # FRONT-face mana value, never the combined cmc
    else:
        raw_cmc = card.get("cmc")
        cmc = (
            float(raw_cmc)
            if raw_cmc is not None and not pd.isna(raw_cmc)
            else parsed["mv"]
        )

    colors = pick("colors")
    if multiface and not _s(front.get("colors")):
        # Split/adventure/prepare faces carry no colors; the face's mana cost
        # is authoritative (top-level colors merge both faces). Cards with no
        # cost at all fall back to the card-level colors.
        colors = (
            ",".join(sorted(c for c in "WUBRG" if parsed["pips"][c] > 0))
            if mana_cost
            else _s(card.get("colors"))
        )

    has_back = layout in BACK_FACE_LAYOUTS and back is not None
    back_type_line = _s(back["type_line"]) if back is not None else ""
    return {
        "name": pick("name") or record["name"],
        "full_name": _s(card["name"]),
        "layout": layout,
        "mana_cost": mana_cost,
        "mana": parsed,
        "cmc": cmc,
        "type_line": pick("type_line"),
        "full_type_line": _s(card["type_line"]),
        "oracle_text": pick("oracle_text"),
        "back_oracle_text": _s(back["oracle_text"]) if back is not None else "",
        "colors": {c for c in colors.split(",") if c in set("WUBRG")},
        "color_identity": {
            c for c in _s(card["color_identity"]).split(",") if c in set("WUBRG")
        },
        "power": front.get("power") if front is not None else card.get("power"),
        "toughness": (
            front.get("toughness") if front is not None else card.get("toughness")
        ),
        "loyalty": (front.get("loyalty") if front is not None else card.get("loyalty")),
        "rarity": _s(card["rarity"]).lower(),
        "keywords": [k.strip() for k in _s(card["keywords"]).split(",") if k.strip()],
        "has_back_face": has_back,
        "back_is_land": has_back and "land" in back_type_line.lower(),
    }


_PIP_RE = re.compile(r"\{([^}]*)\}")
_WUBRG = set("WUBRG")


def parse_mana_cost(cost):
    """Pip counts, generic amount, X/hybrid/phyrexian flags, and mana value.

    Mana-value rules: {X}=0, {N}=N, {2/W}=2, everything else 1.
    Hybrid tokens count toward every color they contain.
    """
    out = {
        "pips": {c: 0 for c in "WUBRGC"},
        "generic": 0,
        "has_x": False,
        "hybrid": 0,
        "phyrexian": 0,
        "mv": 0.0,
    }
    for token in _PIP_RE.findall(cost or ""):
        t = token.upper().strip()
        if not t or t in ("Y", "Z"):
            continue
        if t == "X":
            out["has_x"] = True
            continue
        if t.isdigit():
            out["generic"] += int(t)
            out["mv"] += int(t)
            continue
        if "/" in t:
            parts = t.split("/")
            colored = [p for p in parts if p in _WUBRG]
            numeric = [p for p in parts if p.isdigit()]
            if "P" in parts:
                out["phyrexian"] += 1
            if len(colored) >= 2 or numeric:
                out["hybrid"] += 1
            out["mv"] += int(numeric[0]) if numeric else 1
            for c in colored:
                out["pips"][c] += 1
            continue
        if t in _WUBRG or t == "C":
            out["pips"][t] += 1
            out["mv"] += 1
            continue
        if t == "S":  # snow mana behaves as a colorless pip
            out["pips"]["C"] += 1
            out["mv"] += 1
            continue
        out["mv"] += 1  # unknown symbol: count 1 toward mana value
    return out


_NUM_RE = re.compile(r"-?\d+(?:\.\d+)?")


def parse_stat(value):
    """(scaled, missing, star) for a power/toughness/loyalty string."""
    s = _s(value).strip()
    if not s:
        return 0.0, 1.0, 0.0
    if "*" in s or "∞" in s:
        m = _NUM_RE.search(s)
        base = float(m.group()) if m else 0.0
        return _clip(base / 8.0), 0.0, 1.0
    try:
        return _clip(float(s) / 8.0), 0.0, 0.0
    except ValueError:
        return 0.0, 1.0, 0.0  # unparseable -> missing indicator, never 0-as-value


def parse_type_line(type_line):
    """(supertype tokens+types set, subtype list) from a FRONT type line."""
    front = type_line.split(" // ")[0]
    left, _, right = front.partition("—")
    tokens = left.split()
    types = {
        ("Kindred" if t == "Tribal" else t)
        for t in tokens
        if t in CARD_TYPES or t == "Tribal"
    }
    return tokens, types, right.split()


def _clip(x):
    return float(min(max(x, 0.0), 1.0))


# ---------------------------------------------------------------------------
# Phase (a): the frozen manifest.


def build_manifest(names_by_set, cards=None, faces=None, allow_eval_only=False):
    """Freeze vocabularies + layout from the given TRAINING sets only.

    names_by_set: {set_code: [17Lands names]}. EVAL_ONLY sets (MSH) are
    refused — the zero-shot contract is that MSH cards featurize through a
    manifest they never influenced. allow_eval_only=True waives that for a
    FINAL all-data model that deliberately spends the held-out set; it
    invalidates every zero-shot claim about the sets it lets in, so a
    development manifest must never set it.
    """
    banned = set(names_by_set) & corpus.EVAL_ONLY
    if banned and not allow_eval_only:
        raise ValueError(
            f"manifest must never be built from EVAL_ONLY sets: {sorted(banned)}"
        )

    prefer = {}
    for set_code, set_names in names_by_set.items():
        for name in set_names:
            prefer.setdefault(name, []).append(set_code)
    union = sorted(prefer, key=names.norm_17lands)
    records = resolve_names(union, cards, faces, prefer_sets_by_name=prefer)

    subtype_names, keyword_names = {}, {}
    for record in records:
        fields = card_fields(record)
        _, _, subtypes = parse_type_line(fields["type_line"])
        for subtype in set(subtypes):
            subtype_names.setdefault(subtype, set()).add(record["name_norm"])
        for keyword in set(fields["keywords"]):
            keyword_names.setdefault(keyword, set()).add(record["name_norm"])

    subtype_vocab = [
        t for t, _ in sorted(subtype_names.items(), key=lambda kv: (-len(kv[1]), kv[0]))
    ][:SUBTYPE_SLOTS]
    keyword_vocab = [
        k
        for k, cards_ in sorted(
            keyword_names.items(), key=lambda kv: (-len(kv[1]), kv[0])
        )
        if len(cards_) >= KEYWORD_MIN_CARDS
    ][:KEYWORD_SLOTS]

    manifest = {
        "version": MANIFEST_VERSION,
        "n_features": N_FEATURES,
        "training_sets": sorted(names_by_set),
        "n_names": len(union),
        "subtype_slots": SUBTYPE_SLOTS,
        "subtype_vocab": subtype_vocab,
        "keyword_slots": KEYWORD_SLOTS,
        "keyword_min_cards": KEYWORD_MIN_CARDS,
        "keyword_vocab": keyword_vocab,
        "unmatched_scale": UNMATCHED_SCALE,
        "layout_categories": LAYOUT_CATEGORIES,
        "text_flags": [[n, p] for n, p in TEXT_FLAGS],
        "blocks": feature_blocks(),
    }
    manifest["content_hash"] = content_hash(manifest)
    return manifest


_HASH_KEYS = [
    "version",
    "n_features",
    "subtype_slots",
    "subtype_vocab",
    "keyword_slots",
    "keyword_min_cards",
    "keyword_vocab",
    "unmatched_scale",
    "layout_categories",
    "text_flags",
    "blocks",
]


def content_hash(manifest):
    """sha256 over the parts that define featurization (not provenance)."""
    frozen = {k: manifest[k] for k in _HASH_KEYS}
    blob = json.dumps(frozen, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def save_manifest(manifest, path=None):
    path = paths.FEATURIZER_MANIFEST if path is None else path
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as fh:
        json.dump(manifest, fh, indent=2)
    return path


def load_manifest(path=None):
    path = paths.FEATURIZER_MANIFEST if path is None else path
    with open(path) as fh:
        return json.load(fh)


# ---------------------------------------------------------------------------
# Phase (b): featurize through a frozen manifest.


def featurize(query_names, manifest, cards=None, faces=None, prefer_sets_by_name=None):
    """float32 [N, 391] matrix + per-name provenance dicts.

    Any name with no Scryfall row raises UnmatchedNamesError up front.
    """
    records = resolve_names(
        query_names, cards, faces, prefer_sets_by_name=prefer_sets_by_name
    )
    columns = manifest_columns(manifest)
    col = {name: i for i, name in enumerate(columns)}
    assert len(columns) == manifest["n_features"]

    subtype_slot = {t: i for i, t in enumerate(manifest["subtype_vocab"])}
    keyword_slot = {k.casefold(): i for i, k in enumerate(manifest["keyword_vocab"])}
    layout_index = {c: i for i, c in enumerate(manifest["layout_categories"])}
    flags = [(n, re.compile(p)) for n, p in manifest["text_flags"]]
    scale = float(manifest.get("unmatched_scale", UNMATCHED_SCALE))

    matrix = np.zeros((len(records), manifest["n_features"]), dtype=np.float32)
    provenance = []
    for r, record in enumerate(records):
        fields = card_fields(record)
        row = matrix[r]

        # Mana value.
        cmc = fields["cmc"]
        row[col["cmc_scaled"]] = _clip(cmc / 8.0)
        bucket = min(max(int(cmc), 0), 8)
        row[col["cmc_is_8plus" if bucket == 8 else f"cmc_is_{bucket}"]] = 1.0

        # Pips.
        mana = fields["mana"]
        for c in "WUBRGC":
            row[col[f"pip_{c.lower()}"]] = _clip(mana["pips"][c] / 4.0)
        row[col["pip_generic"]] = _clip(mana["generic"] / 8.0)
        row[col["has_x"]] = 1.0 if mana["has_x"] else 0.0
        row[col["n_hybrid"]] = _clip(mana["hybrid"] / 4.0)
        row[col["n_phyrexian"]] = _clip(mana["phyrexian"] / 4.0)

        # Colors + color identity.
        colors = fields["colors"]
        for c in "WUBRG":
            row[col[f"color_{c.lower()}"]] = 1.0 if c in colors else 0.0
            row[col[f"ci_{c.lower()}"]] = 1.0 if c in fields["color_identity"] else 0.0
        row[col["n_colors"]] = _clip(len(colors) / 3.0)
        row[col["is_colorless"]] = 1.0 if not colors else 0.0
        row[col["is_multicolor"]] = 1.0 if len(colors) >= 2 else 0.0

        # Supertypes, card types, subtypes.
        tokens, types, subtypes = parse_type_line(fields["type_line"])
        row[col["super_legendary"]] = 1.0 if "Legendary" in tokens else 0.0
        row[col["super_snow"]] = 1.0 if "Snow" in tokens else 0.0
        row[col["super_basic"]] = 1.0 if "Basic" in tokens else 0.0
        for t in types:
            row[col[f"type_{t.lower()}"]] = 1.0
        unmatched_subtypes = 0
        for subtype in set(subtypes):
            slot = subtype_slot.get(subtype)
            if slot is None:
                unmatched_subtypes += 1
            else:
                row[col[f"subtype_{slot:03d}"]] = 1.0
        row[col["subtype_unmatched"]] = _clip(unmatched_subtypes / scale)

        # P/T/loyalty with missing/star indicators.
        for stat in ("power", "toughness", "loyalty"):
            scaled, missing, star = parse_stat(fields[stat])
            row[col[f"{stat}_scaled"]] = scaled
            row[col[f"{stat}_missing"]] = missing
            row[col[f"{stat}_star"]] = star

        # Rarity.
        rarity = fields["rarity"]
        if rarity in ("common", "uncommon", "rare", "mythic"):
            row[col[f"rarity_{rarity}"]] = 1.0
        else:
            row[col["rarity_other"]] = 1.0

        # Keywords.
        unmatched_keywords = 0
        for keyword in set(fields["keywords"]):
            slot = keyword_slot.get(keyword.casefold())
            if slot is None:
                unmatched_keywords += 1
            else:
                row[col[f"keyword_{slot:03d}"]] = 1.0
        row[col["keyword_unmatched"]] = _clip(unmatched_keywords / scale)

        # Layout.
        category = _LAYOUT_GROUPS.get(fields["layout"], "other")
        row[col[f"layout_{category}"]] = 1.0
        row[col["has_back_face"]] = 1.0 if fields["has_back_face"] else 0.0
        row[col["back_is_land"]] = 1.0 if fields["back_is_land"] else 0.0

        # Text-derived features (front face, self-name masked).
        raw = fields["oracle_text"]
        masked = textemb.mask_self_names(
            fields["full_name"], fields["full_type_line"], raw
        )
        collapsed = textemb.collapse_lines(masked).casefold()
        row[col["text_len"]] = _clip(len(collapsed) / 400.0)
        row[col["text_lines"]] = _clip((raw.count("\n") + 1 if raw else 0) / 6.0)
        for flag_name, pattern in flags:
            if pattern.search(collapsed):
                row[col[flag_name]] = 1.0

        card = record["card"]
        provenance.append(
            {
                "name": record["name"],
                "name_norm": record["name_norm"],
                "scryfall_id": _s(card["id"]),
                "set": _s(card["set"]),
                "released_at": _s(card["released_at"]),
                "digital": bool(card["digital"]),
                "layout": fields["layout"],
                "match": record["match"],
                "in_expansion": record["in_expansion"],
            }
        )
    return matrix, provenance


def embed_inputs(query_names, cards=None, faces=None, prefer_sets_by_name=None):
    """Per-name inputs for textemb.normalize_oracle, keyed by name."""
    records = resolve_names(
        query_names, cards, faces, prefer_sets_by_name=prefer_sets_by_name
    )
    out = {}
    for record in records:
        fields = card_fields(record)
        out[record["name"]] = {
            "name": fields["full_name"] or record["name"],
            "type_line": fields["full_type_line"] or fields["type_line"],
            "oracle_front": fields["oracle_text"],
            "oracle_back": fields["back_oracle_text"] or None,
        }
    return out

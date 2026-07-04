"""Oracle-text normalization + frozen text-embedding cache for DraftFM.

Normalization (architecture doc §1.2): the card's own name and — for
legendary cards — its short name ("Elenda, the Dusk Rose" -> "Elenda")
become "~"; parenthetical reminder text is KEPT (for a brand-new mechanic
the reminder is the only definition the model ever sees); newlines collapse
to " | "; numbers and mana symbols stay verbatim. The embed string is
"{type_line} | {oracle}" plus " // {back_type_line} | {back_oracle}" for
double-faced cards.

Embedding model: BAAI/bge-small-en-v1.5 (384-d, L2-normalized), imported
lazily — the training/serving venvs never carry sentence-transformers.
embed_names() serves from an .npz cache keyed by (name_norm,
NORMALIZATION_VERSION); on a cache miss without the model importable it
raises a RuntimeError listing the missing names and pointing at
scripts/setup_embed.sh (run the embed step in .venv-embed, then re-run).
"""

import os
from pathlib import Path

import numpy as np

from mtga.lands import names as names_mod
from mtga.lands import paths

NORMALIZATION_VERSION = "onorm-v1"
MODEL_NAME = "BAAI/bge-small-en-v1.5"
EMBED_DIM = 384


# ---------------------------------------------------------------------------
# Normalization.

def mask_self_names(name, type_line, text):
    """Replace the card's own name(s) in oracle text with "~".

    Masks the full "A // B" name, each face name, and — when the type line
    says Legendary — each face's short name (the part before the comma).
    Longest aliases first so "Elenda, the Dusk Rose" wins over "Elenda".
    """
    if not text:
        return ""
    aliases = set()
    full = (name or "").strip()
    if full:
        aliases.add(full)
        for face in full.split(" // "):
            face = face.strip()
            if face:
                aliases.add(face)
                if "Legendary" in (type_line or "") and "," in face:
                    short = face.split(",")[0].strip()
                    if short:
                        aliases.add(short)
    masked = text
    for alias in sorted(aliases, key=len, reverse=True):
        masked = masked.replace(alias, "~")
    return masked


def collapse_lines(text):
    """Newlines -> " | ", whitespace runs collapsed. Reminder text is kept."""
    if not text:
        return ""
    return " ".join(text.replace("\n", " | ").split())


def normalize_oracle(name, type_line, oracle_front, oracle_back=None):
    """The frozen embed string for one card.

    type_line may be the combined "Front — X // Back — Y" line; it is split
    across the faces. Empty oracle text leaves just the type line.
    """
    parts = [p.strip() for p in (type_line or "").split(" // ")]
    front_tl = parts[0] if parts else ""
    front = collapse_lines(mask_self_names(name, type_line, oracle_front))
    out = f"{front_tl} | {front}" if front else front_tl
    back = collapse_lines(mask_self_names(name, type_line, oracle_back or ""))
    if back:
        back_tl = parts[1] if len(parts) > 1 else ""
        out += f" // {back_tl} | {back}" if back_tl else f" // {back}"
    return out


# ---------------------------------------------------------------------------
# Embedding cache.

def _load_encoder():
    """Import sentence-transformers lazily; tests monkeypatch this."""
    from sentence_transformers import SentenceTransformer
    return SentenceTransformer(MODEL_NAME)


def _read_cache(cache_path):
    """{name_norm: vector} — empty when absent or version/model stale."""
    if not os.path.exists(cache_path):
        return {}
    with np.load(cache_path, allow_pickle=False) as z:
        if (str(z["normalization_version"]) != NORMALIZATION_VERSION
                or str(z["model"]) != MODEL_NAME):
            return {}
        cached_names = [str(n) for n in z["names"]]
        vectors = np.asarray(z["vectors"], dtype=np.float32)
    return dict(zip(cached_names, vectors))


def _write_cache(cache_path, entries):
    cache_path = Path(cache_path)
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    ordered = sorted(entries)
    tmp = cache_path.parent / (cache_path.name + ".tmp.npz")
    np.savez(
        tmp,
        names=np.array(ordered),
        vectors=np.stack([entries[n] for n in ordered]).astype(np.float32)
        if ordered else np.zeros((0, EMBED_DIM), dtype=np.float32),
        normalization_version=NORMALIZATION_VERSION,
        model=MODEL_NAME,
    )
    os.replace(tmp, cache_path)
    return cache_path


def embed_names(query_names, cache_path=None, texts_by_name=None):
    """float32 [N, 384] embeddings aligned with query_names.

    Serves from the .npz cache when it covers every (normalized) name. On a
    miss it needs sentence-transformers: if importable, the missing names
    are embedded (texts_by_name overrides the Scryfall-derived embed
    strings) and the cache is extended; otherwise a RuntimeError lists the
    missing names — run scripts/setup_embed.sh and redo the embed step with
    .venv-embed/bin/python.
    """
    cache_path = paths.TEXT_EMB_CACHE if cache_path is None else cache_path
    norms = [names_mod.norm_17lands(n) for n in query_names]
    cache = _read_cache(cache_path)

    display, missing = {}, []
    for name, norm in zip(query_names, norms):
        if norm not in cache and norm not in display:
            display[norm] = name
            missing.append(norm)

    if missing:
        try:
            encoder = _load_encoder()
        except ImportError as err:
            listing = "\n  ".join(display[n] for n in missing)
            raise RuntimeError(
                f"text-embedding cache {cache_path} is missing "
                f"{len(missing)} name(s) and sentence-transformers is not "
                f"importable here. Run scripts/setup_embed.sh once, then "
                f"re-run the --embed step with .venv-embed/bin/python to "
                f"extend the cache. Missing:\n  {listing}"
            ) from err
        texts = _embed_texts(missing, display, texts_by_name)
        vectors = np.asarray(
            encoder.encode(texts, normalize_embeddings=True,
                           convert_to_numpy=True),
            dtype=np.float32,
        )
        cache.update(zip(missing, vectors))
        _write_cache(cache_path, cache)

    return np.stack([cache[n] for n in norms]).astype(np.float32)


def _embed_texts(missing_norms, display, texts_by_name):
    """Embed strings for the missing names (caller-provided or Scryfall)."""
    if texts_by_name is not None:
        provided = {names_mod.norm_17lands(k): v
                    for k, v in texts_by_name.items()}
        absent = [display[n] for n in missing_norms if n not in provided]
        if absent:
            raise KeyError(f"texts_by_name lacks entries for: {absent}")
        return [provided[n] for n in missing_norms]

    from mtga.foundation import featurize  # lazy: avoids circular import

    inputs = featurize.embed_inputs([display[n] for n in missing_norms])
    return [
        normalize_oracle(spec["name"], spec["type_line"],
                         spec["oracle_front"], spec["oracle_back"])
        for spec in (inputs[display[n]] for n in missing_norms)
    ]

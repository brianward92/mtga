"""Memmap training store for DraftFM: curated parquet -> flat npy shards.

Layout per (set, format) shard directory
`$MTGA_DATA_ROOT/foundation/shards/<SET>.<FORMAT>/`:

    pool_slots.npy   uint16 [N, 46]   vocab indices of distinct pool slots, PAD-padded
    pool_counts.npy  uint8  [N, 46]   copies held of each slot (capped 8)
    pack_slots.npy   uint16 [N, 16]   vocab indices of distinct pack slots
    pick_pos.npy     uint8  [N]       position of the human pick within pack_slots
    context.npy      uint8  [N, 5]    pack_number, pick_number, wr_bucket_id,
                                      n_games_id, format_id
    split.npy        uint16 [N]       crc32(draft_id) % 1000 (val = < 50)
    meta.json                          rows, set scalars, source etag, hashes

Feature matrices live beside them in
`foundation/features/` (built by scripts/build_card_features.py); shards
reference cards by vocab index, features are gathered at train time.

Everything is uint8/uint16 so the full ~168M-pick corpus is ~25GB and lives
in the page cache after the first epoch (96GB unified memory on n42).
"""

import json
import zlib

import duckdb
import numpy as np

from mtga.lands import paths
from mtga.models.draftnet import VAL_PERMILLE

PAD = np.uint16(0xFFFF)
POOL_SLOTS = 46
PACK_SLOTS = 16
POOL_COUNT_CAP = 8

WR_BUCKET_MISSING = 255
GAMES_BUCKETS = [1, 5, 10, 50, 100, 500, 1000]
FORMAT_IDS = {"PremierDraft": 0, "TradDraft": 1}
CHUNK = 500_000


def shard_dir(set_code, limited_type):
    return paths.DATA_ROOT / "foundation" / "shards" / f"{set_code}.{limited_type}"


def wr_bucket_id(values):
    """user_game_win_rate_bucket float -> ordinal id: round(wr*50) in [15,45]."""
    ids = np.round(np.nan_to_num(values, nan=-1.0) * 50).astype(np.int16)
    ids = np.clip(ids, 15, 45).astype(np.uint8)
    ids[np.isnan(values)] = WR_BUCKET_MISSING
    return ids


def games_bucket_id(values):
    ids = np.full(len(values), 255, dtype=np.uint8)
    for i, bucket in enumerate(GAMES_BUCKETS):
        ids[values == bucket] = i
    return ids


def _pad_sparse(matrix, width):
    """Dense int8 [n, vocab] -> (slots uint16 [n, width], counts uint8).

    Vectorized: nonzero coordinates grouped by row, positions within each row
    computed from first-occurrence offsets.
    """
    rows, cols = np.nonzero(matrix)
    counts = matrix[rows, cols]
    first = np.searchsorted(rows, np.arange(matrix.shape[0]))
    positions = np.arange(len(rows)) - first[rows]
    if len(positions) and positions.max() >= width:
        raise ValueError(f"row exceeds {width} distinct slots (max {positions.max()+1})")
    slots = np.full((matrix.shape[0], width), PAD, dtype=np.uint16)
    out_counts = np.zeros((matrix.shape[0], width), dtype=np.uint8)
    slots[rows, positions] = cols.astype(np.uint16)
    out_counts[rows, positions] = np.minimum(counts, POOL_COUNT_CAP).astype(np.uint8)
    return slots, out_counts


def build_shard(set_code, limited_type, force=False):
    """Curated draft parquet -> one shard directory. Idempotent by etag."""
    parquet = paths.curated_path("draft", set_code, limited_type)
    vocab_file = paths.vocab_path(set_code, limited_type)
    out = shard_dir(set_code, limited_type)
    curated_meta = json.loads(paths.meta_path(parquet).read_text())
    meta_file = out / "meta.json"
    if meta_file.exists() and not force:
        if json.loads(meta_file.read_text()).get("source_etag") == curated_meta.get(
            "source_etag"
        ):
            return {"status": "SKIPPED", "path": str(out)}

    vocab = json.loads(vocab_file.read_text())["names"]
    out.mkdir(parents=True, exist_ok=True)
    format_id = FORMAT_IDS.get(limited_type, 2)

    con = duckdb.connect()
    con.execute("SET memory_limit='12GB'")
    total = con.execute(
        f"SELECT count(*) FROM '{parquet}' WHERE pick_index >= 0"
    ).fetchone()[0]

    pool_slots = np.lib.format.open_memmap(
        out / "pool_slots.npy", mode="w+", dtype=np.uint16, shape=(total, POOL_SLOTS))
    pool_counts = np.lib.format.open_memmap(
        out / "pool_counts.npy", mode="w+", dtype=np.uint8, shape=(total, POOL_SLOTS))
    pack_slots = np.lib.format.open_memmap(
        out / "pack_slots.npy", mode="w+", dtype=np.uint16, shape=(total, PACK_SLOTS))
    pick_pos = np.lib.format.open_memmap(
        out / "pick_pos.npy", mode="w+", dtype=np.uint8, shape=(total,))
    context = np.lib.format.open_memmap(
        out / "context.npy", mode="w+", dtype=np.uint8, shape=(total, 5))
    split = np.lib.format.open_memmap(
        out / "split.npy", mode="w+", dtype=np.uint16, shape=(total,))

    pool_cols = ", ".join(f'"pool_{n}"' for n in vocab)
    pack_cols = ", ".join(f'"pack_card_{n}"' for n in vocab)
    reader = con.execute(
        f"""
        SELECT pick_index, draft_id, pack_number, pick_number,
               user_game_win_rate_bucket, user_n_games_bucket,
               [{pool_cols}] AS pool, [{pack_cols}] AS pack
        FROM '{parquet}' WHERE pick_index >= 0
        """
    )
    offset = 0
    crc_cache = {}
    while True:
        chunk = reader.fetch_df_chunk(8)  # ~8 * 122880 rows per call
        if chunk is None or len(chunk) == 0:
            break
        n = len(chunk)
        pool = np.stack(chunk["pool"].to_numpy()).astype(np.int8)
        pack = np.stack(chunk["pack"].to_numpy()).astype(np.int8)
        slots, counts = _pad_sparse(pool, POOL_SLOTS)
        pool_slots[offset:offset + n] = slots
        pool_counts[offset:offset + n] = counts
        pslots, _ = _pad_sparse(np.sign(pack), PACK_SLOTS)
        pack_slots[offset:offset + n] = pslots

        picks = chunk["pick_index"].to_numpy().astype(np.uint16)
        # The picked card is not always still visible in pack_card_* for
        # every era; guarantee it holds a slot so the loss target exists.
        has_pick = (pslots == picks[:, None]).any(axis=1)
        if not has_pick.all():
            fix = np.flatnonzero(~has_pick)
            free = (pslots[fix] == PAD).argmax(axis=1)
            pslots[fix, free] = picks[fix]
            pack_slots[offset:offset + n] = pslots
        pick_pos[offset:offset + n] = (pslots == picks[:, None]).argmax(axis=1)

        ctx = np.empty((n, 5), dtype=np.uint8)
        ctx[:, 0] = chunk["pack_number"].to_numpy().astype(np.uint8)
        ctx[:, 1] = chunk["pick_number"].to_numpy().astype(np.uint8)
        ctx[:, 2] = wr_bucket_id(chunk["user_game_win_rate_bucket"].to_numpy(dtype=float))
        ctx[:, 3] = games_bucket_id(chunk["user_n_games_bucket"].to_numpy())
        ctx[:, 4] = format_id
        context[offset:offset + n] = ctx

        ids = chunk["draft_id"].to_numpy()
        split[offset:offset + n] = [
            crc_cache.setdefault(d, zlib.crc32(d.encode()) % 1000) for d in ids
        ]
        offset += n
    con.close()
    if offset != total:
        raise RuntimeError(f"row mismatch: wrote {offset}, expected {total}")

    for arr in (pool_slots, pool_counts, pack_slots, pick_pos, context, split):
        arr.flush()
    meta = {
        "set": set_code, "format": limited_type, "rows": int(total),
        "vocab_size": len(vocab), "source_etag": curated_meta.get("source_etag"),
        "picks_per_pack": curated_meta.get("picks_per_pack"),
        "p1p1_missing": curated_meta.get("p1p1_missing"),
        "val_permille": VAL_PERMILLE,
    }
    meta_file.write_text(json.dumps(meta, indent=2))
    return {"status": "BUILT", "path": str(out), "rows": int(total)}


class Shard:
    """Read view over one shard: memmapped arrays + its feature table."""

    def __init__(self, set_code, limited_type, features):
        d = shard_dir(set_code, limited_type)
        self.set_code = set_code
        self.limited_type = limited_type
        self.meta = json.loads((d / "meta.json").read_text())
        self.pool_slots = np.load(d / "pool_slots.npy", mmap_mode="r")
        self.pool_counts = np.load(d / "pool_counts.npy", mmap_mode="r")
        self.pack_slots = np.load(d / "pack_slots.npy", mmap_mode="r")
        self.pick_pos = np.load(d / "pick_pos.npy", mmap_mode="r")
        self.context = np.load(d / "context.npy", mmap_mode="r")
        self.split = np.load(d / "split.npy", mmap_mode="r")
        self.features = features  # float16 [vocab_size, feat_dim]
        if features.shape[0] != self.meta["vocab_size"]:
            raise ValueError(
                f"{set_code}.{limited_type}: features rows {features.shape[0]} != "
                f"vocab {self.meta['vocab_size']}"
            )
        self.train_idx = np.flatnonzero(self.split >= VAL_PERMILLE)
        self.val_idx = np.flatnonzero(self.split < VAL_PERMILLE)

    def gather(self, rows):
        """Batch dict of numpy arrays for the given row indices."""
        return {
            "pool_slots": self.pool_slots[rows],
            "pool_counts": self.pool_counts[rows],
            "pack_slots": self.pack_slots[rows],
            "pick_pos": self.pick_pos[rows],
            "context": self.context[rows],
        }

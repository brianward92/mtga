"""DraftNet-style pick model: pool-count vector in, per-card EV scores out.

Architecture (after Statistical Drafting's DraftNet): the input is only the
POOL (what you've drafted); the network outputs a score for every card in the
set, and training masks the loss to the cards actually present in the pack.
Pool-only input keeps the output interpretable — "EV of every card given my
pool" — and handles P1P1 natively (empty pool = format tier list).

Training data: 17Lands draft_data picks, filtered to high-volume winning
players. Split by draft_id (crc32 buckets) so no draft leaks across
train/val. Eval reports top-1/top-3 agreement against held-out picks, both
for all users and the top-quartile skill bucket, next to three zero-parameter
baselines (shrunk-GIH-WR argmax, ALSA argmin, random).

torch is train-time only; serving loads the exported ONNX via onnxruntime.
"""

import datetime
import json
import zlib

import duckdb
import numpy as np

from mtga.lands import paths

VAL_PERMILLE = 50  # crc32(draft_id) % 1000 < 50 -> validation
POOL_CAP = 8

DEFAULT_HIDDEN = [512, 512]
DEFAULT_DROPOUT = 0.3
DEFAULT_MIN_WR_BUCKET = 0.55
DEFAULT_MIN_GAMES_BUCKET = 100


def _quote(identifier):
    return '"' + identifier.replace('"', '""') + '"'


def load_vocab(set_code, limited_type):
    with open(paths.vocab_path(set_code, limited_type)) as file:
        return json.load(file)["names"]


def load_pick_arrays(
    set_code,
    limited_type,
    min_wr_bucket=DEFAULT_MIN_WR_BUCKET,
    min_games_bucket=DEFAULT_MIN_GAMES_BUCKET,
):
    """Curated draft parquet -> (pool int8 [n,N], pack int8 [n,N], picks, meta df)."""
    parquet = paths.curated_path("draft", set_code, limited_type)
    vocab = load_vocab(set_code, limited_type)
    where = (
        f"pick_index >= 0 AND user_game_win_rate_bucket >= {min_wr_bucket} "
        f"AND user_n_games_bucket >= {min_games_bucket}"
    )

    con = duckdb.connect()
    con.execute("SET memory_limit='16GB'")

    def matrix(prefix):
        cols = ", ".join(_quote(f"{prefix}{n}") for n in vocab)
        table = con.execute(
            f"SELECT {cols} FROM '{parquet}' WHERE {where}"
        ).fetch_arrow_table()
        return np.column_stack(
            [table.column(i).to_numpy() for i in range(table.num_columns)]
        ).astype(np.int8)

    pool = matrix("pool_")
    pack = matrix("pack_card_")
    meta = con.execute(f"""
        SELECT pick_index, draft_id, pack_number, pick_number,
               user_game_win_rate_bucket, user_n_games_bucket
        FROM '{parquet}' WHERE {where}
        """).df()
    con.close()

    picks = meta["pick_index"].to_numpy().astype(np.int64)
    return pool, pack, picks, meta, vocab


def split_by_draft(draft_ids, val_permille=VAL_PERMILLE):
    """Deterministic train/val membership by crc32 of draft_id."""
    unique = (
        draft_ids.unique() if hasattr(draft_ids, "unique") else np.unique(draft_ids)
    )
    is_val_id = {d: (zlib.crc32(d.encode()) % 1000) < val_permille for d in unique}
    mask = np.fromiter(
        (is_val_id[d] for d in draft_ids), dtype=bool, count=len(draft_ids)
    )
    return ~mask, mask


def build_model(n_cards, hidden=None, dropout=DEFAULT_DROPOUT):
    import torch.nn as nn

    hidden = DEFAULT_HIDDEN if hidden is None else hidden
    layers = []
    previous = n_cards
    for width in hidden:
        layers += [
            nn.Linear(previous, width),
            nn.BatchNorm1d(width),
            nn.ReLU(),
            nn.Dropout(dropout),
        ]
        previous = width
    layers.append(nn.Linear(previous, n_cards))
    return nn.Sequential(*layers)


def masked_logits(logits, pack):
    return logits.masked_fill(pack <= 0, float("-inf"))


def _batches(n, batch_size, rng=None):
    order = np.arange(n) if rng is None else rng.permutation(n)
    for start in range(0, n, batch_size):
        yield order[start : start + batch_size]


def evaluate(model, pool, pack, picks, batch_size=4096):
    """top-1/top-3 agreement and mean log-loss over an index set."""
    import torch

    model.eval()
    top1 = top3 = 0
    loss_sum = 0.0
    with torch.no_grad():
        for idx in _batches(len(picks), batch_size):
            pool_t = torch.from_numpy(
                np.minimum(pool[idx], POOL_CAP).astype(np.float32)
            )
            pack_t = torch.from_numpy(pack[idx].astype(np.float32))
            target = torch.from_numpy(picks[idx])
            logits = masked_logits(model(pool_t), pack_t)
            loss_sum += torch.nn.functional.cross_entropy(
                logits, target, reduction="sum"
            ).item()
            ranked = logits.argsort(dim=1, descending=True)
            top1 += (ranked[:, 0] == target).sum().item()
            top3 += (ranked[:, :3] == target[:, None]).any(dim=1).sum().item()
    n = len(picks)
    return {"top1": top1 / n, "top3": top3 / n, "log_loss": loss_sum / n}


def baseline_agreement(pack, picks, card_values, take_min=False):
    """Zero-parameter baseline: argmax (or argmin) of a static per-card value."""
    values = np.where(
        np.isnan(card_values), -np.inf if not take_min else np.inf, card_values
    )
    masked = np.where(pack > 0, values[None, :], -np.inf if not take_min else np.inf)
    choice = masked.argmin(axis=1) if take_min else masked.argmax(axis=1)
    return float((choice == picks).mean())


def train(
    set_code,
    limited_type,
    epochs=20,
    batch_size=1024,
    lr=1e-3,
    hidden=None,
    dropout=DEFAULT_DROPOUT,
    min_wr_bucket=DEFAULT_MIN_WR_BUCKET,
    min_games_bucket=DEFAULT_MIN_GAMES_BUCKET,
    seed=17,
    patience=3,
    progress=print,
):
    """Train and return (model, eval_report, context) — persistence is separate."""
    import torch

    torch.manual_seed(seed)
    rng = np.random.default_rng(seed)

    pool, pack, picks, meta, vocab = load_pick_arrays(
        set_code, limited_type, min_wr_bucket, min_games_bucket
    )
    train_mask, val_mask = split_by_draft(meta["draft_id"])
    progress(
        f"picks: {len(picks):,} after skill filter "
        f"(train {train_mask.sum():,} / val {val_mask.sum():,}), vocab {len(vocab)}"
    )

    tr_idx = np.flatnonzero(train_mask)
    va = {
        "pool": pool[val_mask],
        "pack": pack[val_mask],
        "picks": picks[val_mask],
    }

    model = build_model(len(vocab), hidden, dropout)
    optimizer = torch.optim.Adam(model.parameters(), lr=lr)

    best = {"top1": -1.0}
    best_state = None
    stale = 0
    for epoch in range(1, epochs + 1):
        model.train()
        for idx in _batches(len(tr_idx), batch_size, rng):
            if len(idx) < 2:
                continue  # BatchNorm1d can't train on a 1-row batch
            rows = tr_idx[idx]
            pool_t = torch.from_numpy(
                np.minimum(pool[rows], POOL_CAP).astype(np.float32)
            )
            pack_t = torch.from_numpy(pack[rows].astype(np.float32))
            target = torch.from_numpy(picks[rows])
            optimizer.zero_grad()
            logits = masked_logits(model(pool_t), pack_t)
            loss = torch.nn.functional.cross_entropy(logits, target)
            loss.backward()
            optimizer.step()

        val = evaluate(model, **va)
        progress(
            f"epoch {epoch}: val top1 {val['top1']:.4f} top3 {val['top3']:.4f} "
            f"log_loss {val['log_loss']:.4f}"
        )
        if val["top1"] > best["top1"]:
            best, stale = val, 0
            best_state = {k: v.clone() for k, v in model.state_dict().items()}
        else:
            stale += 1
            if stale >= patience:
                progress(f"early stop after epoch {epoch}")
                break

    model.load_state_dict(best_state)

    # Skill-sliced agreement + baselines on the same validation set.
    val_meta = meta[val_mask]
    buckets = val_meta["user_game_win_rate_bucket"].to_numpy()
    top_threshold = float(np.quantile(buckets, 0.75))
    top_mask = buckets >= top_threshold

    report = {
        "val": best,
        "val_top_quartile": evaluate(
            model, va["pool"][top_mask], va["pack"][top_mask], va["picks"][top_mask]
        ),
        "top_quartile_wr_bucket_threshold": top_threshold,
        "per_pack": {},
        "baselines": {},
        "n_train": int(train_mask.sum()),
        "n_val": int(val_mask.sum()),
    }
    pack_numbers = val_meta["pack_number"].to_numpy()
    for pn in sorted(np.unique(pack_numbers)):
        mask = pack_numbers == pn
        report["per_pack"][int(pn)] = evaluate(
            model, va["pool"][mask], va["pack"][mask], va["picks"][mask]
        )["top1"]

    # Baselines from latest metrics (may be missing early in a set's life).
    try:
        from mtga.lands.metrics import load_latest_metrics

        stats = load_latest_metrics(set_code, limited_type).set_index("name")
        gih = np.array([stats["gih_wr_shrunk"].get(n, np.nan) for n in vocab])
        alsa = np.array([stats["alsa"].get(n, np.nan) for n in vocab])
        report["baselines"]["gih_wr_shrunk_argmax"] = baseline_agreement(
            va["pack"], va["picks"], gih
        )
        report["baselines"]["alsa_argmin"] = baseline_agreement(
            va["pack"], va["picks"], alsa, take_min=True
        )
    except Exception as e:  # noqa: BLE001
        report["baselines"]["error"] = str(e)
    report["baselines"]["random"] = float(
        (1.0 / np.maximum((va["pack"] > 0).sum(axis=1), 1)).mean()
    )

    context = {
        "set": set_code,
        "format": limited_type,
        "vocab": vocab,
        "hidden": hidden or DEFAULT_HIDDEN,
        "dropout": dropout,
        "filters": {
            "min_wr_bucket": min_wr_bucket,
            "min_games_bucket": min_games_bucket,
        },
        "seed": seed,
        "epochs_ran": epoch,
        "batch_size": batch_size,
        "lr": lr,
    }
    return model, report, context


def save_version(model, report, context, tag=None):
    """Persist model.onnx + meta.json + metrics.json under the registry layout."""
    import torch

    set_code, limited_type = context["set"], context["format"]
    tag = tag or f"v{datetime.date.today().strftime('%Y%m%d')}"
    out_dir = paths.model_dir(set_code, limited_type, tag)
    out_dir.mkdir(parents=True, exist_ok=True)
    vocab = context["vocab"]

    model.eval()
    dummy = torch.zeros(1, len(vocab), dtype=torch.float32)
    torch.onnx.export(
        model,
        dummy,
        str(out_dir / "model.onnx"),
        input_names=["pool"],
        output_names=["scores"],
        dynamic_axes={"pool": {0: "batch"}, "scores": {0: "batch"}},
        opset_version=17,
    )
    torch.save(model.state_dict(), out_dir / "checkpoint.pt")

    # grpId per vocab slot via the card store: canonical id for display plus
    # every alias (alt arts, bonus-sheet printings) so any pack grpId resolves.
    from mtga.lands import cardstore

    canonical, aliases, _ = cardstore.name_resolution(set_code)
    vocab_entries = [
        {
            "index": i,
            "name": n,
            "grp_id": canonical.get(n),
            "grp_ids": aliases.get(n, []),
        }
        for i, n in enumerate(vocab)
    ]

    curated_meta = paths.meta_path(paths.curated_path("draft", set_code, limited_type))
    data_etag = None
    if curated_meta.exists():
        with open(curated_meta) as file:
            data_etag = json.load(file).get("source_etag")

    meta = {
        "model_id": f"{set_code}/{limited_type}/{tag}",
        "kind": "draftnet-mlp",
        "arch": {
            "hidden": context["hidden"],
            "dropout": context["dropout"],
            "pool_cap": POOL_CAP,
        },
        "filters": context["filters"],
        "train": {k: context[k] for k in ["seed", "epochs_ran", "batch_size", "lr"]},
        "data_etag": data_etag,
        "trained_at": datetime.datetime.now().isoformat(timespec="seconds"),
        "torch_version": torch.__version__,
        "vocab": vocab_entries,
    }
    with open(out_dir / "meta.json", "w") as file:
        json.dump(meta, file, indent=2)
    with open(out_dir / "metrics.json", "w") as file:
        json.dump(report, file, indent=2)
    return out_dir


def promote(out_dir, tolerance=0.005, force=False):
    """Repoint <set>/<format>/latest at out_dir if it beats the incumbent."""
    with open(out_dir / "metrics.json") as file:
        candidate = json.load(file)["val_top_quartile"]["top1"]

    latest = out_dir.parent / "latest"
    incumbent = None
    if latest.exists() and (latest / "metrics.json").exists():
        with open(latest / "metrics.json") as file:
            incumbent = json.load(file)["val_top_quartile"]["top1"]

    if not force and incumbent is not None and candidate < incumbent - tolerance:
        print(
            f"NOT promoted: candidate top-quartile top1 {candidate:.4f} < "
            f"incumbent {incumbent:.4f} - {tolerance}"
        )
        return False

    tmp = latest.parent / ".latest.tmp"
    if tmp.is_symlink() or tmp.exists():
        tmp.unlink()
    tmp.symlink_to(out_dir.name)
    tmp.replace(latest)
    print(
        f"promoted {out_dir.name} -> latest "
        f"(top-quartile top1 {candidate:.4f}, incumbent {incumbent})"
    )
    return True

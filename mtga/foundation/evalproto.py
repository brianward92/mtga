"""FROZEN evaluation protocol implementation (tag: eval-protocol-v1).

Every number in the DraftFM paper is computed by this module from cached
per-pick predictions — models are never re-run during analysis. Once the
protocol tag is cut, changes here invalidate the frozen eval
(scripts/run_frozen_eval.py verifies this file's hash against the tag).

## The predictions-parquet contract

One row per evaluated pick:
    draft_id        str    clustering unit for all bootstrap statistics
    pack_number     int    0-indexed
    pick_number     int    0-indexed
    pack_size       int    number of real candidates in the pack
    wr_bucket       float  user_game_win_rate_bucket (NaN if unknown)
    n_games_bucket  int    user_n_games_bucket (0 if unknown)
    target_rank     int    1-indexed rank of the human's pick under the model
    pick_prob       float  model probability assigned to the human's pick
    top_prob        float  model probability of its own argmax candidate

`target_rank == 1` defines top-1 agreement. Forced picks (pack_size == 1)
are INCLUDED in headline numbers (consistent with the per-set 70.2% anchor
and all prior work); non-forced variants are secondary rows.
"""

import numpy as np
import pandas as pd

EXPERT_WR_BUCKET = 0.55
EXPERT_GAMES_BUCKET = 100
BOOTSTRAP_B = 2000
BOOTSTRAP_SEED = 20260707
ECE_BINS = 15

REQUIRED_COLUMNS = [
    "draft_id", "pack_number", "pick_number", "pack_size", "wr_bucket",
    "n_games_bucket", "target_rank", "pick_prob", "top_prob",
]


def validate(frame):
    missing = [c for c in REQUIRED_COLUMNS if c not in frame.columns]
    if missing:
        raise ValueError(f"predictions frame missing columns: {missing}")
    return frame


def expert_slice(frame):
    """The headline population: high-volume winning players (matches the
    per-set model's training/eval filter, so ceiling comparisons are
    apples-to-apples)."""
    return frame[
        (frame["wr_bucket"] >= EXPERT_WR_BUCKET)
        & (frame["n_games_bucket"] >= EXPERT_GAMES_BUCKET)
    ]


def non_forced(frame):
    return frame[frame["pack_size"] >= 2]


# -- point statistics --------------------------------------------------------

def top1(frame):
    return float((frame["target_rank"] == 1).mean())


def topk(frame, k=3):
    return float((frame["target_rank"] <= k).mean())


def log_loss(frame):
    """Mean negative log probability of the human pick (nats/pick)."""
    probs = frame["pick_prob"].to_numpy(dtype=np.float64)
    return float(-np.mean(np.log(np.clip(probs, 1e-12, 1.0))))


def ece(frame, bins=ECE_BINS):
    """Top-label expected calibration error, equal-mass bins.

    Confidence = model probability of its own argmax; accuracy = whether the
    argmax matched the human pick (target_rank == 1).
    """
    confidence = frame["top_prob"].to_numpy(dtype=np.float64)
    correct = (frame["target_rank"] == 1).to_numpy(dtype=np.float64)
    if len(frame) == 0:
        return float("nan")
    order = np.argsort(confidence, kind="stable")
    confidence, correct = confidence[order], correct[order]
    edges = np.linspace(0, len(frame), bins + 1).astype(int)
    total = 0.0
    for lo, hi in zip(edges[:-1], edges[1:]):
        if hi <= lo:
            continue
        total += (hi - lo) * abs(correct[lo:hi].mean() - confidence[lo:hi].mean())
    return float(total / len(frame))


# -- cluster bootstrap (drafts, not picks, are the sampling unit) -----------

def _draft_groups(frame):
    """Row indices grouped by draft_id, in first-appearance order."""
    codes, _ = pd.factorize(frame["draft_id"], sort=False)
    order = np.argsort(codes, kind="stable")
    sorted_codes = codes[order]
    boundaries = np.flatnonzero(np.diff(sorted_codes)) + 1
    return np.split(order, boundaries)


def cluster_bootstrap(frame, stat_fn, b=BOOTSTRAP_B, seed=BOOTSTRAP_SEED):
    """Percentile 95% CI of stat_fn(frame) under resampling of whole drafts.

    Returns (point, lo, hi). Deterministic under (frame order, seed).
    """
    groups = _draft_groups(frame)
    rng = np.random.default_rng(seed)
    n = len(groups)
    point = stat_fn(frame)
    stats = np.empty(b)
    for i in range(b):
        chosen = rng.integers(0, n, size=n)
        rows = np.concatenate([groups[j] for j in chosen])
        stats[i] = stat_fn(frame.iloc[rows])
    lo, hi = np.percentile(stats, [2.5, 97.5])
    return point, float(lo), float(hi)


def paired_bootstrap_diff(frame_a, frame_b, stat_fn, b=BOOTSTRAP_B,
                          seed=BOOTSTRAP_SEED):
    """CI on stat_fn(A) - stat_fn(B) with SHARED draft resamples.

    Frames must cover the same drafts (typically the same picks scored by two
    models). Pairing collapses between-draft variance out of the difference.
    """
    drafts_a = set(frame_a["draft_id"])
    drafts_b = set(frame_b["draft_id"])
    common = drafts_a & drafts_b
    if not common:
        raise ValueError("no shared drafts between frames")
    frame_a = frame_a[frame_a["draft_id"].isin(common)]
    frame_b = frame_b[frame_b["draft_id"].isin(common)]

    groups_a = _draft_groups(frame_a)
    groups_b = _draft_groups(frame_b)
    # Align group order by draft id so resample index j means the same draft.
    ids_a = frame_a["draft_id"].iloc[[g[0] for g in groups_a]].tolist()
    ids_b = frame_b["draft_id"].iloc[[g[0] for g in groups_b]].tolist()
    index_b = {d: i for i, d in enumerate(ids_b)}
    groups_b = [groups_b[index_b[d]] for d in ids_a]

    rng = np.random.default_rng(seed)
    n = len(groups_a)
    point = stat_fn(frame_a) - stat_fn(frame_b)
    stats = np.empty(b)
    for i in range(b):
        chosen = rng.integers(0, n, size=n)
        rows_a = np.concatenate([groups_a[j] for j in chosen])
        rows_b = np.concatenate([groups_b[j] for j in chosen])
        stats[i] = stat_fn(frame_a.iloc[rows_a]) - stat_fn(frame_b.iloc[rows_b])
    lo, hi = np.percentile(stats, [2.5, 97.5])
    return point, float(lo), float(hi)


def intraclass_correlation(frame):
    """One-way ANOVA ICC of per-pick correctness over drafts.

    Grounds the design-effect arithmetic in the protocol doc.
    """
    correct = (frame["target_rank"] == 1).astype(np.float64)
    grouped = correct.groupby(frame["draft_id"])
    k = grouped.size().to_numpy(dtype=np.float64)
    means = grouped.mean().to_numpy(dtype=np.float64)
    grand = correct.mean()
    n_groups = len(k)
    n_total = k.sum()
    ss_between = float((k * (means - grand) ** 2).sum())
    ss_total = float(((correct - grand) ** 2).sum())
    ss_within = ss_total - ss_between
    ms_between = ss_between / max(n_groups - 1, 1)
    ms_within = ss_within / max(n_total - n_groups, 1)
    k_bar = (n_total - (k ** 2).sum() / n_total) / max(n_groups - 1, 1)
    icc = (ms_between - ms_within) / (ms_between + (k_bar - 1) * ms_within)
    return float(max(icc, 0.0))


# -- structured analyses -----------------------------------------------------

def per_pick_curve(frame):
    """Top-1 and the random floor per (pack_number, pick_number) cell."""
    grouped = frame.groupby(["pack_number", "pick_number"])
    curve = grouped.apply(
        lambda g: pd.Series({
            "top1": (g["target_rank"] == 1).mean(),
            "random_floor": (1.0 / g["pack_size"]).mean(),
            "n": len(g),
        }),
        include_groups=False,
    )
    return curve.reset_index()


def late_draft_retention(frame, ceiling_frame, first_late_pick=7):
    """(model top-1 / ceiling top-1) restricted to late picks (0-indexed
    pick_number >= first_late_pick). Pool-context handling shows up here."""
    late = frame[frame["pick_number"] >= first_late_pick]
    late_ceiling = ceiling_frame[ceiling_frame["pick_number"] >= first_late_pick]
    denominator = top1(late_ceiling)
    return float(top1(late) / denominator) if denominator else float("nan")


def align_on_picks(frame_a, frame_b):
    """Inner-join two prediction frames on (draft_id, pack, pick) so both
    models are scored on identical picks (used for normalized scores)."""
    keys = ["draft_id", "pack_number", "pick_number"]
    merged = frame_a.merge(frame_b[keys], on=keys, how="inner")
    merged_b = frame_b.merge(frame_a[keys], on=keys, how="inner")
    return merged, merged_b


def summarize(frame, label=""):
    """The standard reporting block.

    top-1/top-3/log-loss carry cluster-bootstrap CIs. ECE and the non-forced
    variants are point estimates only: the binned ECE is not bootstrapped
    (out of protocol scope), and the ``pack_size >= 2`` rows are secondary
    diagnostics. Non-forced ECE and log-loss matter because forced picks
    (``pack_size == 1``) are scored trivially -- the model's argmax is the
    lone candidate -- which deflates both calibration numbers.
    """
    result = {"label": label, "n_picks": len(frame),
              "n_drafts": frame["draft_id"].nunique()}
    for name, fn in [("top1", top1), ("top3", lambda f: topk(f, 3)),
                     ("log_loss", log_loss)]:
        point, lo, hi = cluster_bootstrap(frame, fn)
        result[name] = point
        result[f"{name}_ci"] = [lo, hi]
    result["ece"] = ece(frame)
    nf = non_forced(frame)
    has_nf = len(nf) > 0
    result["top1_non_forced"] = top1(nf) if has_nf else float("nan")
    result["log_loss_non_forced"] = log_loss(nf) if has_nf else float("nan")
    result["ece_non_forced"] = ece(nf) if has_nf else float("nan")
    return result

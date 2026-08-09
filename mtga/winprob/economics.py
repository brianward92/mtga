"""Card-value economics from the win-probability MLP.

The headline deliverable: read the MLP's local sensitivities as an exchange
rate between resources. For a state S,

    dP/d(card in hand)   -- change in P(win) from one more card in hand
    dP/d(life)           -- change in P(win) from one more life
    life-equiv of a card = (dP/dcard) / (dP/dlife)

is "how many life points buy the same win-probability as one card, right
here." Same treatment for a creature on board.

Gradients are CENTRAL DIFFERENCES taken in raw units and evaluated through
the frozen scaler (so a step of 1 = one card / one life / one creature).
Perturbing a "user quantity" also moves its paired *_diff feature, because
adding a card to your hand raises both user_hand_count and hand_diff — the
perturbation stays on the same feature manifold the model was fit on.

## FRAME HONESTLY — these are associational, not causal

The MLP is fit on human replays, so its gradients trace the DATA MANIFOLD,
not interventions. A card in hand correlates with being ahead (you drew well,
you're not hellbent, you have answers), so dP/dcard mixes the mechanical value
of the card with everything that co-varies with holding it. Reading the
number as "if a genie handed you a card, P(win) would rise by this" is a
causal claim this model cannot support. Likewise a life total co-varies with
board dominance; dP/dlife is steeper when low life also signals "losing the
race," not purely the marginal life point.

v2 causal-adjustment ideas (noted, not implemented):
  * condition on richer board/tempo state so the perturbed feature is closer
    to ceteris-paribus (backdoor-style adjustment; cf. the "Embarrassingly
    Causal" 17Lands framework);
  * instrument card-draw with exogenous draw effects vs. selection;
  * counterfactual replay: re-simulate from S with one card added.
The numbers below are useful as a descriptive exchange rate along observed
play, and are labeled as such everywhere.
"""

import json

import numpy as np

from mtga.winprob import data as wdata
from mtga.winprob.model import predict_proba

# Perturbing a user resource moves the raw count and its paired diff by +1.
PERTURB_GROUPS = {
    "card": ["user_hand_count", "hand_diff"],
    "life": ["user_life", "life_diff"],
    "creature": ["user_creatures_count", "creatures_diff"],
}

REF_TURNS = (5, 8, 11)
REF_LIVES = (20, 15, 10, 5)
LIFE_CURVE_LEVELS = (20, 18, 16, 14, 12, 10, 8, 6, 4, 2)
PARITY_TURNS = tuple(range(1, 16))
LIFE_WINDOW = 1.0  # +/- life tolerance when selecting reference states
SAMPLE_CAP = 50_000  # representative-state cap for pooled means
EPS_LIFE = 1e-4  # dP/dlife floor for the exchange-rate ratio


def _all_columns():
    return np.arange(len(wdata.FEATURES))


def _group_cols(group):
    return [wdata.FEATURES.index(f) for f in PERTURB_GROUPS[group]]


def gradient(model, mean, std, X_raw, group, delta=1.0):
    """Central-difference dP/d(unit) for `group` at each raw state in X_raw.

    Returns float64 [len(X_raw)]. `delta` is in raw units (1 = one card).
    """
    cols = _group_cols(group)
    all_cols = _all_columns()
    plus, minus = X_raw.astype(np.float32).copy(), X_raw.astype(np.float32).copy()
    for c in cols:
        plus[:, c] += delta
        minus[:, c] -= delta
    p_plus = predict_proba(model, wdata.standardize(plus, mean, std), all_cols)
    p_minus = predict_proba(model, wdata.standardize(minus, mean, std), all_cols)
    return (p_plus - p_minus) / (2.0 * delta)


def base_proba(model, mean, std, X_raw):
    return predict_proba(
        model, wdata.standardize(X_raw.astype(np.float32), mean, std), _all_columns()
    )


def _exchange(grad_card, grad_life):
    """Ratio of mean gradients = life-equivalent of one card (None if flat)."""
    gl = float(np.mean(grad_life))
    gc = float(np.mean(grad_card))
    if gl <= EPS_LIFE:
        return None, gc, gl
    return gc / gl, gc, gl


def _cell(model, mean, std, X_rows):
    """Mean gradients + exchange rates over a set of raw states."""
    if len(X_rows) == 0:
        return None
    grads = {g: gradient(model, mean, std, X_rows, g) for g in PERTURB_GROUPS}
    card_equiv, gc, gl = _exchange(grads["card"], grads["life"])
    creat_equiv, gcr, _ = _exchange(grads["creature"], grads["life"])
    return {
        "n": int(len(X_rows)),
        "mean_p": round(float(base_proba(model, mean, std, X_rows).mean()), 4),
        "dP_dcard": round(gc, 5),
        "dP_dlife": round(gl, 5),
        "dP_dcreature": round(gcr, 5),
        "life_per_card": None if card_equiv is None else round(card_equiv, 3),
        "life_per_creature": None if creat_equiv is None else round(creat_equiv, 3),
    }


def _select(X, turn, mask, want_turn, life_col, want_life=None, window=LIFE_WINDOW):
    sel = mask & (turn == want_turn)
    if want_life is not None:
        sel = sel & (np.abs(X[:, life_col] - want_life) <= window)
    return np.flatnonzero(sel)


def compute_by_set(model, mean, std, data, val_idx, set_codes, seed=17):
    """Per-set compute() breakdown: is the card/life exchange rate stable
    across sets, or a single-set artifact?

    `data.game_set[data.game_pos]` (populated by mtga.winprob.data.load_many)
    tags each row with its source set; this just restricts val_idx to one
    set at a time and reuses compute() unchanged, so every curve (life_curve,
    parity_curve, exchange_rate_table) is directly comparable set-to-set.
    Sets with zero rows in val_idx (e.g. a holdout set not part of this
    data object) are skipped -- call compute() directly for those instead.
    """
    row_set = data.game_set[data.game_pos]
    out = {}
    for set_code in set_codes:
        sel = val_idx[row_set[val_idx] == set_code]
        if len(sel) == 0:
            continue
        out[set_code] = compute(model, mean, std, data, sel, seed=seed)
    return out


def compute(model, mean, std, data, val_idx, seed=17):
    """All economics artifacts from the trained MLP over held-out states."""
    rng = np.random.default_rng(seed)
    X = data.X[val_idx]
    turn = data.turn[val_idx]
    life_col = wdata.FEATURES.index("user_life")
    diff_col = wdata.FEATURES.index("life_diff")

    # Pooled "typical" gradient over a representative val sample.
    if len(X) > SAMPLE_CAP:
        sample = np.sort(rng.choice(len(X), size=SAMPLE_CAP, replace=False))
    else:
        sample = np.arange(len(X))
    pooled = _cell(model, mean, std, X[sample])

    # Headline: the single median val state (per-feature median).
    median_state = np.median(X, axis=0, keepdims=True).astype(np.float32)
    headline = _cell(model, mean, std, median_state)

    # Curve (a): gradients vs life level at fixed turn 7.
    at7 = turn == 7
    life_curve = []
    for level in LIFE_CURVE_LEVELS:
        rows = np.flatnonzero(at7 & (np.abs(X[:, life_col] - level) <= LIFE_WINDOW))
        cell = _cell(model, mean, std, X[rows])
        if cell:
            life_curve.append({"user_life": level, **cell})

    # Curve (b): gradients vs turn at life parity (life_diff == 0).
    parity = X[:, diff_col] == 0
    parity_curve = []
    for t in PARITY_TURNS:
        rows = np.flatnonzero(parity & (turn == t))
        cell = _cell(model, mean, std, X[rows])
        if cell:
            parity_curve.append({"turn": t, **cell})

    # Exchange-rate table: reference (turn, life) states.
    table = []
    for t in REF_TURNS:
        for life in REF_LIVES:
            rows = _select(X, turn, np.ones(len(X), bool), t, life_col, life)
            cell = _cell(model, mean, std, X[rows])
            table.append(
                {
                    "turn": t,
                    "user_life": life,
                    **(
                        cell
                        or {
                            "n": 0,
                            "life_per_card": None,
                            "life_per_creature": None,
                            "dP_dcard": None,
                            "dP_dlife": None,
                            "dP_dcreature": None,
                            "mean_p": None,
                        }
                    ),
                }
            )

    return {
        "kind": "winprob-economics-v1",
        "framing": "associational gradients along the data manifold; NOT "
        "causal interventions (see economics.py docstring)",
        "delta_units": {
            "card": "1 card in hand",
            "life": "1 life",
            "creature": "1 creature on board",
        },
        "headline": headline,
        "pooled_typical": pooled,
        "life_curve_at_t7": life_curve,
        "parity_curve": parity_curve,
        "exchange_rate_table": table,
    }


# ---------------------------------------------------------------------------
# Rendering.


def render_table(econ):
    """Compact text exchange-rate table (life per card) for stdout/report."""
    lines = []
    head = econ["headline"] or {}
    lines.append("Card value in LIFE-EQUIVALENTS  (dP/dcard / dP/dlife)")
    lines.append("associational gradients along the data manifold, not causal")
    lp = head.get("life_per_card")
    lines.append(
        f"headline (median state): 1 card = "
        f"{'n/a' if lp is None else f'{lp:.2f}'} life  "
        f"[dP/dcard={head.get('dP_dcard')}, dP/dlife={head.get('dP_dlife')}]"
    )
    lines.append("")
    header = f"{'turn':>5} | " + " ".join(f"life{L:>2}" for L in REF_LIVES)
    lines.append(header)
    lines.append("-" * len(header))
    by_turn = {}
    for cell in econ["exchange_rate_table"]:
        by_turn.setdefault(cell["turn"], {})[cell["user_life"]] = cell
    for t in REF_TURNS:
        cells = by_turn.get(t, {})
        values = []
        for L in REF_LIVES:
            v = cells.get(L, {}).get("life_per_card")
            values.append(" n/a  " if v is None else f"{v:5.2f} ")
        lines.append(f"{t:>5} | " + " ".join(values))
    return "\n".join(lines)


def render_by_set_table(by_set):
    """Per-set headline life-per-card comparison — the cross-set stability
    check: a stable number across `by_set` says the card/life exchange rate
    is not a single-set artifact (see compute_by_set)."""
    header = f"{'set':>6} | {'n':>10} | {'life/card':>10} | {'life/creature':>14}"
    lines = [
        "Card value in LIFE-EQUIVALENTS by source set (headline/median state)",
        header,
        "-" * len(header),
    ]
    for set_code in sorted(by_set):
        head = (by_set[set_code] or {}).get("headline") or {}
        lpc = head.get("life_per_card")
        lpcr = head.get("life_per_creature")
        lines.append(
            f"{set_code:>6} | {head.get('n', 0):>10,} | "
            f"{'n/a' if lpc is None else f'{lpc:9.3f}'} | "
            f"{'n/a' if lpcr is None else f'{lpcr:13.3f}'}"
        )
    return "\n".join(lines)


# Validated dataviz categorical slots (light surface): blue / aqua / yellow.
_BLUE, _AQUA, _YELLOW = "#2a78d6", "#1baf7a", "#eda100"
_INK, _MUTED, _GRID = "#0b0b0b", "#52514e", "#e1e0d9"


def render_figure(econ, out_path):
    """Two-panel matplotlib (Agg) figure summarizing the economics."""
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(11, 4.2))
    fig.patch.set_facecolor("#fcfcfb")

    # Panel A: dP/dlife and dP/dcard vs life at turn 7.
    lc = econ["life_curve_at_t7"]
    if lc:
        lives = [c["user_life"] for c in lc]
        ax1.plot(
            lives,
            [c["dP_dlife"] for c in lc],
            "-o",
            color=_BLUE,
            lw=2,
            ms=5,
            label="dP/d(life)",
        )
        ax1.plot(
            lives,
            [c["dP_dcard"] for c in lc],
            "-o",
            color=_AQUA,
            lw=2,
            ms=5,
            label="dP/d(card)",
        )
        ax1.set_xlabel("user life at turn 7", color=_MUTED)
        ax1.set_ylabel("dP(win) per unit", color=_MUTED)
        ax1.set_title("Marginal value vs life level (t=7)", color=_INK)
        ax1.invert_xaxis()
        ax1.legend(frameon=False)

    # Panel B: life-per-card exchange rate vs turn at life parity.
    pc = econ["parity_curve"]
    if pc:
        turns = [c["turn"] for c in pc]
        card = [c["life_per_card"] for c in pc]
        creat = [c["life_per_creature"] for c in pc]
        ax2.plot(turns, card, "-o", color=_YELLOW, lw=2, ms=5, label="life / card")
        ax2.plot(turns, creat, "-o", color=_BLUE, lw=2, ms=5, label="life / creature")
        ax2.set_xlabel("turn (life parity)", color=_MUTED)
        ax2.set_ylabel("life-equivalents", color=_INK)
        ax2.set_title("Exchange rate over the game", color=_INK)
        ax2.legend(frameon=False)

    for ax in (ax1, ax2):
        ax.set_facecolor("#fcfcfb")
        ax.grid(True, color=_GRID, lw=0.6)
        for spine in ("top", "right"):
            ax.spines[spine].set_visible(False)
        ax.tick_params(colors=_MUTED)

    fig.suptitle(
        "Card-value economics (associational, not causal)",
        color=_INK,
        fontsize=12,
        y=1.02,
    )
    fig.tight_layout()
    fig.savefig(out_path, dpi=130, bbox_inches="tight", facecolor=fig.get_facecolor())
    plt.close(fig)
    return out_path


def save(econ, out_dir):
    """Write economics.json + economics.png into out_dir."""
    out_dir.mkdir(parents=True, exist_ok=True)
    json_path = out_dir / "economics.json"
    with open(json_path, "w") as fh:
        json.dump(econ, fh, indent=2)
    fig_path = render_figure(econ, out_dir / "economics.png")
    return json_path, fig_path

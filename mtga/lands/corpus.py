"""DraftFM training-corpus registry: the 31 public 17Lands draft sets.

Single source of truth for the training corpus and per-set quirks,
deliberately separate from config.TRACKED_SETS (serving) so training-corpus
changes never affect the nightly cron. Dict order is release order — this
ordering IS the scaling-curve ordering for the 1..31-set experiments.

Ground truth (verified 2026-07-04 against the 17Lands S3 bucket, CSV headers,
and Scryfall): draft data starts at STX (KHM has game data only); AFR/MID/VOW
have no TradDraft file; STX..VOW `.csv.gz` files are gzipped ustar tarballs
(see mtga/lands/decode.py); three schema eras exist (see the field docs and
mtga/lands/etl.py's era normalization).
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class SetSpec:
    code: str
    formats: tuple  # which draft files exist on S3
    schema_era: str  # "match_buckets" | "match_buckets_rank" | "modern"
    tar_in_gzip: bool = False  # gz actually wraps a ustar tarball
    p1p1_missing: bool = False
    picks_per_pack: int = 14  # expected; store builder verifies empirically
    bonus_sheets: tuple = ()  # informational; joins are by name so not load-bearing
    notes: str = ""


CORPUS = {  # release order — this ordering IS the scaling-curve ordering
    "STX": SetSpec(
        "STX",
        ("PremierDraft", "TradDraft"),
        "match_buckets",
        tar_in_gzip=True,
        p1p1_missing=True,
        picks_per_pack=15,
        bonus_sheets=("STA",),
    ),
    "AFR": SetSpec(
        "AFR", ("PremierDraft",), "match_buckets", tar_in_gzip=True, p1p1_missing=True
    ),
    "MID": SetSpec("MID", ("PremierDraft",), "match_buckets_rank", tar_in_gzip=True),
    "VOW": SetSpec(
        "VOW", ("PremierDraft",), "match_buckets_rank", tar_in_gzip=True
    ),  # QuickDraft is opt-in only, see EXTRAS
    "NEO": SetSpec("NEO", ("PremierDraft", "TradDraft"), "modern"),
    "SNC": SetSpec("SNC", ("PremierDraft", "TradDraft"), "modern"),
    "HBG": SetSpec(
        "HBG",
        ("PremierDraft", "TradDraft"),
        "modern",
        notes="Alchemy/digital-only; 5 'A-' names; needs digital Scryfall rows",
    ),
    "DMU": SetSpec(
        "DMU", ("PremierDraft", "TradDraft"), "modern", notes="Sol'kanar case mismatch"
    ),
    "BRO": SetSpec(
        "BRO", ("PremierDraft", "TradDraft"), "modern", bonus_sheets=("BRR",)
    ),
    "ONE": SetSpec("ONE", ("PremierDraft", "TradDraft"), "modern"),
    "SIR": SetSpec(
        "SIR", ("PremierDraft", "TradDraft"), "modern", bonus_sheets=("SIS",)
    ),
    "MOM": SetSpec(
        "MOM", ("PremierDraft", "TradDraft"), "modern", bonus_sheets=("MUL",)
    ),
    "LTR": SetSpec("LTR", ("PremierDraft", "TradDraft"), "modern"),
    "WOE": SetSpec(
        "WOE", ("PremierDraft", "TradDraft"), "modern", bonus_sheets=("WOT",)
    ),
    "LCI": SetSpec("LCI", ("PremierDraft", "TradDraft"), "modern"),
    "KTK": SetSpec(
        "KTK",
        ("PremierDraft", "TradDraft"),
        "modern",
        picks_per_pack=15,
        notes="2014 flashback",
    ),
    "MKM": SetSpec(
        "MKM", ("PremierDraft", "TradDraft"), "modern", bonus_sheets=("SPG", "PLST")
    ),
    "OTJ": SetSpec(
        "OTJ",
        ("PremierDraft", "TradDraft"),
        "modern",
        bonus_sheets=("OTP", "BIG", "SPG"),
    ),
    "MH3": SetSpec(
        "MH3", ("PremierDraft", "TradDraft"), "modern", bonus_sheets=("SPG", "M3C")
    ),
    "BLB": SetSpec(
        "BLB", ("PremierDraft", "TradDraft"), "modern", bonus_sheets=("SPG",)
    ),
    "DSK": SetSpec(
        "DSK", ("PremierDraft", "TradDraft"), "modern", bonus_sheets=("SPG",)
    ),
    "FDN": SetSpec(
        "FDN", ("PremierDraft", "TradDraft"), "modern", bonus_sheets=("SPG",)
    ),
    "PIO": SetSpec(
        "PIO",
        ("PremierDraft", "TradDraft"),
        "modern",
        notes="digital-only masters, 403-card pool",
    ),
    "DFT": SetSpec(
        "DFT", ("PremierDraft", "TradDraft"), "modern", bonus_sheets=("SPG",)
    ),
    "TDM": SetSpec(
        "TDM", ("PremierDraft", "TradDraft"), "modern", bonus_sheets=("SPG",)
    ),
    "FIN": SetSpec(
        "FIN", ("PremierDraft", "TradDraft"), "modern", bonus_sheets=("FCA",)
    ),
    "EOE": SetSpec(
        "EOE", ("PremierDraft", "TradDraft"), "modern", bonus_sheets=("EOS", "SPG")
    ),
    "TLA": SetSpec(
        "TLA",
        ("PremierDraft", "TradDraft"),
        "modern",
        p1p1_missing=True,
        bonus_sheets=("TLE",),
    ),
    "ECL": SetSpec(
        "ECL",
        ("PremierDraft", "TradDraft"),
        "modern",
        p1p1_missing=True,
        bonus_sheets=("SPG",),
    ),
    "TMT": SetSpec(
        "TMT",
        ("PremierDraft", "TradDraft"),
        "modern",
        p1p1_missing=True,
        bonus_sheets=("PZA",),
        notes="'Bespoke B?' ASCII mangle",
    ),
    "SOS": SetSpec(
        "SOS", ("PremierDraft", "TradDraft"), "modern", bonus_sheets=("SOA", "SPG")
    ),
}

EXCLUDED = {  # never downloaded/curated for training
    "OM1": "PickTwo format: 2 picks/row, pool_ cols undercount, 153/232 names not on Scryfall",
    "Cube": "curated 545-card singleton pool, no expansion, P1P1 missing",
}

EVAL_ONLY = {"MSH"}  # hard gate: never trained on, never expanded by --corpus

# Opt-in-only ablation members (A-extras, protocol §4.1): never expanded by
# --corpus or corpus_jobs(); must be requested explicitly via --extras /
# extras_jobs(), so they can never silently leak into the default corpus.
EXTRAS = {
    "VOW.QuickDraft": SetSpec(
        "VOW",
        ("QuickDraft",),
        "match_buckets_rank",
        tar_in_gzip=True,
        notes="human picks in bot pods; off-distribution wheel dynamics vs "
        "PremierDraft. A-extras candidate only, never in TRAINING_SETS.",
    ),
}

TRAINING_SETS = list(CORPUS)  # 31 sets, 59 (set, format) shards


def formats_for(code):
    """S3 draft formats for a corpus set (AFR/MID/VOW have no TradDraft)."""
    return list(CORPUS[code].formats)


def corpus_jobs(requested=None):
    """(set_code, format) pairs for the training corpus, draft data only.

    `requested` optionally narrows to a subset of TRAINING_SETS. EVAL_ONLY
    sets and anything outside the registry are refused with a ValueError so
    the --corpus scripts can never touch the held-out set by accident.
    """
    codes = (
        TRAINING_SETS if requested is None else [c.strip().upper() for c in requested]
    )
    excluded = {code.upper(): reason for code, reason in EXCLUDED.items()}
    pairs = []
    for code in codes:
        if code in EVAL_ONLY:
            raise ValueError(
                f"{code} is EVAL_ONLY (held out from all training); --corpus "
                f"refuses it. Sync it deliberately without --corpus."
            )
        if code not in CORPUS:
            reason = excluded.get(code, "not in the training-corpus registry")
            raise ValueError(f"{code} is not a training set ({reason})")
        pairs.extend((code, fmt) for fmt in CORPUS[code].formats)
    return pairs


def extras_jobs(requested=None):
    """(set_code, format) pairs for opt-in ablation extras (protocol §4.1).

    Never reachable through corpus_jobs/--corpus. `requested` narrows to a
    subset of EXTRAS keys (default: all of them); unknown keys refuse loudly.
    """
    keys = list(EXTRAS) if requested is None else [k.strip() for k in requested]
    pairs = []
    for key in keys:
        if key not in EXTRAS:
            raise ValueError(
                f"{key} is not a registered extra (know: {sorted(EXTRAS)})"
            )
        spec = EXTRAS[key]
        pairs.extend((spec.code, fmt) for fmt in spec.formats)
    return pairs

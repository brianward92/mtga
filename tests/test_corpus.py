"""mtga/lands/corpus.py: DraftFM training-corpus registry sanity."""

import pytest

from mtga.lands import corpus

RELEASE_ORDER = [
    "STX",
    "AFR",
    "MID",
    "VOW",
    "NEO",
    "SNC",
    "HBG",
    "DMU",
    "BRO",
    "ONE",
    "SIR",
    "MOM",
    "LTR",
    "WOE",
    "LCI",
    "KTK",
    "MKM",
    "OTJ",
    "MH3",
    "BLB",
    "DSK",
    "FDN",
    "PIO",
    "DFT",
    "TDM",
    "FIN",
    "EOE",
    "TLA",
    "ECL",
    "TMT",
    "SOS",
]


def test_registry_is_31_sets_in_release_order():
    assert list(corpus.CORPUS) == RELEASE_ORDER
    assert len(corpus.CORPUS) == 31
    assert corpus.TRAINING_SETS == RELEASE_ORDER  # scaling-curve ordering


def test_specs_are_self_consistent():
    for code, spec in corpus.CORPUS.items():
        assert spec.code == code
        assert "PremierDraft" in spec.formats
        assert set(spec.formats) <= {"PremierDraft", "TradDraft"}
        assert spec.schema_era in {"match_buckets", "match_buckets_rank", "modern"}


def test_premier_only_sets():
    premier_only = {
        c for c, s in corpus.CORPUS.items() if s.formats == ("PremierDraft",)
    }
    assert premier_only == {"AFR", "MID", "VOW"}  # no TradDraft file on S3


def test_tar_in_gzip_and_schema_eras():
    tar_sets = {c for c, s in corpus.CORPUS.items() if s.tar_in_gzip}
    assert tar_sets == {"STX", "AFR", "MID", "VOW"}
    assert {c for c, s in corpus.CORPUS.items() if s.schema_era == "match_buckets"} == {
        "STX",
        "AFR",
    }
    assert {
        c for c, s in corpus.CORPUS.items() if s.schema_era == "match_buckets_rank"
    } == {"MID", "VOW"}
    # Everything else is modern (NEO onward).
    assert all(corpus.CORPUS[c].schema_era == "modern" for c in RELEASE_ORDER[4:])


def test_p1p1_missing_sets():
    missing = {c for c, s in corpus.CORPUS.items() if s.p1p1_missing}
    assert missing == {"STX", "AFR", "TLA", "ECL", "TMT"}


def test_picks_per_pack():
    fifteens = {c for c, s in corpus.CORPUS.items() if s.picks_per_pack == 15}
    assert fifteens == {"STX", "KTK"}
    assert all(
        s.picks_per_pack == 14 for c, s in corpus.CORPUS.items() if c not in fifteens
    )


def test_bonus_sheets_spot_checks():
    assert corpus.CORPUS["STX"].bonus_sheets == ("STA",)
    assert corpus.CORPUS["OTJ"].bonus_sheets == ("OTP", "BIG", "SPG")
    assert corpus.CORPUS["SOS"].bonus_sheets == ("SOA", "SPG")
    assert corpus.CORPUS["NEO"].bonus_sheets == ()


def test_eval_only_and_excluded():
    assert corpus.EVAL_ONLY == {"MSH"}
    assert "MSH" not in corpus.CORPUS
    assert "MSH" not in corpus.TRAINING_SETS
    assert set(corpus.EXCLUDED) == {"OM1", "Cube"}
    assert not set(corpus.EXCLUDED) & set(corpus.CORPUS)


def test_formats_for():
    assert corpus.formats_for("STX") == ["PremierDraft", "TradDraft"]
    assert corpus.formats_for("AFR") == ["PremierDraft"]
    with pytest.raises(KeyError):
        corpus.formats_for("MSH")


def test_corpus_jobs_expands_to_59_shards():
    jobs = corpus.corpus_jobs()
    assert len(jobs) == 59  # 31 Premier + 28 Trad
    assert jobs[0] == ("STX", "PremierDraft")
    assert ("STX", "TradDraft") in jobs
    assert ("AFR", "TradDraft") not in jobs
    assert jobs[-1] == ("SOS", "TradDraft")
    assert not any(s in corpus.EVAL_ONLY for s, _ in jobs)


def test_corpus_jobs_narrows_to_requested_sets():
    assert corpus.corpus_jobs(["afr", "SOS"]) == [
        ("AFR", "PremierDraft"),
        ("SOS", "PremierDraft"),
        ("SOS", "TradDraft"),
    ]


def test_corpus_jobs_refuses_eval_only():
    with pytest.raises(ValueError, match="EVAL_ONLY"):
        corpus.corpus_jobs(["MSH"])


def test_corpus_jobs_refuses_excluded_and_unknown():
    with pytest.raises(ValueError, match="PickTwo"):
        corpus.corpus_jobs(["OM1"])
    with pytest.raises(ValueError, match="not in the training-corpus registry"):
        corpus.corpus_jobs(["KHM"])  # no draft data exists for KHM


def test_extras_never_leak_into_corpus_jobs():
    assert set(corpus.EXTRAS) == {"VOW.QuickDraft"}
    jobs = corpus.corpus_jobs()
    assert ("VOW", "QuickDraft") not in jobs
    assert not any(s in corpus.EXTRAS for s, _ in jobs)


def test_extras_jobs_expands_and_narrows():
    assert corpus.extras_jobs() == [("VOW", "QuickDraft")]
    assert corpus.extras_jobs(["VOW.QuickDraft"]) == [("VOW", "QuickDraft")]


def test_extras_jobs_refuses_unknown():
    with pytest.raises(ValueError, match="not a registered extra"):
        corpus.extras_jobs(["VOW.PremierDraft"])

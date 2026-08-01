#!/usr/bin/env python3
"""Emit paper/tables/*.tex + paper/figures/scaling_data.json from run artifacts.

Machine-readable sources (never hand-typed numbers):
  experiments/ledger.jsonl                      run registry (run_id -> record)
  paper/data/run_manifest.json                  paper role -> exact run_id
  <runs root>/<run_id>/record.json              training config/counters
  <runs root>/<run_id>/zeroshot/summary.json    dev-trio zero-shot eval (eval_draftfm.py)
  <frozen root>/<sha>/summary.json              frozen-eval outputs (run_frozen_eval.py);
                                                rehearsals feed the baselines table, the
                                                real MSH pass feeds the MSH column
  paper/data/anchors.json                       per-set ceilings, published anchors,
                                                design constants, manifest hashes

Run discovery scans, in order, $MTGA_DATA_ROOT/foundation/{runs,frozen_eval}
and the in-repo mirror paper/data/{runs,frozen_eval}; live data wins on
exact run_id collision. Config roles are resolved only through the tracked
run manifest, never by choosing the newest run with a matching config name.
Every emitted cell carries its run_id in a LaTeX comment (the ledger-to-cell
mapping). Missing non-run numbers are emitted as \\pending{...}; a missing or
mismatched pinned run is an error. This script NEVER invents a value.

Usage: python3 scripts/make_paper_tables.py [--repo PATH]
"""

import argparse
import json
import os
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

DEV_SETS = ["BRO", "TMT", "SOS"]

# Pre-registered scaling ladder (docs/eval_protocol.md section 4.3). Labels are
# frozen identifiers; set counts are reported from run records. `name` matches
# TrainConfig.name in record.json.
RUNGS = [
    ("S1",  "s1",  ["NEO"]),
    ("S2",  "s2",  ["NEO", "DSK"]),
    ("S2b", "s2b", ["MOM", "TDM"]),
    ("S4",  "s4",  ["NEO", "DSK", "DMU", "FIN"]),
    ("S4b", "s4b", ["STX", "SNC", "OTJ", "TLA"]),
    ("S8",  "s8",  ["NEO", "DSK", "DMU", "FIN", "STX", "MOM", "BLB", "TLA"]),
    ("S16", "s16", ["NEO", "DSK", "DMU", "FIN", "STX", "MOM", "BLB", "TLA",
                    "AFR", "SNC", "ONE", "LTR", "WOE", "MKM", "OTJ", "EOE"]),
    ("S27", "f_dev", None),  # full F-dev universe
]

ABLATION_RUNS = [
    ("Full (F-dev recipe)", "f_dev", "F-dev"),
    ("A-notext", "a_notext", "A-notext"),
    ("A-noctx (winning)", "a_noctx", "A-noctx"),
    ("A-proportional", "a_proportional", "A-proportional"),
    ("A-topfilter", "a_topfilter", "A-topfilter"),
    ("A-noUB", "a_noUB", "A-noUB"),
]

PAPER_RUN_ROLES = (
    {"f_full"}
    | {config_name for _, config_name, _ in RUNGS}
    | {role for _, role, _ in ABLATION_RUNS}
)


class PaperSourceError(RuntimeError):
    """A tracked paper run cannot be resolved to its declared source."""


# Frozen post-release baselines (recipes in experiments/frozen_battery.json;
# executed on the frozen MSH snapshot only, per protocol section 4.5).
ASTERISKED_BASELINES = [
    ("baseline-ratings", "Site-ratings heuristic (day $\\sim$2)"),
    ("baseline-alsa", "ALSA-argmin"),
    ("baseline-gih", "shrunk-GIH-argmax"),
]


def norm_member(name):
    return re.sub(r"[^a-z0-9]", "", str(name).lower())


def load_json(path):
    with open(path) as fh:
        return json.load(fh)


def data_roots(repo):
    roots = []
    env = os.environ.get("MTGA_DATA_ROOT")
    candidates = []
    if env:
        candidates.append(Path(env) / "foundation")
    user = os.environ.get("USER", "unknown")
    candidates.append(Path(f"/opt/{user}/dat/mtga/foundation"))
    candidates.append(repo / "paper" / "data")  # in-repo mirror, always last
    for c in candidates:
        if c.is_dir() and c not in roots:
            roots.append(c)
    return roots


def discover_runs(repo):
    """{run_id: {record, summary, root}} — first root wins (live over mirror)."""
    runs = {}
    for root in data_roots(repo):
        runs_dir = root / "runs"
        if not runs_dir.is_dir():
            continue
        for d in sorted(runs_dir.iterdir()):
            if not d.is_dir() or d.name in runs:
                continue
            entry = {"run_id": d.name, "record": None, "summary": None,
                     "root": str(root)}
            if (d / "record.json").exists():
                entry["record"] = load_json(d / "record.json")
            zs = d / "zeroshot"
            if (zs / "summary.json").exists():
                entry["summary"] = load_json(zs / "summary.json")
            # Secondary zero-shot analyses (eval_*.py outputs) live beside the
            # summary; load whichever are present so their numbers reach the
            # prose macros instead of being transcribed by hand.
            for key, fname in (("normalized_score", "normalized_score.json"),
                               ("late_retention", "late_draft_retention.json"),
                               ("bro_transfer", "bro_transfer_analysis.json")):
                entry[key] = load_json(zs / fname) if (zs / fname).exists() \
                    else None
            if entry["record"] or entry["summary"]:
                runs[d.name] = entry
    return runs


def discover_frozen(repo):
    """[(sha, summary)] for every frozen-eval output found."""
    out, seen = [], set()
    for root in data_roots(repo):
        fe = root / "frozen_eval"
        if not fe.is_dir():
            continue
        for d in sorted(fe.iterdir()):
            s = d / "summary.json"
            if d.name in seen or not s.exists():
                continue
            out.append((d.name, load_json(s)))
            seen.add(d.name)
    return out


def load_ledger(repo):
    path = repo / "experiments" / "ledger.jsonl"
    entries = {}
    if path.exists():
        for line in path.read_text().splitlines():
            line = line.strip()
            if line:
                rec = json.loads(line)
                entries[rec.get("run_id")] = rec
    return entries


def runs_by_manifest(runs, manifest, required_roles=PAPER_RUN_ROLES):
    """Resolve paper roles to exact run ids declared in the tracked manifest."""
    if manifest.get("schema_version") != 1:
        raise PaperSourceError(
            "paper run manifest must have schema_version 1")
    specs = manifest.get("runs")
    if not isinstance(specs, dict):
        raise PaperSourceError("paper run manifest must contain a 'runs' object")

    missing_roles = sorted(set(required_roles) - set(specs))
    if missing_roles:
        raise PaperSourceError(
            "paper run manifest is missing required roles: "
            + ", ".join(missing_roles))

    pinned = {}
    for role in sorted(required_roles):
        spec = specs[role]
        if not isinstance(spec, dict):
            raise PaperSourceError(f"paper run role {role!r} must be an object")
        run_id = spec.get("run_id")
        config_name = spec.get("config_name")
        best_sha256 = spec.get("best_sha256")
        if not run_id or not config_name or not best_sha256:
            raise PaperSourceError(
                f"paper run role {role!r} requires run_id, config_name, and "
                "best_sha256")

        entry = runs.get(run_id)
        if entry is None:
            raise PaperSourceError(
                f"paper run role {role!r} pins {run_id!r}, but that run was "
                "not found in any live or mirrored data root")
        record = entry.get("record")
        if record is None:
            raise PaperSourceError(
                f"paper run role {role!r} pins {run_id!r}, but record.json "
                "is missing")
        recorded_run_id = record.get("run_id")
        if recorded_run_id != run_id:
            raise PaperSourceError(
                f"paper run role {role!r} pins {run_id!r}, but record.json "
                f"declares run_id {recorded_run_id!r}")
        recorded_config = record.get("config", {}).get("name")
        if recorded_config != config_name:
            raise PaperSourceError(
                f"paper run role {role!r} pins config {config_name!r}, but "
                f"run {run_id!r} declares config {recorded_config!r}")
        recorded_sha256 = (record.get("artifacts") or {}).get("best_sha256")
        if recorded_sha256 != best_sha256:
            raise PaperSourceError(
                f"paper run role {role!r} pins best_sha256 {best_sha256!r}, "
                f"but run {run_id!r} declares {recorded_sha256!r}")
        if spec.get("require_summary") and entry.get("summary") is None:
            raise PaperSourceError(
                f"paper run role {role!r} pins {run_id!r}, but "
                "zeroshot/summary.json is missing")
        pinned[role] = entry
    return pinned


# --- formatting -------------------------------------------------------------

def pct(x, dp=1):
    return f"{100 * float(x):.{dp}f}"


def cell(value, ci=None, run_id=None, dp=1):
    body = pct(value, dp)
    if ci:
        body += f" {{\\scriptsize({pct(ci[0], dp)}, {pct(ci[1], dp)})}}"
    comment = f" % run={run_id}" if run_id else ""
    return body, comment


def pending(desc):
    """Table-cell placeholder: compact marker, description as a comment."""
    return "\\pendingcell", f" % pending: {desc}"


def emit_rows(rows):
    """rows: list of lists of (body, comment) cells or raw strings."""
    lines = []
    for row in rows:
        if isinstance(row, str):
            lines.append(row)
            continue
        parts, comments = [], []
        for c in row:
            if isinstance(c, tuple):
                parts.append(c[0])
                if c[1]:
                    comments.append(c[1].strip().lstrip("% "))
            else:
                parts.append(c)
        line = " & ".join(parts) + r" \\"
        if comments:
            line += "  % " + "; ".join(comments)
        lines.append(line)
    return lines


def write_table(path, lines, header):
    text = "% AUTO-GENERATED by scripts/make_paper_tables.py -- do not edit.\n"
    text += f"% {header}\n" + "\n".join(lines) + "\n"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    print(f"wrote {path.relative_to(REPO)}")


# --- extraction -------------------------------------------------------------

def dev_expert(summary, set_code):
    """(top1, ci, extras) for one dev set from a zeroshot summary.json."""
    if not summary:
        return None
    block = summary.get("summaries", {}).get(f"{set_code}.PremierDraft")
    if not block:
        return None
    e = block["expert"]
    return {"top1": e["top1"], "ci": e.get("top1_ci"),
            "top3": e.get("top3"), "log_loss": e.get("log_loss"),
            "ece": e.get("ece"), "non_forced": e.get("top1_non_forced"),
            "n_picks": e.get("n_picks"), "n_drafts": e.get("n_drafts"),
            "all_users_top1": block.get("all_users_top1")}


def msh_expert(frozen, member):
    """Expert deployment-mode top-1 for a battery member from the real
    (non-rehearsal) frozen eval, if it has run."""
    want = norm_member(member)
    for sha, summary in frozen:
        ctx = summary.get("context", {})
        if ctx.get("rehearse") or ctx.get("set") != "MSH":
            continue
        for name, modes in summary.get("results", {}).items():
            if norm_member(name) != want:
                continue
            block = modes.get("deployment", {}).get("expert")
            if block:
                return {"top1": block["top1"], "ci": block.get("top1_ci"),
                        "run_id": f"frozen_eval/{sha[:12]}"}
    return None


def msh_secondary(frozen, member):
    """Secondary MSH metrics already sitting in the one completed frozen-eval
    pass (no re-inference): deployment/expert top-3, log-loss, ECE; the
    all-users slice (human-mode/all); and the skill-conditioning gap
    (deployment's fixed top bucket vs. each drafter's own bucket, expert
    slice). None of this touches MSH pick data a second time -- it is all
    read out of the single cached summary.json the real run already wrote."""
    want = norm_member(member)
    for sha, summary in frozen:
        ctx = summary.get("context", {})
        if ctx.get("rehearse") or ctx.get("set") != "MSH":
            continue
        for name, modes in summary.get("results", {}).items():
            if norm_member(name) != want:
                continue
            deploy_expert = modes.get("deployment", {}).get("expert")
            human_expert = modes.get("human", {}).get("expert")
            human_all = modes.get("human", {}).get("all")
            if not (deploy_expert and human_expert and human_all):
                return None
            return {
                "run_id": f"frozen_eval/{sha[:12]}",
                "top3": deploy_expert["top3"],
                "log_loss": deploy_expert["log_loss"],
                "ece": deploy_expert["ece"],
                "all_users_top1": human_all["top1"],
                "skill_gap_pp": 100 * (deploy_expert["top1"]
                                       - human_expert["top1"]),
            }
    return None


def msh_ceiling_comparison(frozen, member):
    """The pre-registered post-day-one ceiling comparison for a battery
    member (normalized score + late-draft retention vs the per-set MSH
    ceiling), from the addendum summary written by
    eval_msh_ceiling_comparison.py after the zero-shot pass."""
    want = norm_member(member)
    for sha, summary in frozen:
        ctx = summary.get("context", {})
        if ctx.get("rehearse") or ctx.get("set") != "MSH":
            continue
        for name, comparison in (summary.get("ceiling_comparisons")
                                 or {}).items():
            if norm_member(name) == want and comparison:
                return {**comparison, "run_id": f"frozen_eval/{sha[:12]}"}
    return None


def rehearsal_baselines(frozen):
    """{member_norm: {top1, ci, run_id, set, format}} from rehearsal passes.

    Multiple rehearsal directories can exist (smoke tests of the export/eval
    pipeline against scratch battery files leave minimal, baseline-only
    summaries behind). Picking "whichever sorts first by sha" is an accident
    of discovery order, not a choice -- prefer the richest rehearsal pass
    (most battery members scored) so a throwaway smoke-test artifact can
    never silently outrank the deliberate full-battery rehearsal a published
    number was drawn from."""
    by_sha_richness = sorted(
        frozen,
        key=lambda item: len((item[1].get("results") or {})),
        reverse=True,
    )
    out = {}
    for sha, summary in by_sha_richness:
        ctx = summary.get("context", {})
        if not ctx.get("rehearse"):
            continue
        for name, modes in summary.get("results", {}).items():
            block = modes.get("deployment", {})
            e = block.get("expert") or block.get("all")
            if not e:
                continue
            out.setdefault(norm_member(name), {
                "top1": e["top1"], "ci": e.get("top1_ci"),
                "run_id": f"frozen_eval/{sha[:12]} (rehearsal)",
                "set": ctx.get("set"), "format": ctx.get("format"),
                "n_picks": e.get("n_picks"),
            })
    return out


# --- tables -----------------------------------------------------------------

def table_main(anchors, fdev, ffull, a_noctx, frozen, ledger):
    ceil = anchors["ceilings"]
    rows = [
        r"\begin{tabular}{lccccc}",
        r"\toprule",
        r"\rowcolor{tblhead}",
        r"Model & BRO & TMT & SOS & Dev mean & MSH \\",
        r"\midrule",
    ]
    # F-dev row.
    fdev_cells = [r"DraftFM (F-dev, zero-shot)"]
    dev_vals = []
    run_id = fdev["run_id"] if fdev else None
    for s in DEV_SETS:
        d = dev_expert(fdev["summary"] if fdev else None, s)
        if d:
            fdev_cells.append(cell(d["top1"], d["ci"], run_id))
            dev_vals.append(d["top1"])
        else:
            fdev_cells.append(pending(s))
    if len(dev_vals) == 3:
        mean = fdev["summary"].get("dev_mean_expert_top1",
                                   sum(dev_vals) / 3)
        fdev_cells.append(cell(mean, run_id=run_id))
    else:
        fdev_cells.append(pending("mean"))
    m = msh_expert(frozen, "F-dev")
    fdev_cells.append(cell(m["top1"], m["ci"], m["run_id"]) if m
                      else pending("eval"))
    rows.append(fdev_cells)

    # A-noctx row: the pre-registered architecture ablation that won the
    # dev-trio sweep -- same architecture F-full ships (verified by matching
    # param counts), held out on the dev trio, so unlike F-full's own row
    # (never quoted) this one is a real, honest zero-shot number for the
    # shipped recipe. Surfaced here, not just in the ablation grid, so the
    # reader doesn't have to infer the selected model from six other rows.
    anoctx_cells = [r"\quad DraftFM (A-noctx, selected dev recipe)"]
    anoctx_vals = []
    anoctx_run_id = a_noctx["run_id"] if a_noctx else None
    for s in DEV_SETS:
        d = dev_expert(a_noctx["summary"] if a_noctx else None, s)
        if d:
            anoctx_cells.append(cell(d["top1"], d["ci"], anoctx_run_id))
            anoctx_vals.append(d["top1"])
        else:
            anoctx_cells.append(pending(s))
    if len(anoctx_vals) == 3:
        mean = a_noctx["summary"].get("dev_mean_expert_top1",
                                      sum(anoctx_vals) / 3)
        anoctx_cells.append(cell(mean, run_id=anoctx_run_id))
    else:
        anoctx_cells.append(pending("mean"))
    anoctx_cells.append(r"--")  # A-noctx is dev-only, never scored on MSH
    rows.append(anoctx_cells)

    # F-full row: dev cells never quoted (trained on the dev sets).
    ffull_cells = [r"DraftFM (F-full, zero-shot)"]
    ffull_cells += [r"--", r"--", r"--", r"--"]
    m = msh_expert(frozen, "F-full")
    ffull_cells.append(cell(m["top1"], m["ci"], m["run_id"]) if m
                       else pending("eval"))
    rows.append(ffull_cells)
    rows.append(r"\midrule")

    # Within-set supervised reference row (models trained on the target set).
    ceil_cells = [r"Within-set supervised reference"]
    ceil_vals = []
    for s in DEV_SETS:
        c = ceil[s]
        ceil_cells.append(cell(c["top1"], c.get("top1_ci"), c["run_id"]))
        ceil_vals.append(c["top1"])
    ceil_cells.append(cell(sum(ceil_vals) / 3))
    m = msh_expert(frozen, "perset")
    ceil_cells.append(cell(m["top1"], m["ci"], m["run_id"]) if m
                      else pending("post-T0"))
    rows.append(ceil_cells)

    # Unaligned ratio row (arithmetic on the two rows above; the
    # pre-registered normalized score on identical picks is separate).
    ratio_cells = [r"\quad F-dev / reference (unaligned)"]
    if len(dev_vals) == 3:
        ratios = [d / c for d, c in zip(dev_vals, ceil_vals)]
        for r in ratios:
            ratio_cells.append((f"{r:.3f}", ""))
        ratio_cells.append((f"{sum(ratios) / 3:.3f}", ""))
    else:
        ratio_cells += [pending("ratio")] * 4
    fdev_msh = msh_expert(frozen, "F-dev")
    ceil_msh = msh_expert(frozen, "perset")
    if fdev_msh and ceil_msh:
        ratio_cells.append(
            (f"{fdev_msh['top1'] / ceil_msh['top1']:.3f}", ""))
    else:
        ratio_cells.append(pending("post-T0"))
    rows.append(ratio_cells)

    rows += [r"\bottomrule", r"\end{tabular}"]
    return emit_rows(rows)


def table_baselines(anchors, frozen):
    """Measured baselines only. Published prior numbers live in the intro's
    prior-work table (table_prior_work); mixing the two blocks in one table
    invited exactly the head-to-head misreading the caption had to disclaim."""
    reh = rehearsal_baselines(frozen)
    rows = [
        r"\begin{tabular}{llll}",
        r"\toprule",
        r"\rowcolor{tblhead}",
        r"Method & Information used & Test set & Top-1 agreement (\%) \\",
        r"\midrule",
    ]

    def measured(member, label, info):
        b = reh.get(norm_member(member))
        m = msh_expert(frozen, member)
        if m:  # real MSH number supersedes the rehearsal
            return [label, info, "MSH", cell(m["top1"], m["ci"], m["run_id"])]
        if b:
            return [label, info, f"{b['set']} {b['format']} (rehearsal)",
                    cell(b["top1"], b["ci"], b["run_id"])]
        return [label, info, "MSH", pending("eval")]

    rows.append(measured("baseline-random", "Random", "none"))
    rows.append(measured("baseline-rarity", "Rarity--color heuristic",
                         "card features (hour 0)"))
    for member, label in ASTERISKED_BASELINES:
        m = msh_expert(frozen, member)
        c = cell(m["top1"], m["ci"], m["run_id"]) if m \
            else (r"\textit{not evaluated}",
                  " % recipe not frozen before T0")
        rows.append([label + r"$^{*}$", "post-release statistics", "MSH", c])
    rows += [r"\bottomrule", r"\end{tabular}"]
    return emit_rows(rows)


# Presentational metadata for the intro's prior-work summary (anchor key,
# approach, scores-unseen-sets?, day-one-information-only?). Numbers still
# flow from anchors.json; only the classification is declared here.
PRIOR_WORK_ROWS = [
    ("ward_draftsimbot", "Hand-tuned ratings", "no", "yes"),
    ("ward_nnetbot", "One-hot MLP, per set", "no", "no"),
    ("statistical_drafting_within_set", "One-hot MLP, per set", "no", "no"),
    ("puder_within_set", "Transformer, per set", "no", "no"),
    ("bertram_features_only_unseen", "Card features, one set", "yes", "yes"),
    ("bertram_bro_zeroshot", "Features+stats+images, 13 sets", "yes", "no"),
    ("urzagpt_gpt4o", "LLM, zero-shot", "yes", "yes"),
]


def table_prior_work(anchors, frozen):
    """Intro literature summary: every published pick-agreement number this
    paper cites, its information regime, and whether it works on an unseen
    set with day-one information -- closed by this paper's own frozen MSH
    row so the reader sees where DraftFM lands in the same frame."""
    pub = anchors["published"]
    rows = [
        r"\begin{tabular}{llccll}",
        r"\toprule",
        r"\rowcolor{tblhead}",
        r"Reference & Approach & Unseen & Day 1 & Test set "
        r"& Top-1 (\%) \\",
        r"\midrule",
    ]
    for key, approach, unseen, dayone in PRIOR_WORK_ROWS:
        p = pub[key]
        star = "$^{*}$" if "asterisk" in p else ""
        if "top1" in p:
            val = (pct(p["top1"]), "")
        else:
            val = (f"{pct(p['top1_lo'])}--{pct(p['top1_hi'])}", "")
        rows.append([f"\\citet{{{p['cite']}}}{star}", approach, unseen,
                     dayone, p["test_set"], val])
    rows.append(r"\midrule")
    m = msh_expert(frozen, "F-full")
    msh_cell = cell(m["top1"], run_id=m["run_id"]) if m else pending("MSH")
    rows.append(["DraftFM (this paper)", "Card features, 31 sets", "yes",
                 "yes", "MSH (unseen)", msh_cell])
    rows += [r"\bottomrule", r"\end{tabular}"]
    return emit_rows(rows)


SKILL_BAND_LABELS = {
    "bottom": r"Bottom (win rate $<$ 0.50)",
    "middle": r"Middle (0.50--0.55)",
    "top": r"Top ($\geq$ 0.55)",
}


def table_skill_bands(breakdowns):
    """Top-1 by drafter win-rate band (deployment mode) from cached
    predictions: dev trio from F-dev, MSH from the frozen F-full pass."""
    sets = ["BRO", "TMT", "SOS", "MSH.deployment"]
    heads = ["BRO", "TMT", "SOS", "MSH"]
    rows = [
        r"\begin{tabular}{lcccc}",
        r"\toprule",
        r"\rowcolor{tblhead}",
        r"Drafter band & " + " & ".join(heads) + r" \\",
        r"\midrule",
    ]
    for band in ("bottom", "middle", "top"):
        cells = [SKILL_BAND_LABELS[band]]
        for s in sets:
            entry = breakdowns["sets"].get(s) if breakdowns else None
            rec = next((b for b in entry["skill_bands"]
                        if b["band"] == band), None) if entry else None
            cells.append(cell(rec["top1"], rec["top1_ci"],
                              entry["source_run"]) if rec else pending(s))
        rows.append(cells)
    rows += [r"\bottomrule", r"\end{tabular}"]
    return emit_rows(rows)


def skill_band_macros(breakdowns):
    """Prose macros for the band breakdown (LaTeX names cannot hold digits)."""
    out = []

    def macro(name, body, run_id=None):
        comment = f" % run={run_id}" if run_id else ""
        out.append(f"\\newcommand{{\\{name}}}{{{body}}}{comment}")

    def band(set_key, band_name):
        entry = breakdowns["sets"].get(set_key) if breakdowns else None
        if not entry:
            return None, None
        rec = next((b for b in entry["skill_bands"]
                    if b["band"] == band_name), None)
        return (rec, entry["source_run"]) if rec else (None, None)

    caps = {"bottom": "Bot", "middle": "Mid", "top": "Top"}
    for set_key, suffix in [("BRO", "Bro"), ("TMT", "Tmt"), ("SOS", "Sos"),
                            ("MSH.deployment", "Msh")]:
        for band_name, cap in caps.items():
            rec, run = band(set_key, band_name)
            name = f"SkillBand{cap}{suffix}"
            macro(name, pct(rec["top1"]) if rec
                  else f"\\pending{{{name}}}", run)
    for band_name, cap in [("bottom", "Bot"), ("top", "Top")]:
        rec, run = band("MSH.human", band_name)
        macro(f"SkillBand{cap}MshHuman",
              pct(rec["top1"]) if rec else "\\pending{MSH human band}", run)
    top, run = band("MSH.deployment", "top")
    bot, _ = band("MSH.deployment", "bottom")
    if top and bot:
        macro("SkillBandGapMsh",
              f"{100 * (top['top1'] - bot['top1']):.1f}", run)
    else:
        macro("SkillBandGapMsh", "\\pending{MSH band gap}")
    return out


def table_ablations(by_role, frozen):
    rows = [
        r"\begin{tabular}{lccccc}",
        r"\toprule",
        r"\rowcolor{tblhead}",
        r"Variant & BRO & TMT & SOS & Dev mean & MSH \\",
        r"\midrule",
    ]
    for label, cfg_name, member in ABLATION_RUNS:
        entry = by_role.get(cfg_name) if cfg_name else None
        run_id = entry["run_id"] if entry else None
        cells = [label]
        vals = []
        for s in DEV_SETS:
            d = dev_expert(entry["summary"] if entry else None, s)
            if d:
                # Point estimates: the grid's payload is deltas; CIs are in
                # the main table and the paired-difference statistics.
                cells.append(cell(d["top1"], run_id=run_id))
                vals.append(d["top1"])
            else:
                cells.append(pending(s))
        if len(vals) == 3:
            mean = entry["summary"].get("dev_mean_expert_top1",
                                        sum(vals) / 3)
            cells.append(cell(mean, run_id=run_id))
        else:
            cells.append(pending("mean"))
        m = msh_expert(frozen, member)
        cells.append(cell(m["top1"], run_id=m["run_id"]) if m
                     else pending("eval"))
        rows.append(cells)
    rows += [r"\bottomrule", r"\end{tabular}"]
    return emit_rows(rows)


RUNG_LABELS = {  # incremental descriptions keep the column narrow
    "S1": "NEO",
    "S2": "S1 + DSK",
    "S2b": "MOM, TDM (probe)",
    "S4": "S2 + DMU, FIN",
    "S4b": "STX, SNC, OTJ, TLA (probe)",
    "S8": "S4 + STX, MOM, BLB, TLA",
    "S16": "S8 + AFR, SNC, ONE, LTR, WOE, MKM, OTJ, EOE",
    "S27": "full F-dev universe",
}


def table_scaling(by_role, frozen, ledger):
    rows = [
        r"\begin{tabular}{l p{4.8cm} rrrc}",
        r"\toprule",
        r"\rowcolor{tblhead}",
        r"Rung & Sets & \#sets & Train picks (M) & Best step "
        r"& Dev-mean top-1 (\%) \\",
        r"\midrule",
    ]
    curve = []
    for rung, cfg_name, sets in RUNGS:
        entry = by_role.get(cfg_name)
        rec = entry["record"] if entry else None
        run_id = entry["run_id"] if entry else None
        if rec:
            set_list = sorted({s for s, _ in rec["config"]["sets"]})
        else:
            set_list = sets or []
        n_sets = len(set_list) if set_list else None
        label = RUNG_LABELS.get(rung) or ", ".join(set_list) or "--"
        picks = rec["n_train_picks"] if rec else None
        step = rec.get("best_step") if rec else None

        cells = [rung, label]
        cells.append((str(n_sets), "") if n_sets else pending("n"))
        cells.append((f"{picks / 1e6:.1f}",
                      f" % run={run_id}") if picks else pending("train"))
        cells.append((str(step), "") if step is not None
                     else pending("train"))
        mean = None
        if entry and entry["summary"]:
            mean = entry["summary"].get("dev_mean_expert_top1")
        if mean is not None:
            cells.append(cell(mean, run_id=run_id))
        else:
            cells.append(pending("eval"))
        rows.append(cells)
        curve.append({
            "rung": rung, "config_name": cfg_name, "run_id": run_id,
            "n_sets": n_sets, "train_picks": picks,
            "dev_mean_top1": mean,
            "in_ledger": run_id in ledger if run_id else False,
        })
    rows += [r"\bottomrule", r"\end{tabular}"]
    return emit_rows(rows), curve


def numbers_macros(anchors, fdev, ffull, a_noctx, frozen, calibration=None):
    """LaTeX macros so results/analysis prose needs no edits when numbers
    land. Missing values render as \\pending{...}."""
    out = []

    def macro(name, body, run_id=None):
        comment = f" % run={run_id}" if run_id else ""
        out.append(f"\\newcommand{{\\{name}}}{{{body}}}{comment}")

    run_id = fdev["run_id"] if fdev else None
    dev_vals = []
    for s in DEV_SETS:
        d = dev_expert(fdev["summary"] if fdev else None, s)
        if d:
            macro(f"Fdev{s.title()}", pct(d["top1"]), run_id)
            macro(f"Fdev{s.title()}NonForced", pct(d["non_forced"]), run_id)
            macro(f"Fdev{s.title()}Ece", f"{d['ece']:.3f}", run_id)
            macro(f"Fdev{s.title()}AllUsers", pct(d["all_users_top1"]),
                  run_id)
            dev_vals.append(d["top1"])
        else:
            macro(f"Fdev{s.title()}", f"\\pending{{F-dev {s}}}")
            macro(f"Fdev{s.title()}NonForced", f"\\pending{{F-dev {s} nf}}")
            macro(f"Fdev{s.title()}Ece", f"\\pending{{F-dev {s} ECE}}")
            macro(f"Fdev{s.title()}AllUsers",
                  f"\\pending{{F-dev {s} all-users}}")
    wr_id = fdev["summary"].get("wr_id") if fdev and fdev["summary"] else None
    if wr_id is not None:
        macro("DeployBucket", f"{wr_id / 50:.2f}", run_id)
    else:
        macro("DeployBucket", "\\pending{deployment skill bucket}")
    ceil_sos = anchors["ceilings"]["SOS"]
    macro("CeilSosEce", f"{ceil_sos['ece']:.3f}", ceil_sos["run_id"])
    if len(dev_vals) == 3:
        mean = fdev["summary"].get("dev_mean_expert_top1", sum(dev_vals) / 3)
        macro("FdevDevMean", pct(mean), run_id)
    else:
        macro("FdevDevMean", "\\pending{F-dev dev mean}")

    ceil = anchors["ceilings"]
    for s in DEV_SETS:
        macro(f"Ceil{s.title()}", pct(ceil[s]["top1"]), ceil[s]["run_id"])
    if len(dev_vals) == 3:
        # Unweighted mean of the three PER-SET ratios (zeroshot/ceiling,
        # unaligned picks) -- NOT the ratio of the means, and NOT the
        # pre-registered aligned normalized score (evalproto.summarize's
        # "normalized score", docs/eval_protocol.md section 3; computed
        # separately by eval_normalized_score.py, currently 78.6% dev-mean,
        # cited alongside this ratio in results.tex's "Zero-shot transfer"
        # paragraph). The two are close (78.7 vs 78.6) but are different
        # aggregates over different (unaligned vs. aligned) pick sets --
        # don't conflate them if this macro's definition ever changes.
        ratios = [d / ceil[s]["top1"] for d, s in zip(dev_vals, DEV_SETS)]
        for s, r in zip(DEV_SETS, ratios):
            macro(f"Ratio{s.title()}", f"{100 * r:.1f}")
        macro("RatioDevMean", f"{100 * sum(ratios) / 3:.1f}")

    # Two macro families per baseline: the pre-freeze SOS-rehearsal value
    # (\BaseRandom/\BaseRarity -- historical anchors quoted as such) and the
    # frozen MSH value (\BaseRandomMsh/\BaseRarityMsh -- what the same
    # pre-registered baseline scored in the real evaluation). The two differ
    # sharply for the rarity heuristic (42.8 rehearsal vs 25.6 MSH), so prose
    # must never quote one while describing the other.
    reh = rehearsal_baselines(frozen)
    for member, name in [("baseline-random", "BaseRandom"),
                         ("baseline-rarity", "BaseRarity")]:
        b = reh.get(norm_member(member))
        if b:
            macro(name, pct(b["top1"]), b["run_id"])
        else:
            macro(name, f"\\pending{{{member}}}")
        m = msh_expert(frozen, member)
        if m:
            macro(f"{name}Msh", pct(m["top1"]), m["run_id"])
        else:
            macro(f"{name}Msh", f"\\pending{{{member} MSH}}")

    m = msh_expert(frozen, "F-full")
    macro("FfullMsh", pct(m["top1"]) if m
          else "\\pending{F-full MSH top-1}",
          m["run_id"] if m else None)

    # Secondary MSH metrics (top-3, log-loss, ECE, all-users slice,
    # skill-conditioning gap): all read from the single completed frozen-eval
    # pass, no MSH re-inference. Normalized score vs. a per-set MSH ceiling
    # and late-draft retention on MSH stay \pending -- they need a per-set
    # ceiling model trained on MSH, deliberately not done yet.
    # Post-day-one rows: the per-set MSH ceiling and the pre-registered
    # ceiling comparisons for the headline model, from the addendum summary.
    cm = msh_expert(frozen, "perset")
    macro("CeilMsh", pct(cm["top1"]) if cm else "\\pending{MSH ceiling}",
          cm["run_id"] if cm else None)
    cc = msh_ceiling_comparison(frozen, "f-full")
    if cc:
        macro("NormScoreMsh", f"{100 * cc['normalized_top1']:.1f}",
              cc["run_id"])
        macro("LateRetMsh", f"{100 * cc['late_draft_retention']:.1f}",
              cc["run_id"])
        macro("MshSharedPicks", f"{cc['n_shared_picks']:,}", cc["run_id"])
    else:
        macro("NormScoreMsh", "\\pending{MSH normalized score}")
        macro("LateRetMsh", "\\pending{MSH late-draft retention}")
        macro("MshSharedPicks", "\\pending{MSH shared picks}")

    ms = msh_secondary(frozen, "F-full")
    if ms:
        macro("FfullMshTopThree", pct(ms["top3"]), ms["run_id"])
        macro("FfullMshLogLoss", f"{ms['log_loss']:.3f}", ms["run_id"])
        macro("FfullMshEce", f"{ms['ece']:.3f}", ms["run_id"])
        macro("FfullMshAllUsers", pct(ms["all_users_top1"]), ms["run_id"])
        macro("FfullMshSkillGap", f"{ms['skill_gap_pp']:.2f}", ms["run_id"])
    else:
        for name, desc in [("FfullMshTopThree", "MSH top-3"),
                           ("FfullMshLogLoss", "MSH log-loss"),
                           ("FfullMshEce", "MSH ECE"),
                           ("FfullMshAllUsers", "MSH all-users top-1"),
                           ("FfullMshSkillGap", "MSH skill-conditioning gap")]:
            macro(name, f"\\pending{{{desc}}}")
    macro("ProtocolTag", anchors["manifests"]["protocol_tag"])
    macro("DataManifestHash",
          anchors["manifests"]["data_manifest_content_hash"][:12])
    macro("FeaturizerHash",
          anchors["manifests"]["featurizer_manifest_hash"][:12])
    if fdev and fdev["record"]:
        rec = fdev["record"]
        macro("FdevParams", f"{rec['n_params'] / 1e6:.1f}", fdev["run_id"])
        macro("FdevPicks", f"{rec['n_train_picks'] / 1e6:.1f}",
              fdev["run_id"])
        macro("FdevShards", str(rec["n_shards"]), fdev["run_id"])
        macro("FdevSets", str(len({s for s, _ in rec["config"]["sets"]})),
              fdev["run_id"])
        macro("FdevWallHours", f"{rec['wall_clock_s'] / 3600:.1f}",
              fdev["run_id"])
        macro("FdevExamplesPerSec", f"{rec['examples_per_s']:,}",
              fdev["run_id"])
        macro("FdevRunId", fdev["run_id"].replace("_", r"\_"))

    # F-full: the actual shipped/frozen recipe (A-noctx's architecture,
    # retrained on all 31 sets). Its own dev numbers are never quoted
    # (table_main already enforces this); the one legitimate prose fact is
    # its param count, which the abstract/intro need to stop conflating
    # with F-dev's.
    if ffull and ffull["record"]:
        rec = ffull["record"]
        macro("FfullParams", f"{rec['n_params'] / 1e6:.1f}", ffull["run_id"])
        macro("FfullPicks", f"{rec['n_train_picks'] / 1e6:.1f}", ffull["run_id"])
        macro("FfullWallHours", f"{rec['wall_clock_s'] / 3600:.1f}",
              ffull["run_id"])
        macro("FfullRunId", ffull["run_id"].replace("_", r"\_"))

    # A-noctx: the winning architecture ablation -- same param count as
    # F-full (verified: both 1,637,999), held out on the dev trio, so its
    # numbers (unlike F-full's) are the honest zero-shot proxy for "how
    # does the shipped architecture do." Sourced the same way as F-dev's
    # per-set/ratio macros above, just for a different run.
    if a_noctx:
        anoctx_vals = []
        run_id = a_noctx["run_id"]
        for s in DEV_SETS:
            d = dev_expert(a_noctx["summary"], s)
            if d:
                macro(f"ANoctx{s.title()}", pct(d["top1"]), run_id)
                anoctx_vals.append(d["top1"])
            else:
                macro(f"ANoctx{s.title()}", f"\\pending{{A-noctx {s}}}")
        if len(anoctx_vals) == 3:
            mean = a_noctx["summary"].get("dev_mean_expert_top1",
                                          sum(anoctx_vals) / 3)
            macro("ANoctxDevMean", pct(mean), run_id)
            ratios = [v / ceil[s]["top1"] for v, s in zip(anoctx_vals, DEV_SETS)]
            for s, r in zip(DEV_SETS, ratios):
                macro(f"RatioANoctx{s.title()}", f"{100 * r:.1f}")
            macro("RatioANoctxDevMean", f"{100 * sum(ratios) / 3:.1f}")
        else:
            macro("ANoctxDevMean", "\\pending{A-noctx dev mean}")

    # Frozen dev-only calibration temperature (experiments/frozen_battery.json
    # "calibration" block, docs/eval_protocol.md section 3). Never fitted on
    # MSH -- MSH ECE stays a separate, still-pending quantity.
    if calibration:
        macro("FrozenTemperature", f"{calibration['temperature']:.2f}",
              calibration.get("fit_run"))
        macro("DevMeanEceAtTOne", f"{calibration['dev_mean_ece_at_t1']:.3f}",
              calibration.get("fit_run"))
        macro("DevMeanEceAtFrozenT",
              f"{calibration['dev_mean_ece_at_frozen_t']:.3f}",
              calibration.get("fit_run"))
    else:
        macro("FrozenTemperature", "\\pending{frozen temperature}")
        macro("DevMeanEceAtTOne", "\\pending{dev mean ECE at T=1}")
        macro("DevMeanEceAtFrozenT", "\\pending{dev mean ECE at frozen T}")
    return out


def pp_ci(lo, hi):
    """Format a [lo, hi] fraction pair as a 'lo--hi' percentage-point range.
    Auto-precision: 2 decimals when a bound is under 0.1pp (so a small but
    nonzero interval like 0.09--0.33 still reads as excluding zero), else 1."""
    lo_pp, hi_pp = 100 * lo, 100 * hi
    dp = 2 if min(abs(lo_pp), abs(hi_pp)) < 0.1 else 1
    return f"{lo_pp:.{dp}f}--{hi_pp:.{dp}f}"


def analysis_macros(fdev, ablation_deltas, seed_bands):
    """Macros for the secondary Analysis/Results statistics that were
    previously transcribed into prose by hand. Every value is read from a
    machine-readable source -- the f_dev run's zeroshot eval JSONs
    (eval_normalized_score / eval_late_draft_retention / eval_bro_transfer_
    analysis), experiments/ablation_deltas.json, and paper/data/seed_bands.json.
    Missing sources render as \\pending{...}; this function never invents a
    value. CI bounds and a few order-of-rounding-sensitive derived quantities
    stay in prose by design (see companion.tex provenance note)."""
    out = []

    def macro(name, body, run_id=None):
        comment = f" % run={run_id}" if run_id else ""
        out.append(f"\\newcommand{{\\{name}}}{{{body}}}{comment}")

    def pend(name, desc):
        macro(name, f"\\pending{{{desc}}}")

    run_id = fdev["run_id"] if fdev else None

    # -- Pre-registered aligned normalized score (results.tex "Zero-shot
    #    transfer"; eval_normalized_score.py). The pre-registered dev headline.
    ns = fdev.get("normalized_score") if fdev else None
    if ns:
        for s in DEV_SETS:
            block = ns["per_set"][f"{s}.PremierDraft"]
            macro(f"NormScore{s.title()}",
                  f"{100 * block['normalized_score']:.1f}", run_id)
        macro("NormScoreDevMean",
              f"{100 * ns['dev_mean_normalized_score']:.1f}", run_id)
    else:
        for s in DEV_SETS:
            pend(f"NormScore{s.title()}", f"normalized score {s}")
        pend("NormScoreDevMean", "normalized score dev mean")

    # -- Late-draft retention (analysis.tex "Late-draft retention";
    #    eval_late_draft_retention.py).
    lr = fdev.get("late_retention") if fdev else None
    if lr:
        for s in DEV_SETS:
            macro(f"LateRet{s.title()}",
                  f"{100 * lr['per_set'][s]['late_draft_retention']:.1f}",
                  run_id)
        macro("LateRetDevMean",
              f"{100 * lr['dev_mean_late_draft_retention']:.1f}", run_id)
    else:
        for s in DEV_SETS:
            pend(f"LateRet{s.title()}", f"late retention {s}")
        pend("LateRetDevMean", "late retention dev mean")

    # -- BRO bonus-sheet slice (analysis.tex "Why BRO transfers worst";
    #    eval_bro_transfer_analysis.py).
    bt = fdev.get("bro_transfer") if fdev else None
    if bt:
        present = bt["bonus_slice"]["bonus_present"]["top1"]
        absent = bt["bonus_slice"]["bonus_absent"]["top1"]
        macro("BonusPresentTopOne", f"{100 * present:.1f}", run_id)
        macro("BonusAbsentTopOne", f"{100 * absent:.1f}", run_id)
        macro("BonusRawGap", f"{100 * (absent - present):.1f}", run_id)
        strat = bt["bonus_slice_stratified_gap"]
        macro("BonusStratGap", f"{100 * strat['point']:.1f}", run_id)
        macro("BonusStratGapCi", pp_ci(*strat["ci"]), run_id)
        macro("BroTrioShortfall", f"{100 * bt['gap_vs_others']:.1f}", run_id)
        macro("BonusPresentFrac",
              f"{100 * bt['bonus_slice']['bonus_present']['frac_of_picks']:.0f}",
              run_id)
    else:
        for name, desc in [("BonusPresentTopOne", "bonus-present top1"),
                           ("BonusAbsentTopOne", "bonus-absent top1"),
                           ("BonusRawGap", "bonus raw gap"),
                           ("BonusStratGap", "bonus stratified gap"),
                           ("BonusStratGapCi", "bonus stratified gap CI"),
                           ("BroTrioShortfall", "BRO trio shortfall"),
                           ("BonusPresentFrac", "bonus-present frac")]:
            pend(name, desc)

    # -- Pre-registered ablation paired-difference deltas (analysis.tex "The
    #    licensed-IP shift"; eval_ablation_deltas.py, evalproto.paired_
    #    bootstrap_diff). Point in pp + CI range in pp.
    SHORT = {"text_penalty": "TextPen", "ub_penalty": "UbPen"}
    for label, prefix in SHORT.items():
        block = (ablation_deltas or {}).get(label)
        for s in DEV_SETS:
            if block and s in block:
                macro(f"{prefix}{s.title()}",
                      f"{100 * block[s]['point']:.1f}")
                macro(f"{prefix}{s.title()}Ci", pp_ci(*block[s]["ci"]))
            else:
                pend(f"{prefix}{s.title()}", f"{label} {s}")
                pend(f"{prefix}{s.title()}Ci", f"{label} {s} CI")

    # -- Zero-shot training-seed spread on the dev-mean (paper/data/
    #    seed_bands.json; scored on the S1/S4 rungs). Provided for the
    #    abstract's seed-variance citation; point values in pp.
    # Macro names spell out the digit (Sone/Sfour) -- LaTeX control words
    # cannot contain digits.
    for rung, word in (("S1", "Sone"), ("S4", "Sfour")):
        band = (seed_bands or {}).get(rung, {}).get("_band")
        if band:
            macro(f"SeedSpread{word}", f"{100 * band['spread']:.2f}")
        else:
            pend(f"SeedSpread{word}", f"seed spread {rung}")
    s1 = (seed_bands or {}).get("S1", {}).get("_band")
    s4 = (seed_bands or {}).get("S4", {}).get("_band")
    if s1 and s4:
        macro("SeedGainSoneSfour", f"{100 * (s4['mean'] - s1['mean']):.2f}")
    else:
        pend("SeedGainSoneSfour", "S1->S4 seed-mean gain")
    return out


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", type=Path, default=REPO)
    args = ap.parse_args(argv)
    repo = args.repo

    anchors = load_json(repo / "paper" / "data" / "anchors.json")
    ledger = load_ledger(repo)
    runs = discover_runs(repo)
    frozen = discover_frozen(repo)
    run_manifest = load_json(repo / "paper" / "data" / "run_manifest.json")
    try:
        by_role = runs_by_manifest(runs, run_manifest)
    except PaperSourceError as exc:
        ap.error(str(exc))
    fdev = by_role["f_dev"]
    ffull = by_role["f_full"]
    a_noctx = by_role["a_noctx"]
    battery_path = repo / "experiments" / "frozen_battery.json"
    battery = load_json(battery_path) if battery_path.exists() else {}
    calibration = battery.get("calibration")
    deltas_path = repo / "experiments" / "ablation_deltas.json"
    ablation_deltas = load_json(deltas_path) if deltas_path.exists() else None
    seed_path = repo / "paper" / "data" / "seed_bands.json"
    seed_bands = load_json(seed_path) if seed_path.exists() else None
    breakdown_path = repo / "paper" / "data" / "pick_breakdowns.json"
    breakdowns = load_json(breakdown_path) if breakdown_path.exists() else None

    tables = repo / "paper" / "tables"
    write_table(tables / "main_results.tex",
                table_main(anchors, fdev, ffull, a_noctx, frozen, ledger),
                "Main results: high-win-rate-slice deployment-mode top-1 "
                "(95% cluster-bootstrap CIs over drafts).")
    write_table(tables / "baselines.tex", table_baselines(anchors, frozen),
                "Measured baselines (hour-0 and asterisked post-release). "
                "Published prior numbers are in prior_work.tex.")
    write_table(tables / "prior_work.tex", table_prior_work(anchors, frozen),
                "Published pick-agreement anchors + this paper's frozen MSH "
                "row. * = caveat recorded in anchors.json.")
    write_table(tables / "skill_bands.tex", table_skill_bands(breakdowns),
                "Top-1 by drafter win-rate band, deployment mode, from "
                "cached predictions (eval_pick_breakdowns.py).")
    write_table(tables / "ablations.tex", table_ablations(by_role, frozen),
                "Pre-registered variant grid (protocol section 5).")
    scaling_rows, curve = table_scaling(by_role, frozen, ledger)
    write_table(tables / "scaling.tex", scaling_rows,
                "Scaling ladder (protocol section 4.3). Rung labels are "
                "frozen identifiers; counts come from run records.")
    write_table(tables / "numbers.tex",
                numbers_macros(anchors, fdev, ffull, a_noctx, frozen,
                              calibration)
                + analysis_macros(fdev, ablation_deltas, seed_bands)
                + skill_band_macros(breakdowns),
                "Number macros used by the prose.")

    figures = repo / "paper" / "figures"
    figures.mkdir(parents=True, exist_ok=True)
    curve_data = {
        "rungs": curve,
        "anchors": {
            "expert_tuned": {
                "top1": anchors["published"]["ward_draftsimbot"]["top1"],
                "label": "DraftsimBot 44.5 (expert-tuned, M19)"},
            "gpt4o": {
                "top1": anchors["published"]["urzagpt_gpt4o"]["top1"],
                "label": "GPT-4o zero-shot 43 (NEO)"},
            "bertram": {
                "top1": anchors["published"]["bertram_bro_zeroshot"]["top1"],
                "label": "Bertram et al. 55.4* (BRO, incl. post-release meta)"},
        },
        "ceiling_dev_mean": sum(
            anchors["ceilings"][s]["top1"] for s in DEV_SETS) / 3,
    }
    (figures / "scaling_data.json").write_text(
        json.dumps(curve_data, indent=2))
    print(f"wrote {(figures / 'scaling_data.json').relative_to(repo)}")

    n_real = sum(1 for r in curve if r["dev_mean_top1"] is not None)
    print(f"scaling rungs with dev numbers: {n_real}/{len(curve)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

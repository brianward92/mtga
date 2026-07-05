#!/usr/bin/env python3
"""Emit paper/tables/*.tex + paper/figures/scaling_data.json from run artifacts.

Machine-readable sources (never hand-typed numbers):
  experiments/ledger.jsonl                      run registry (run_id -> record)
  <runs root>/<run_id>/record.json              training config/counters
  <runs root>/<run_id>/zeroshot/summary.json    dev-trio zero-shot eval (eval_draftfm.py)
  <frozen root>/<sha>/summary.json              frozen-eval outputs (run_frozen_eval.py);
                                                rehearsals feed the baselines table, the
                                                real MSH pass feeds the MSH column
  paper/data/anchors.json                       per-set ceilings, published anchors,
                                                design constants, manifest hashes

Run discovery scans, in order, $MTGA_DATA_ROOT/foundation/{runs,frozen_eval}
and the in-repo mirror paper/data/{runs,frozen_eval}; live data wins on
run_id collision. Every emitted cell carries its run_id in a LaTeX comment
(the ledger-to-cell mapping). Missing numbers are emitted as \\pending{...}
-- this script NEVER invents a value. Scaling rungs appear automatically
once their zeroshot/summary.json lands.

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
            if (d / "zeroshot" / "summary.json").exists():
                entry["summary"] = load_json(d / "zeroshot" / "summary.json")
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


def runs_by_config_name(runs):
    """{config_name: entry}, preferring entries with a zeroshot summary,
    then the latest run_id."""
    best = {}
    for entry in runs.values():
        rec = entry["record"]
        if not rec:
            continue
        name = rec.get("config", {}).get("name")
        if not name:
            continue
        cur = best.get(name)
        if cur is None:
            best[name] = entry
            continue
        key = (entry["summary"] is not None, entry["run_id"])
        cur_key = (cur["summary"] is not None, cur["run_id"])
        if key > cur_key:
            best[name] = entry
    return best


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
    return f"\\pending{{{desc}}}", ""


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


def rehearsal_baselines(frozen):
    """{member_norm: {top1, ci, run_id, set, format}} from rehearsal passes."""
    out = {}
    for sha, summary in frozen:
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

def table_main(anchors, fdev, ffull, frozen, ledger):
    ceil = anchors["ceilings"]
    rows = [
        r"\begin{tabular}{lccccc}",
        r"\toprule",
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

    # F-full row: dev cells never quoted (trained on the dev sets).
    ffull_cells = [r"DraftFM (F-full, zero-shot)"]
    ffull_cells += [r"--", r"--", r"--", r"--"]
    m = msh_expert(frozen, "F-full")
    ffull_cells.append(cell(m["top1"], m["ci"], m["run_id"]) if m
                       else pending("eval"))
    rows.append(ffull_cells)
    rows.append(r"\midrule")

    # Ceiling row (per-set models trained on the target set).
    ceil_cells = [r"Per-set ceiling"]
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
    ratio_cells = [r"\quad F-dev / ceiling (unaligned)"]
    if len(dev_vals) == 3:
        ratios = [d / c for d, c in zip(dev_vals, ceil_vals)]
        for r in ratios:
            ratio_cells.append((f"{r:.3f}", ""))
        ratio_cells.append((f"{sum(ratios) / 3:.3f}", ""))
    else:
        ratio_cells += [pending("ratio")] * 4
    ratio_cells.append(pending("post-T0"))
    rows.append(ratio_cells)

    rows += [r"\bottomrule", r"\end{tabular}"]
    return emit_rows(rows)


def table_baselines(anchors, frozen):
    reh = rehearsal_baselines(frozen)
    pub = anchors["published"]
    rows = [
        r"\begin{tabular}{llll}",
        r"\toprule",
        r"Method & Information used & Test set & Expert top-1 (\%) \\",
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
            else pending("post-T0")
        rows.append([label + r"$^{*}$", "post-release statistics", "MSH", c])
    rows.append(r"\midrule")

    def published(key):
        p = pub[key]
        star = "$^{*}$" if "asterisk" in p else ""
        label = f"{p['label']}{star}~\\citep{{{p['cite']}}}"
        if "top1" in p:
            val = (pct(p["top1"]), "")
        else:
            val = (f"{pct(p['top1_lo'])}--{pct(p['top1_hi'])}", "")
        return [label, p["info"], p["test_set"], val]

    rows.append(published("ward_draftsimbot"))
    rows.append(published("urzagpt_gpt4o"))
    rows.append(published("bertram_features_only_unseen"))
    rows.append(published("bertram_bro_zeroshot"))
    rows += [r"\bottomrule", r"\end{tabular}"]
    return emit_rows(rows)


def table_ablations(by_name, frozen):
    members = [
        ("Full (F-dev recipe)", "f_dev", "F-dev"),
        ("A-notext (no text embedding)", None, "A-notext"),
        ("A-noUB (LTR/FIN/TLA removed)", None, "A-noUB"),
    ]
    # Ablation runs are discovered by config-name convention.
    for name, entry in by_name.items():
        if "notext" in name:
            members[1] = (members[1][0], name, members[1][2])
        if "noub" in name:
            members[2] = (members[2][0], name, members[2][2])

    rows = [
        r"\begin{tabular}{lccccc}",
        r"\toprule",
        r"Variant & BRO & TMT & SOS & Dev mean & MSH \\",
        r"\midrule",
    ]
    for label, cfg_name, member in members:
        entry = by_name.get(cfg_name) if cfg_name else None
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


def table_scaling(by_name, frozen, ledger):
    rows = [
        r"\begin{tabular}{l p{4.8cm} rrrc}",
        r"\toprule",
        r"Rung & Sets & \#sets & Train picks (M) & Best step "
        r"& Dev-mean top-1 (\%) \\",
        r"\midrule",
    ]
    curve = []
    for rung, cfg_name, sets in RUNGS:
        entry = by_name.get(cfg_name)
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


def numbers_macros(anchors, fdev, frozen):
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
        ratios = [d / ceil[s]["top1"] for d, s in zip(dev_vals, DEV_SETS)]
        for s, r in zip(DEV_SETS, ratios):
            macro(f"Ratio{s.title()}", f"{100 * r:.1f}")
        macro("RatioDevMean", f"{100 * sum(ratios) / 3:.1f}")

    reh = rehearsal_baselines(frozen)
    for member, name in [("baseline-random", "BaseRandom"),
                         ("baseline-rarity", "BaseRarity")]:
        b = reh.get(norm_member(member))
        if b:
            macro(name, pct(b["top1"]), b["run_id"])
        else:
            macro(name, f"\\pending{{{member}}}")

    m = msh_expert(frozen, "F-full")
    macro("FfullMsh", cell(m["top1"], m["ci"], None)[0] if m
          else "\\pending{F-full MSH top-1}",
          m["run_id"] if m else None)
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
    by_name = runs_by_config_name(runs)
    fdev = by_name.get("f_dev")
    ffull = by_name.get("f_full")

    tables = repo / "paper" / "tables"
    write_table(tables / "main_results.tex",
                table_main(anchors, fdev, ffull, frozen, ledger),
                "Main results: expert-slice deployment-mode top-1 (95% "
                "cluster-bootstrap CIs over drafts).")
    write_table(tables / "baselines.tex", table_baselines(anchors, frozen),
                "Hour-0/post-release baselines and published anchors. "
                "* = post-release or non-day-1 information.")
    write_table(tables / "ablations.tex", table_ablations(by_name, frozen),
                "Pre-registered ablations (protocol section 5).")
    scaling_rows, curve = table_scaling(by_name, frozen, ledger)
    write_table(tables / "scaling.tex", scaling_rows,
                "Scaling ladder (protocol section 4.3). Rung labels are "
                "frozen identifiers; counts come from run records.")
    write_table(tables / "numbers.tex",
                numbers_macros(anchors, fdev, frozen),
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

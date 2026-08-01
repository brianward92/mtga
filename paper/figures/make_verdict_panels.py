#!/usr/bin/env python3
"""Compute the real, live-scored numbers shown in the paper's "verdict
panel" mockup figures (fig:teaser, fig:bro-tierlist, fig:closecall) and emit
them as LaTeX macros -- same "no hand-typed numbers" discipline as
scripts/make_paper_tables.py.

These panels illustrate the deployed pick-scoring *interface*
(electron/renderer/overlay/) on public development-set cards (BRO and SOS
-- never MSH). Example packs are illustrative card lists; the script does
not recover their provenance from draft logs. The numbers use the same code path the live
overlay uses: mtga.models.registry.resolve() to get the per-set scoring
model, then model.score_pack() for a live pack score, or
mtga.draft_api.HUB.p1p1() for the tier-list (whole-set) percentile view.
Conviction bands (flames/labels/dominance) reuse the exact thresholds in
electron/renderer/overlay/conviction.py -- reimplemented here in Python
since that logic is TypeScript; see conviction.ts / flames.ts for the
canonical version this mirrors.

This is a display of the shipped per-set scoring model (the same model
family behind Table 1's within-set supervised-reference row), not the paper's frozen
zero-shot checkpoint -- see the caption text in each figure. Running this
script requires the local per-set model artifacts backing the live
overlay (same requirement as make_paper_tables.py needing local run
records); it is not run as part of `tectonic draftfm.tex`.

Usage:
    python3 figures/make_verdict_panels.py
"""

import math
from pathlib import Path

from mtga.draft_api import HUB
from mtga.models import registry

HERE = Path(__file__).resolve().parent
OUT = HERE / "verdict_numbers.tex"


def sigmoid(x):
    return 1.0 / (1.0 + math.exp(-x))


def format_ev(v):
    return f"{v:.2f}" if abs(v) < 10 else f"{v:.1f}"


def format_pct(fraction_0_1):
    pct = round(fraction_0_1 * 100)
    return ">99" if pct >= 100 else str(pct)


def format_winrate(frac):
    return f"{100 * frac:.1f}"


def rank_by_name(cards):
    return {info["name"]: grp for grp, info in cards.items()}


_LATEX_SPECIAL = str.maketrans({
    "&": r"\&", "%": r"\%", "$": r"\$", "#": r"\#",
    "_": r"\_", "{": r"\{", "}": r"\}",
})


def tex_escape(name):
    """Card names go straight into \\newcommand macro bodies -- escape the
    handful of LaTeX-special characters real card names actually contain
    (e.g. "Don & Leo, Problem Solvers")."""
    return name.translate(_LATEX_SPECIAL)


def p1p1_percentile(table, ev):
    vals = sorted(v for v in table.values() if v is not None)
    below = sum(1 for v in vals if v < ev)
    return 100.0 * below / len(vals)


def hero_panel(lines):
    """SOS P1P1, empty pool: Emeritus against an illustrative 13-card pack."""
    model = registry.resolve("SOS", "PremierDraft")
    cards = HUB.cards("SOS")
    name_to_grp = rank_by_name(cards)
    pack_names = [
        "Bogwater Lumaret", "Deluge Virtuoso", "Elemental Mascot",
        "Emeritus of Ideation", "Expressive Firedancer", "Fractal Anomaly",
        "Glorious Decay", "Island", "Lumaret's Favor", "Masterful Flourish",
        "Quandrix Charm", "Royal Treatment", "Shattered Acolyte",
    ]
    pack_grp = [name_to_grp[n] for n in pack_names]
    scores = {s.grp_id: s.ev for s in model.score_pack(pack_grp, [])}
    ranked = sorted(scores.items(), key=lambda kv: -kv[1])
    (top_grp, top_ev), (r1_grp, r1_ev), (r2_grp, r2_ev) = ranked[:3]
    dominance = sigmoid(top_ev - r1_ev)
    runner1_vs_top = sigmoid(r1_ev - top_ev)
    runner2_vs_runner1 = sigmoid(r2_ev - r1_ev)

    table = HUB.p1p1("SOS", "PremierDraft", model)
    pct = p1p1_percentile(table, top_ev)

    stats = HUB.stats("SOS", "PremierDraft")["stats"]["Emeritus of Ideation"]

    lines += [
        r"\newcommand{\VHeroEv}{%s}" % format_ev(top_ev),
        r"\newcommand{\VHeroDominance}{%s\%%}" % format_pct(dominance),
        r"\newcommand{\VHeroPercentile}{%.1f}" % pct,
        r"\newcommand{\VHeroGih}{%s\%%}" % format_winrate(stats["gih_wr"]),
        r"\newcommand{\VHeroAlsa}{%.1f}" % stats["alsa"],
        r"\newcommand{\VHeroRunnerOneName}{%s}" % tex_escape(cards[r1_grp]["name"]),
        r"\newcommand{\VHeroRunnerOnePct}{%s}" % format_pct(runner1_vs_top),
        r"\newcommand{\VHeroRunnerTwoName}{%s}" % tex_escape(cards[r2_grp]["name"]),
        r"\newcommand{\VHeroRunnerTwoPct}{%s}" % format_pct(runner2_vs_runner1),
        r"\newcommand{\VHeroModelVersion}{%s}"
        % model.model_id.split("/")[-1],
    ]
    print(f"hero: top={cards[top_grp]['name']} ev={top_ev:.3f} "
          f"dominance={dominance:.4f} pct={pct:.1f}")


def bro_tierlist_panel(lines):
    """BRO whole-set P1P1 tier list: Steel Seraph, real percentile flames."""
    model = registry.resolve("BRO", "PremierDraft")
    cards = HUB.cards("BRO")
    table = HUB.p1p1("BRO", "PremierDraft", model)
    name_to_grp = rank_by_name(cards)

    top_name = "Steel Seraph"
    runner_names = ["Skystrike Officer", "Tyrant of Kher Ridges"]

    top_ev = table[name_to_grp[top_name]]
    top_pct = p1p1_percentile(table, top_ev)
    runner_pcts = [p1p1_percentile(table, table[name_to_grp[n]])
                   for n in runner_names]

    lines += [
        r"\newcommand{\VBroEv}{%s}" % format_ev(top_ev),
        r"\newcommand{\VBroPercentile}{%.1f}" % top_pct,
        r"\newcommand{\VBroRunnerOneName}{%s}" % tex_escape(runner_names[0]),
        r"\newcommand{\VBroRunnerOnePercentile}{%.1f}" % runner_pcts[0],
        r"\newcommand{\VBroRunnerTwoName}{%s}" % tex_escape(runner_names[1]),
        r"\newcommand{\VBroRunnerTwoPercentile}{%.1f}" % runner_pcts[1],
        r"\newcommand{\VBroModelVersion}{%s}" % model.model_id.split("/")[-1],
    ]
    print(f"bro tier list: top={top_name} ev={top_ev:.3f} pct={top_pct:.1f} "
          f"runners_pct={runner_pcts}")


def close_call_panel(lines):
    """SOS P1P1 in an illustrative 13-card pack whose top two are tied."""
    model = registry.resolve("SOS", "PremierDraft")
    cards = HUB.cards("SOS")
    name_to_grp = rank_by_name(cards)
    pack_names = [
        "Sundering Archaic", "Flow State", "Pursue the Past",
        "Inkshape Demonstrator", "Killian's Confidence", "Feed the Swarm",
        "Shared Roots", "Lluwen, Exchange Student", "Rubble Rouser",
        "Knockout Maneuver", "Teacher's Pest", "Forum Necroscribe",
        "Abigale, Poet Laureate",
    ]
    pack_grp = [name_to_grp[n] for n in pack_names]
    scores = {s.grp_id: s.ev for s in model.score_pack(pack_grp, [])}
    ranked = sorted(scores.items(), key=lambda kv: -kv[1])
    (a_grp, a_ev), (b_grp, b_ev), (c_grp, c_ev) = ranked[:3]
    dominance = sigmoid(a_ev - b_ev)
    split_a = round(dominance * 100)
    split_b = 100 - split_a
    runner_pct = round(sigmoid(c_ev - b_ev) * 100)

    lines += [
        r"\newcommand{\VCCNameA}{%s}" % tex_escape(cards[a_grp]["name"]),
        r"\newcommand{\VCCNameB}{%s}" % tex_escape(cards[b_grp]["name"]),
        r"\newcommand{\VCCEvA}{%s}" % format_ev(a_ev),
        r"\newcommand{\VCCEvB}{%s}" % format_ev(b_ev),
        r"\newcommand{\VCCSplitA}{%d}" % split_a,
        r"\newcommand{\VCCSplitB}{%d}" % split_b,
        r"\newcommand{\VCCRunnerName}{%s}" % tex_escape(cards[c_grp]["name"]),
        r"\newcommand{\VCCRunnerPct}{%d}" % runner_pct,
        r"\newcommand{\VCCModelVersion}{%s}" % model.model_id.split("/")[-1],
    ]
    print(f"close call: {cards[a_grp]['name']}={a_ev:.3f} vs "
          f"{cards[b_grp]['name']}={b_ev:.3f} split={split_a}/{split_b}, "
          f"runner={cards[c_grp]['name']}={c_ev:.3f} pct={runner_pct}")


def tmt_tierlist_panel(lines):
    """TMT whole-set P1P1 tier list, same treatment as bro_tierlist_panel --
    TMT is a dev-trio set with its own deployed per-set model."""
    model = registry.resolve("TMT", "PremierDraft")
    cards = HUB.cards("TMT")
    table = HUB.p1p1("TMT", "PremierDraft", model)
    name_to_grp = rank_by_name(cards)

    top_name = "April O'Neil, Hacktivist"
    runner_names = ["Sally Pride, Lioness Leader", "Don & Leo, Problem Solvers"]

    top_ev = table[name_to_grp[top_name]]
    top_pct = p1p1_percentile(table, top_ev)
    runner_pcts = [p1p1_percentile(table, table[name_to_grp[n]])
                   for n in runner_names]

    lines += [
        r"\newcommand{\VTmtEv}{%s}" % format_ev(top_ev),
        r"\newcommand{\VTmtPercentile}{%.1f}" % top_pct,
        r"\newcommand{\VTmtRunnerOneName}{%s}" % tex_escape(runner_names[0]),
        r"\newcommand{\VTmtRunnerOnePercentile}{%.1f}" % runner_pcts[0],
        r"\newcommand{\VTmtRunnerTwoName}{%s}" % tex_escape(runner_names[1]),
        r"\newcommand{\VTmtRunnerTwoPercentile}{%.1f}" % runner_pcts[1],
        r"\newcommand{\VTmtModelVersion}{%s}" % model.model_id.split("/")[-1],
    ]
    print(f"tmt tier list: top={top_name} ev={top_ev:.3f} pct={top_pct:.1f} "
          f"runners_pct={runner_pcts}")


def gallery_panel(lines):
    """Three sets F-full serves zero-shot in production today because they
    have no dedicated per-set model (LTR, LCI, DMU -- all in F-full's
    31-set training corpus, so this is the deployed system's real fallback
    behaviour, not a zero-shot-accuracy claim; the paper's zero-shot
    numbers are the dev-trio/MSH rows only)."""
    picks = [
        ("LTR", "ltr", "Andúril, Flame of the West",
         ["Horn of Gondor", "Orcish Bowmasters"]),
        ("LCI", "lci", "Bonehoard Dracosaur",
         ["Aclazotz, Deepest Betrayal", "Temple of the Dead"]),
        ("DMU", "dmu", "Sheoldred, the Apocalypse",
         ["Sphinx of Clear Skies", "Archangel of Wrath"]),
    ]
    model_version = None
    for set_code, macro_prefix, top_name, runner_names in picks:
        model = registry.resolve(set_code, "PremierDraft")
        model_version = model.model_id.split("/")[-1]
        cards = HUB.cards(set_code)
        table = HUB.p1p1(set_code, "PremierDraft", model)
        name_to_grp = rank_by_name(cards)
        top_ev = table[name_to_grp[top_name]]
        top_pct = p1p1_percentile(table, top_ev)
        runner_pcts = [p1p1_percentile(table, table[name_to_grp[n]])
                       for n in runner_names]
        cap = macro_prefix.capitalize()
        lines += [
            r"\newcommand{\VGal%sEv}{%s}" % (cap, format_ev(top_ev)),
            r"\newcommand{\VGal%sPercentile}{%.1f}" % (cap, top_pct),
            r"\newcommand{\VGal%sRunnerOneName}{%s}" % (cap, tex_escape(runner_names[0])),
            r"\newcommand{\VGal%sRunnerOnePercentile}{%.1f}"
            % (cap, runner_pcts[0]),
            r"\newcommand{\VGal%sRunnerTwoName}{%s}" % (cap, tex_escape(runner_names[1])),
            r"\newcommand{\VGal%sRunnerTwoPercentile}{%.1f}"
            % (cap, runner_pcts[1]),
        ]
        print(f"gallery {set_code}: top={top_name} ev={top_ev:.3f} "
              f"pct={top_pct:.1f} runners_pct={runner_pcts}")
    lines.append(r"\newcommand{\VGalModelVersion}{%s}" % model_version)


def main():
    lines = [
        "% AUTO-GENERATED by figures/make_verdict_panels.py -- do not edit.",
        "% Real, live-scored numbers for the verdict-panel mockup figures",
        "% (fig:teaser, fig:bro-tierlist, fig:closecall, fig:tmt-tierlist,",
        "% fig:gallery). Computed by the deployed scoring model via "
        "mtga.draft_api.HUB / mtga.models.registry -- the same code path "
        "behind the live overlay. BRO/SOS/TMT are dev-trio sets scored by "
        "their own per-set model; LTR/LCI/DMU are training-corpus sets "
        "with no per-set model, scored by F-full (the deployed zero-shot "
        "fallback, not a zero-shot-accuracy claim). MSH is never touched.",
    ]
    hero_panel(lines)
    bro_tierlist_panel(lines)
    close_call_panel(lines)
    tmt_tierlist_panel(lines)
    gallery_panel(lines)
    OUT.write_text("\n".join(lines) + "\n")
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()

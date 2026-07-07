# Adversarial review — DraftFM paper + code (2026-07-06)

Reviewer: adversarial pass for the implementing agent. Method: full read of the paper
(main + companion + all sections/tables) and the numeric/model/eval code, plus an 8-dimension
multi-agent audit (honesty, numbers, literature/SOTA, code-metrics, leakage, stats, analysis
scripts, repro) with every finding adversarially verified against the actual files and, for
literature, against the fetched source papers. 65 findings survived verification; 6 were refuted.

## Top-line assessment

This is a **strong, unusually honest paper** with a genuinely novel contribution: the first
*multi-set, features-only* zero-shot drafting result, a real pre-registration apparatus, and
end-to-end provenance machinery. The core "no set identity" invariant **holds in code**
(`mtga/foundation/model.py` — no set embedding, no per-card parameter; cards enter only as frozen
feature vectors). The internal arithmetic reproduces (ratios, scaling slope 1.037 pp/doubling,
R²=0.98, design-effect 1.4, ECE folds). The zero-shot gate (`EVAL_ONLY={MSH}`) is wired across
many code paths.

The problems are not fabrication. They cluster into five buckets:
1. **Overclaiming** in the abstract/intro/claims-bands that the paper's own table captions already hedge.
2. **Protocol-integrity gaps** — several things the paper says are "frozen at the tag" are not.
3. **A real statistical over-read** in the BRO bonus-sheet analysis (headline effect is ~80% confound).
4. **Transparency/reproducibility** gaps in baselines, calibration, and hard-coded artifact paths.
5. The elephant: **the headline (MSH) result does not exist yet** — this is a pre-registration + dev-set
   paper, and the abstract is written as a completed results paper.

Fixing Tier 1 + Tier 2 below would make this a genuinely publishable, defensible paper once MSH runs.

---

## The pervasive structural issue (read first)

**F-dev and F-full are two different architectures, and the paper's narrative mixes them.**
- `F-dev` = the dev-selection model: **2.2 M params, WITH the set-context tower**, 28 sets, 149.4 M picks.
  It produces the abstract's headline **54.3% / 78.7%**, and *every* analysis number (calibration
  temperature T=1.28, scaling top rung "S27", BRO-transfer, late-retention, ablation baseline, ECE).
- `F-full` = the **shipped** model that runs MSH: **1.6 M params, A-noctx recipe (NO tower)**, 31 sets.
  Its dev-analog is A-noctx at **54.8% / 79.4%**.

So the abstract leads with 54.3/78.7 (a model that is *not shipped*), and the frozen calibration
temperature fit on F-dev (with tower) is applied to the architecturally-different F-full at test time.
This split is disclosed in places but never resolved for the reader. **Recommendation:** pick one
consistent "the model" story. Either (a) make A-noctx/F-full the headline throughout (report 54.8/79.4
in the abstract and redo the analysis on the shipped architecture), or (b) keep F-dev as the "analysis
model" but state explicitly, up front, that all §Analysis numbers characterize the with-tower F-dev and
may not transfer verbatim to the shipped tower-free F-full. This one decision cleans up ~6 findings.

---

## TIER 1 — Must-fix before submission

### T1.1 — Abstract/intro assert cross-set SOTA as fact; the table caption disclaims exactly that [CONFIRMED, high]
**Where:** `paper/main.tex:100-102` (abstract), `paper/sections/intro.tex:40-43`, and pre-registered
Band B `paper/sections/results.tex:173-181`; contradicted by baselines caption `results.tex:123-125`.
**Problem:** Abstract/intro state DraftFM is "above every published approach that is feasible on release
day" / Band B pre-commits to "the strongest published drafter that can exist on release day." But 54.3
is the BRO/TMT/SOS mean, 44.5 is DraftsimBot on **M19**, 43.0 is GPT-4o on **NEO**, 42.8 is the rarity
heuristic on **SOS only**. The baselines caption says verbatim these "situate rather than compare."
So a superiority ranking is asserted flatly in the abstract while the table disclaims it, and the
pre-registration mechanism (Band B) bakes the same cross-test-set claim into the "honesty" device.
**Nuance (from verification):** the claim is scoped to "feasible on release day," so DraftFM being below
Bertram's non-day-one 55.4% on BRO is *not* a literal contradiction — the paper handles Bertram honestly.
The genuine defect is the unhedged cross-*test-set* comparison. One real same-set win exists (rarity 42.8
on SOS vs DraftFM SOS 56.5).
**Fix:** Soften abstract/intro to "situates above the day-one-feasible published numbers we could locate
(measured on different test sets — see Table caption)"; drop "strongest drafter that can exist on release
day" from all three claims-bands in favor of information-regime-scoped, test-set-caveated statements; note
the only like-for-like comparison is rarity/SOS.

### T1.2 — The BRO bonus-sheet "14.8 pp gap" headline is ~80% a pick-depth confound [CONFIRMED, high]
**Where:** `paper/sections/analysis.tex:101-104,113-115`; `scripts/eval_bro_transfer_analysis.py:208-227`.
**Problem:** `bonus_slice_accuracy` compares raw top-1 for packs-with-bonus vs without, with **no control
for pick position**. But `has_bonus` is a near-deterministic proxy for pick depth: 100% at pick 0 →
2.9% at pick 14 (every BRO booster contains exactly one BRR card). Bonus-present picks average pick 4.1
(pack size 10.9); bonus-absent average pick 9.3 (pack size 5.7). Early picks are mechanically hard.
Stratifying by pick position collapses the pooled gap from **0.1485 → 0.0300** — ~80% is confound. The
residual ~3 pp effect contributes only ~1.3 pp of BRO's 8.1 pp shortfall (~16%), **not** "comparable in
size to BRO's entire shortfall." The paper *already* floor-corrects this exact pack-size artifact for the
secondary per-pick curve but not for this headline slice.
**Fix:** Replace the 14.8 pp raw slice with a pick-position-stratified (or floor-lifted) estimate (~3.0 pp);
add `pick_number` stratification to `bonus_slice_accuracy`; delete "the single largest effect found
anywhere in this analysis" and "a gap comparable in size to BRO's entire shortfall"; state that `has_bonus`
is essentially a pick-depth proxy. (Confined to §Analysis prose — not in the abstract/intro/tables.)

### T1.3 — The git tag does not freeze the battery / enforcer / claims-bands, but the paper says it does [CONFIRMED, high]
**Where:** `paper/sections/protocol.tex:8-9` vs `git ls-tree eval-protocol-v1`.
**Problem:** protocol.tex: "The tag fixes the protocol document, the metric implementations, **and the
battery of models to be evaluated**." In fact `experiments/frozen_battery.json`, `scripts/run_frozen_eval.py`,
and all paper files are **not in the tag** (only `docs/eval_protocol.md`, `mtga/foundation/evalproto.py`,
`tests/test_evalproto.py` are protocol-relevant in the tree). The battery file was introduced ~70 min
**after** the tag commit (in `ff37719`, not an ancestor of the tag). `run_frozen_eval` only hashes
`evalproto.py`; **no code binds the battery to the tag**. The winning ablation (a-noctx), a-noUB, and the
calibration block were all added post-tag — the last two are still uncommitted in the working tree.
**Fix (pick one):** (a) commit `frozen_battery.json` + `run_frozen_eval.py` + the claims-band block, re-tag,
and add a `run_frozen_eval` check that hashes the battery against the tagged blob; **or** (b) rewrite
protocol.tex to say the tag freezes the protocol doc + metric code only, and the battery is anchored solely
by per-artifact sha256 + ledger-committed-before-T0 (and note that anchors *individual artifacts*, not the
battery composition/calibration, which remain adjustable until T0).

### T1.4 — "Committed-before-T0" is on the honor system (self-reported JSON timestamp, not git history) [CONFIRMED, high]
**Where:** `scripts/run_frozen_eval.py:120-147` (`ledger_logged_at` / `check_ledger_predates`).
**Problem:** The anti-backdating guarantee — that battery artifacts were committed before the MSH snapshot
existed — is verified against a `logged_at` field *inside the ledger JSON*, which is trivially editable.
Nothing checks git commit timestamps or that the ledger entry is in a commit predating the snapshot ETag.
**Fix:** Verify committed-before-T0 against **git history** (the commit introducing each artifact's ledger
row must predate the snapshot's recorded download time / be an ancestor of the tag), not a self-reported
field. At minimum, disclose in the paper that the temporal guarantee currently rests on the ledger's own
timestamp.

### T1.5 — Baseline numbers (42.8 / 23.2) are not reproducible from the released artifacts [CONFIRMED, high]
**Where:** `paper/tables/numbers.tex:25-26`, `paper/tables/baselines.tex:8-9`.
**Problem:** `make_paper_tables` sources the rarity/random baselines from frozen-eval dir `df6220d8941e`,
which exists **only** under the live root `/opt/bward/...` and is **not git-tracked**. The sole in-repo
rehearsal (`6552b298`) is a *different* run — `TradDraft`, rarity top-1 **0.42679 → 42.7** — so
regenerating from a clean clone yields `\BaseRarity=42.7` and a `SOS TradDraft` label, not the committed
`42.8` / `SOS PremierDraft`. This directly violates the paper's "every number reproducible from released
artifacts" claim (the "typed by hand" clause is technically still true — values are script-emitted).
**Fix:** Mirror the `df6220d8941e` SOS-PremierDraft rehearsal `summary.json` into
`paper/data/frozen_eval/` (as was done for `6552b298`), or repoint to the tracked TradDraft rehearsal and
re-emit. Make the baseline numbers reproducible from git-tracked artifacts.

### T1.6 — The headline (MSH) result does not exist; the abstract is written as a finished paper [CONFIRMED/PLAUSIBLE, medium→treat as blocking]
**Where:** `paper/tables/numbers.tex:27` (`\FfullMsh=\pending`), `paper/main.tex:108`,
`intro.tex:43-44`, `results.tex:146-151`; every MSH table cell is `\pendingcell`.
**Problem:** The abstract's headline sentence literally renders "…is the headline evaluation
(**[PENDING: F-full MSH top-1]** expert top-1)." All secondary MSH metrics (top-3, ECE, log-loss,
retention, skill-conditioning) are `\pending`. This is a pre-registration + dev-set-results paper, but the
title/abstract frame a completed evaluation. Reviewers/readers must not mistake the state.
**Fix:** Until MSH runs, either (a) explicitly retitle/reframe as a pre-registration + dev-set study
("…: A Pre-Registered Zero-Shot Benchmark and Multi-Set Dev-Set Results"), or (b) hold submission until the
frozen eval executes and the `\pending`s resolve. Do not submit with `\pending` in the abstract.

---

## TIER 2 — Should-fix (weakens claims / correctness-adjacent)

### T2.1 — Published anchors are all-users numbers displayed under an "Expert top-1 (%)" column [CONFIRMED, medium]
**Where:** `paper/tables/baselines.tex:6` + rows 14-17; `paper/sections/intro.tex:6-8`;
`related.tex:24-26,48-49`.
**Problem (verified against sources):** GPT-4o 43% (NEO) and Ward 44.5%/48.7% (draftsim general players)
and Bertram 55.44%/33.6% are **all-users / general-player** numbers with no skill filter (Bertram's source:
"does not filter picks by player skill level"). The intro's "48.7–71% agreement with **expert** picks" is
wrong at both endpoints: 48.7 is Ward's general-player NNetBot; 71 is Czerner's `puder` on all-users 17Lands
(the article notes experts are *easier*, scoring 79–83%). Only statisticaldrafting's ~70% is a top-player
number, and that's neither endpoint. Placing all-users numbers under a literal "Expert top-1" header asserts
they're expert-slice measurements.
**Fix:** Rename the column "Top-1 agreement (%)" with a per-row population note; change intro's "expert picks"
→ "human picks"; when comparing to Bertram on BRO, report DraftFM's **all-users** BRO figure (48.4, already
in `numbers.tex`) next to the expert-slice 48.9, and soften "directly comparable" → "same holdout set, but a
different (all-users) pick population." (DraftFM's own expert-vs-all-users gap is small — 48.9 vs 48.4 — so
this is a framing fix, not a large numeric one.)

### T2.2 — The architecture decision ("smaller, better recipe") rests on +0.5 pp inside ~0.5 pp seed noise [CONFIRMED, medium]
**Where:** `paper/main.tex` abstract; `paper/sections/analysis.tex:29-34`.
**Problem:** F-dev 54.3 → A-noctx 54.8 = **+0.50 pp**, almost all from BRO (+1.1); TMT +0.2, SOS +0.1 are
flat. The paper's own measured A-noctx seed spread is **0.46 pp** — and that's in-distribution top-1, not the
zero-shot dev-mean the decision keys on. analysis.tex:33-34 concedes "the full ranking has not been
seed-checked." So a 0.50 pp architecture choice sits inside a 0.46 pp seed band, one seed each, on a
never-seed-checked metric.
**Fix:** Reword abstract/intro to claim only that the tower-free recipe is *smaller and no worse on dev
within seed noise* (the real, defensible win is 1.6 M vs 2.2 M params). Or re-score the 3 existing A-noctx and
F-dev seed checkpoints on the **zero-shot dev-mean** and report a paired-difference CI.

### T2.3 — Ablations caption promises paired-difference CIs that are never computed [CONFIRMED, medium]
**Where:** `paper/sections/analysis.tex:9` (caption) vs `analysis.tex:43-45,78-84`.
**Problem:** Caption: "paired-difference CIs accompany the deltas in the text." `paired_bootstrap_diff` is
only ever called for the zero-shot-vs-ceiling normalized score — **never for any ablation delta**. The VOW
−1.1 pp exclusion is adjudicated against per-cell single-model CIs ("well outside the per-cell CI
half-widths"), not a paired-difference CI; the text-penalty (3.1/1.6/3.4) and UB-penalty (0.8/0.2/1.7)
deltas have no CI at all — and the 0.2 pp TMT UB-penalty is used as a *directional* result well inside noise.
**Fix:** Compute and print `paired_bootstrap_diff` CIs for each quoted delta (VOW, text-penalty, UB-penalty),
or remove the caption sentence and stop calling deltas "well outside" a CI that isn't the difference's CI.
Drop directional language on the 0.2 pp TMT delta.

### T2.4 — Late-draft retention rise is mostly pack-size shrinkage + forced-pick saturation, not pool-tower signal [CONFIRMED, medium]
**Where:** `paper/sections/analysis.tex:188-196`; `scripts/eval_late_draft_retention.py`;
`mtga/foundation/evalproto.py:late_draft_retention`.
**Problem:** Retention = top1(late_zs)/top1(late_ceiling), unaligned, no floor/forced correction. Late picks
(pick≥7) have ~2× the forced-pick rate; forced picks contribute exactly 1.0 to both numerator and
denominator, pulling the ratio toward 1 and above the all-pick ratio. On **genuine** late choices the effect
reverses: BRO zero-shot top-1 with pack_size≥4 late is 0.4536 — *below* its overall 0.4889 (same for TMT/SOS).
So "retains more of the ceiling's accuracy … pool tower carrying real signal" is not supported by this ratio.
**Fix:** Report retention with forced picks excluded (or per-cell floor-lifted, or aligned on identical picks
like `eval_normalized_score.py` does); disclose the late top-1 rise is mainly smaller packs (mean size 4.0–4.5
vs 7.3–8.0). **Keep** "does not collapse to chance late" — that one *is* supported by the forced-excluded,
floor-corrected margin curve (min 20.5/32.5/28.4 pp). Only soften the "retains more / pool-tower signal"
inference.

### T2.5 — Frozen eval never verifies MSH was featurized through the training-time manifest; width mismatch is silently truncated [CONFIRMED, medium]
**Where:** `scripts/run_frozen_eval.py:245-270`; `mtga/foundation/predict.py:66-69`;
`mtga/foundation/train.py:253-263`.
**Problem:** `ensure_shard` featurizes MSH through whatever `FEATURIZER_MANIFEST` is on disk and stores its
hash into `features.npz`, but `run_frozen_eval` **never compares it to the manifest the battery models
trained through** (training records no manifest hash in `record.json`/`best.pt`, and the eval loads the raw
`best.pt`, bypassing the manifest-hash guard that exists on the serving path). Worse, `predict.py:66-69`
**silently truncates** any feature-width mismatch to the model's expected width instead of erroring — so a
rebuilt/mismatched manifest would not crash, it would silently score MSH in the wrong feature space.
**Fix:** Record the featurizer manifest `content_hash` into each training run's `record.json`/checkpoint;
have `run_frozen_eval` assert `MSH features.npz['manifest_hash'] == checkpoint's training manifest hash`;
turn the silent truncation into a hard error except under an explicit no-text-ablation flag.

### T2.6 — "No result number is typed by hand" is false for several key results [CONFIRMED, medium]
**Where:** claimed at `paper/companion.tex:67-68`, `appendix.tex:41-42`; violated at `results.tex:34`,
`analysis.tex:42-43,78-83,99-103,189-190`.
**Problem:** Hardcoded-in-prose numbers with no `numbers.tex` macro (only `%`-comment provenance): aligned
normalized score `74.3/81.3/80.2/78.6`; late retention `81.8/87.8/89.2/86.3`; BRO bonus slice
`40.6/55.5/14.8/44`; A-extras `48.9/57.6/56.0/54.2`; ablation deltas `3.1/1.6/3.4` and `0.8/0.2/1.7`.
**Fix:** Add macros for these to `make_paper_tables.py`/`numbers.tex`, or soften the claim to "the primary
table numbers are script-generated; secondary analysis numbers are cited from run-tagged scripts."

### T2.7 — Battery artifact paths are hard-coded to another machine; the eval can't be reproduced from the release [PLAUSIBLE, medium]
**Where:** `experiments/frozen_battery.json` (`/Users/brianward/…`) vs `run_frozen_eval.py:107-118`.
**Problem:** Every draftfm member path is `/Users/brianward/dat/mtga/foundation/runs/.../best.pt`; this repo
is `/Users/bward/src/mtga`; `fit_dev_temperature.py` and `docs/eval_protocol.md` use a **third** root
`/opt/bward/…`. `check_artifact_sha()` calls `Path(path).is_file()` and raises before checking sha256, so on
any box but n42 the enforcer refuses — and a third party must *edit the (untagged) battery file* the
tamper-evidence story depends on.
**Fix:** Store battery artifacts by content-addressed relative path (`weights/<sha256>.pt` resolved against a
`DATA_ROOT` env var), verify sha256 first (never existence-at-a-fixed-path), and reconcile the three
namespaces to one documented root.

### T2.8 — Calibration-temperature provenance is shaky and cross-architecture [CONFIRMED/PLAUSIBLE, medium]
**Where:** `experiments/frozen_battery.json:5-14`; `scripts/run_frozen_eval.py:293-311`;
`scripts/fit_dev_temperature.py`.
**Problem (cluster):** (a) T=1.28 is fit on **F-dev** (with tower) and applied to **F-full** (no tower) to
produce the only true held-out MSH calibration numbers — and F-full has no clean held-out set to fit its own,
so this may be unavoidable, but it's undisclosed. (b) Temperature is threaded **only** to draftfm members;
the internal `report.md` mixes DraftFM@T=1.28 with ceiling/baselines@T=1.0 (the *paper* avoids this — it
compares at T=1 — so this is an internal-report issue, but fix before it leaks into the MSH tables). (c)
Human-mode reuses the deployment-condition-fit T. (d) T was computed from an **ONNX stand-in** because the
sha256-pinned `best.pt` was missing on the fit machine (`fit_dev_temperature.py:39-57,308-313`).
**Fix:** When the pending MSH ECE lands, state explicitly that F-full's MSH ECE uses a temperature calibrated
on the different-architecture F-dev; never place DraftFM's T=1.28 ECE/log-loss in the same table as
ceiling/baseline T=1.0 values without flagging; either fit a separate human-mode T or note it reuses the
deployment T; and reconcile the ONNX-vs-`best.pt` fit provenance (the temperature should be reproducible from
the pinned checkpoint).

### T2.9 — Scaling "returns have not started saturating" over-reads 6 error-bar-free points whose top rung is the dev-selected model [PLAUSIBLE, medium]
**Where:** `paper/sections/results.tex:218-257`; intro contribution bullet `intro.tex:59-61`.
**Problem:** R²=0.98 on n=6 nested points is not evidence of log-linearity, and the top rung *is* F-dev (the
model selected on this very axis). The intro/abstract advertise "seed and set-composition variance" as if the
curve has error bands, but results.tex:249-254 explicitly says the extra seeds are within-training top-1 and
**cannot** be error bands on the zero-shot dev-mean plotted. The paper's own hedge ("6 points cannot rule out
a knee") is good — but the affirmative "log-linear returns … have not started saturating" leans harder than
6 points support.
**Fix:** Downgrade to "no diminishing returns are *visible* over the tested 2 orders of magnitude"; remove or
qualify the "with seed and set-composition variance" phrasing in the intro/abstract so it doesn't imply error
bands the figure lacks; ideally re-score the existing S1/S4 extra-seed checkpoints on the zero-shot dev-mean
to give real bands (the paper flags this as `\pending` — it's the highest-value missing analysis).

---

## TIER 3 — Consistency / polish (fast, high-signal-per-effort)

- **T3.1 — `S27` label but 28 sets [CONFIRMED].** The top scaling rung is labeled `S27` everywhere
  (`scaling.tex:15`, `scaling_data.json`, `scaling_curve.py:30`, `make_paper_tables.py:47,472`,
  `frozen_battery.json:45`, `docs/eval_protocol.md:119`) but reports `n_sets=28`, and protocol.tex:87 says the
  rung is "28 training sets." Stale from a 30-set-corpus era. **Fix:** rename the rung `S28` (or `Sfull`)
  consistently, or add a one-line note that "S27" is a frozen identifier and the count is 28.

- **T3.2 — `\RatioDevMean` = 78.7 is undefined/inconsistent [CONFIRMED].** 78.7 is the mean-of-per-set-ratios;
  dev-mean/ceiling-mean = 78.8; the main-results ratio-row "Dev mean" cell shows 0.787 while 54.3/68.9 = 0.788;
  and the *pre-registered* metric is the aligned normalized score (78.6). Three near-equal aggregates are used
  interchangeably. **Fix:** define which aggregate `\RatioDevMean` is (in `make_paper_tables.py`), use it
  consistently, and lead with the pre-registered aligned score (78.6) since that's what the protocol committed to.

- **T3.3 — Bertram anchor quoted at two precisions [CONFIRMED].** Prose "55.44%" (`results.tex:42,46`;
  bands 176,185) vs table "55.4" (`baselines.tex:17`). Pick one.

- **T3.4 — Wall-time misattribution [CONFIRMED].** Abstract statbox (`main.tex:117`) attributes F-full's
  2.1 h to "the shipped recipe (A-noctx)," but the A-noctx *run itself* took 4.3 h. Use the right number for
  the entity named, or name the entity whose time it is.

- **T3.5 — "391 structured dims" overstates capacity; keyword count comment wrong [CONFIRMED].**
  `featurize.py:46-47` — 25 of 166 keyword slots are structurally always zero, and the comment misstates the
  count vs method.tex:14-16. **Fix:** correct the comment; optionally note effective (non-degenerate) dim.

- **T3.6 — `EVAL_ONLY` ban is case-fragile in the featurizer build path [CONFIRMED].**
  `scripts/build_card_features.py:94,99-103` + `featurize.py:431` only avoid banning MSH because of glob
  case-sensitivity; `corpus_jobs` upper-cases but this path doesn't. **Fix:** normalize case before the
  EVAL_ONLY membership check here too (defense-in-depth the paper leans on).

- **T3.7 — ECE / log-loss lack a non-forced variant [PLAUSIBLE].** Forced picks (~7.1%) contribute exactly 0
  to log-loss and |acc−conf|=0 to ECE for every model at every T, deflating both absolute numbers
  (`evalproto.py:72-96`; `summarize` reports `top1_non_forced` but no `ece_non_forced`/`log_loss_non_forced`).
  Not a conclusion-invalidating error (ceiling anchors are also forced-in, so *comparisons* are matched), but
  a transparency gap. **Fix:** add `ece_non_forced`/`log_loss_non_forced` rows to `summarize()`.

- **T3.8 — `summarize()` docstring over-promises [CONFIRMED].** "Every number carries a bootstrap CI" but ECE
  is a bare point estimate (`evalproto.py:221` vs 226-229). Fix docstring or add an ECE CI.

- **T3.9 — Featurizer vocab is fit on the full 31-set corpus incl. the dev trio [PLAUSIBLE, low].**
  `method.tex:21-25`'s "a registry gate refuses to fit vocabularies on the held-out set" is true only for MSH;
  the dev trio's cards *were* counted when choosing the top-128 subtype / keyword slots. Second-order, and
  data.tex already reserves feature-space blindness for MSH — but add a one-clause cross-reference so a reader
  doesn't infer the dev-trio eval used a dev-blind vocab. (Do **not** bother with a leave-3-out re-featurize.)

- **T3.10 — "Unseen set" ≠ "unseen cards" [PLAUSIBLE, low].** BRO 7.5% / TMT 6.5% / SOS 16.2% of pack cards
  are reprints present in F-dev's training corpus (mostly ordinary base-set reprints + basics, *not* the SPG
  bonus sheet — that part of the original finding was a misdiagnosis). **Benign** given no per-card/set-identity
  params (a reprint confers no memorization advantage over a novel card with identical features — it's in-contract
  under the paper's zero-shot definition). Optional: one sentence in data.tex noting the card-level overlap so
  "unseen set" isn't read as "unseen cards."

- **T3.11 — `mask_self_names` uses case-sensitive plain substring replace [PLAUSIBLE, nit].**
  `textemb.py:56-59` can over-mask (a card named "Fire" nuking "Fire" inside other words) and miss cased/
  possessive self-references. Low impact but worth a word-boundary / case-aware pass, especially for licensed sets.

- **T3.12 — float32 storage rounds confident probs to exactly 1.0 [PLAUSIBLE, nit].** `predict.py:89-91,114-115`
  → mild extra deflation of log-loss/ECE. Store pick_prob/top_prob as float64 if calibration numbers matter.

- **T3.13 — Calibration prose mislabels the ECE-optimal T as "not better" [PLAUSIBLE, nit].**
  `analysis.tex:159-176`: the chosen T=1.28 (log-loss argmin) gives ECE 0.025; the ECE-argmin T=1.40 gives
  0.0133 (~2× lower). The comment calling it "close to, not better than" is factually wrong on ECE. Keep the
  principled choice (proper scoring rule), but state honestly that it leaves ~2× ECE on the table.

- **T3.14 — `docs/eval_protocol.md` battery disagrees with `frozen_battery.json` [PLAUSIBLE, low].** Reconcile
  the pre-registered §4 battery (extra ablations scored on MSH; promised baselines/ceiling) with the actual
  members list; and tighten the claims-band boundaries around 55/55.44 so a near-boundary MSH number can't
  trigger a band whose text is factually false (`results.tex:159-193`).

- **T3.15 — Claims-band selection is an unenforced manual comment-toggle [PLAUSIBLE, low].** The three BAND
  paragraphs are hand-uncommented and aren't frozen at the tag. Add a script that selects the band from the
  frozen number (and commits the choice), so the "interpretation out of our own hands" claim is mechanized.

- **T3.16 — Protocol CI half-width "~±0.3 pp" omits the design effect it's derived from [CONFIRMED, low].**
  `protocol.tex:70-72` — should be ~0.36 pp given the stated design effect 1.4. Minor, but the protocol section
  is where precision matters most.

---

## What's solid (don't waste effort re-checking)

- **Core invariant holds in code:** no set embedding, no per-card params (`model.py`); A-noctx's only
  set-relative signals are pool tower + candidate features + 4 set-shape scalars — matches the paper.
- **Internal arithmetic reproduces:** per-set ratios 74.5/81.0/80.5, dev-mean 54.3, scaling slope
  1.037 pp/doubling & R²=0.98 (`analyze_scaling_shape.py` reproduces exactly), design-effect 1.4, ECE folds.
- **Literature numbers are real** (verified against fetched sources): Bertram 2024 Table II features-only
  single-set = 33.57% (matches "33.6–35.6"), Random 23.79; 55.44% on BRO; GPT-4o 43% on NEO; Ward 44.5/48.7/22.
  The *values* are right — the issue is population labeling (T2.1), not fabrication.
- **Zero-shot gate is genuinely wired** across corpus/featurize/manifest/replay/eval paths (`EVAL_ONLY={MSH}`).
- **Bootstrap machinery** (cluster over drafts, paired shared-resample, ICC) is correctly implemented.
- **6 findings were adversarially refuted** and correctly dropped (e.g., the rank-tie convention doesn't
  manifest on real data; "five-to-seven-fold" ECE phrasing is fine; "only published result" matches HEAD).

## Highest-value *additions* (not fixes — new work)

1. **Run the frozen MSH eval.** Everything hinges on it; the paper is a shell until `\FfullMsh` resolves.
2. **Zero-shot dev-mean error bands** from the existing S1/S4 (+A-noctx/F-dev) seed checkpoints (the paper's own
   top `\pending`) — turns T2.2 and T2.9 from hand-waves into measured claims.
3. **A per-set-trained MSH ceiling + a "features-only single-set" DraftFM on a dev set** to make the Bertram
   comparison genuinely same-metric (T2.1), not just same-set.

---

### Suggested implementation order
Tier 1 (T1.1–T1.6) → the MSH run + seed-band additions → Tier 2 → Tier 3 sweep (mostly mechanical, ~1 pass).
Tier 1.1/1.2/1.6 and T2.1 are the ones a reviewer would reject over; the rest strengthen an already-careful paper.

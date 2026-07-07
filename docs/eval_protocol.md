# DraftFM Evaluation Protocol (eval-protocol-v1)

**Status: FROZEN at git tag `eval-protocol-v1`.** This document pre-registers
the evaluation of DraftFM, a cross-set draft model evaluated zero-shot on a
set whose human pick data it has never touched. After the tag: MSH numbers
are what they are. Any second evaluation round requires a new tag
(`eval-protocol-v2`) and public disclosure of the total number of rounds.
The metric implementations live in `mtga/foundation/evalproto.py`
(unit-tested in `tests/test_evalproto.py`); `scripts/run_frozen_eval.py`
refuses to run if that file's content drifts from this tag.

All analysis is computed from cached per-pick **predictions parquets**
(contract at the top of `evalproto.py`) — models are never re-run during
analysis. Every model in the battery gets exactly one inference pass over
the frozen test data.

## 1. Test set: MSH, exactly once

- **Definition:** `draft_data_public.MSH.PremierDraft.csv.gz`, the first S3
  snapshot successfully downloaded on/after publication (~2026-07-07),
  frozen immediately by sha256 + S3 ETag in `data_manifest.json` and never
  re-downloaded over. TradDraft same-day snapshot frozen for the appendix,
  if published.
- **Quarantine:** until the frozen eval has run, no training, tuning,
  metric-peeking, or feature-manifest fitting may read MSH pick data
  (`mtga/lands/corpus.py: EVAL_ONLY`). MSH **card features** (Scryfall) are
  legal — that is the zero-shot contract: public card information only.
- **Populations:**
  - *Expert slice (headline):* `wr_bucket >= 0.55 AND n_games_bucket >= 100`
    — identical to the per-set model's filter, so ceiling comparisons are
    apples-to-apples.
  - *All-users slice (secondary):* every valid pick.
- **Conditioning (two pre-registered forward configs):**
  1. *Deployment mode (headline):* condition on the fixed top skill bucket
     selected on dev sets and recorded in `experiments/frozen_battery.json`.
  2. *Human-model mode:* condition on each drafter's true bucket, scored on
     the all-users slice.
- **Forced picks** (`pack_size == 1`, last pick of each pack) are INCLUDED
  in headline numbers (anchor consistency); `pack_size >= 2` variants are
  secondary rows. `pack_size` counts distinct candidate slots.
- **Quality gates at T0** (all must pass before eval): modern schema;
  PremierDraft rows present; **>= 2,500 expert-slice drafts**; >= 99% of
  pack-card names join to card features; P1P1 presence recorded (absence is
  an annotation, not a failure). On volume failure: wait exactly one
  snapshot cycle (single pre-declared contingency).
- **Execution:** `run_frozen_eval.py` within 72h of gates passing. It
  verifies (a) `evalproto.py` matches this tag, (b) every battery artifact
  sha256 was ledger-committed before the T0 download timestamp.

## 2. Dev discipline: all selection on {BRO, TMT, SOS}

One dev-foundation run (**F-dev**: universe minus {BRO, TMT, SOS, MSH})
yields zero-shot numbers on the three dev sets. Every architecture,
hyperparameter, text-encoder, and conditioning decision keys on the
**unweighted mean over the 3 dev sets of expert-slice deployment-mode
top-1** (tie-break: mean log-loss). Rationale for the trio: BRO is the same
holdout as the only published zero-shot number (Bertram 55.44%,
features+meta+image — meta being post-release stats); SOS has our mature
per-set ceiling (0.70215 reproduced below); TMT is the Universes Beyond
rehearsal for Marvel (licensed names, flavor-heavy text, P1P1-missing).
Early stopping uses within-training-set validation splits only — never dev
metrics — so the scaling curve stays honest.

Within-set splits: `zlib.crc32(draft_id) % 1000 < 50` -> val (the existing,
tested convention). Zero-shot models are scored on the full slice of a
held-out set; head-to-head rows against a per-set ceiling use the ceiling's
val split so both models score identical picks (`evalproto.align_on_picks`).

## 3. Metrics (all from `evalproto.py`)

- **Primary:** top-1 agreement, expert slice, deployment mode.
- Secondary: top-3; all-users top-1 (human-model mode); **normalized score**
  = zero-shot top-1 / per-set-ceiling top-1 on identical picks; mean
  log-loss (nats/pick); top-label **ECE, 15 equal-mass bins** (no post-hoc
  temperature on MSH; optional temperature fit on dev only, frozen into the
  battery config); per-(pack, pick) curves vs the per-cell random floor;
  **late-draft retention** = zero-shot/ceiling top-1 on picks 8+ of each
  pack; non-forced (`pack_size >= 2`) top-1, log-loss, and ECE variants
  (forced picks are scored trivially and deflate calibration).
- **Statistics:** cluster bootstrap over `draft_id` (B=2000,
  seed=20260707, percentile 95% CIs) on top-1, top-3, and log-loss; ECE and
  the non-forced variants are reported as point estimates (the binned ECE is
  not bootstrapped). Paired comparisons share resample indices
  (`paired_bootstrap_diff`). Design effect grounded empirically:
  **measured ICC rho = 0.0099** on SOS per-set val (1,662 drafts, 69,803
  picks) => DEFF ~= 1.4 at ~42 picks/draft; the 2,500-expert-draft gate
  gives CI half-widths ~= +/-0.3pp at p~=0.5, tighter than the design
  requirement.
- Seed variance: 3 seeds at scaling rungs S1 and S4; set-composition
  variance via probe rungs S2b/S4b. Reported as bands.

### Protocol validation (completed before tagging)

The pipeline (per-set ONNX model -> predictions parquet -> evalproto)
reproduces the published-anchor SOS number exactly:

| quantity | value |
|---|---|
| top-1 (expert val, incl. forced) | **0.70215** (CI 0.6980–0.7062) |
| top-3 | 0.95161 (CI 0.9496–0.9535) |
| top-1 non-forced | 0.67924 |
| log-loss | 0.7836 nats | 
| ECE | 0.0141 |
| ICC rho | 0.0099 |

Predictions cached at
`/opt/bward/dat/mtga/foundation/frozen_eval/validation/sos_perset_val.parquet`.

## 4. The pre-registered battery

Frozen (sha256s in `experiments/frozen_battery.json`, committed pre-T0):

1. **F-full** — final recipe, all 31 sets (headline; its dev numbers are
   meaningless and never quoted). *Pre-registered flexibility:* the optional
   extras {Cube-Powered (2.6M picks, 545-card paper pool), VOW-QuickDraft
   (0.4M human picks in bot pods)} join F-full's training data if and only
   if the A-extras dev ablation improves the dev-trio mean; the decision is
   frozen with the battery and reported either way.
2. **F-dev** — universe minus dev trio (the model whose dev numbers appear
   in the paper; doubles as the top scaling rung).
3. **Scaling rungs** S1={NEO}, S2=+DSK, S4=+DMU,FIN, S8=+STX,MOM,BLB,TLA,
   S16=+AFR,SNC,ONE,LTR,WOE,MKM,OTJ,EOE, S27=F-dev universe; probes
   S2b={MOM,TDM}, S4b={STX,SNC,OTJ,TLA}. Fixed recipe, early stop on
   within-train val, shared step cap; both #sets and total-picks reported.
4. **Ablation members** (scored zero-shot on the dev trio; supply the
   ablation-table dev cells). *UB-shift ablations:* A-notext (no oracle-text
   embedding, structured features only), A-noUB (the three licensed-IP sets
   LTR/FIN/TLA removed from A-noctx). *Recipe-search variants* (run during
   architecture/hyperparameter selection, §2, then frozen into the battery so
   they also get an MSH row): A-noctx (no set-context cross-attention — the
   winning recipe that F-full ships), A-proportional (proportional rather than
   sqrt per-set sampling), A-topfilter (train on expert picks only, no skill
   conditioning). All five are listed with sha256s in
   `experiments/frozen_battery.json`.
5. **Baselines:** random; RarityColorHeuristic (hour-0); asterisked
   post-release: HeuristicRatingsModel (day~2 site ratings), ALSA-argmin,
   shrunk-GIH-argmax. Cited: expert-tuned DraftsimBot 44.54% (Ward et al.),
   GPT-4o 43% (UrzaGPT), Bertram 55.44% (features+meta+image, unseen BRO —
   compared against our F-dev BRO row).
6. **Post-day-1 rows (recipes frozen now, executed after the zero-shot
   eval, never iterated):** per-set DraftNet ceiling on the frozen MSH
   snapshot (stock recipe: hidden=[512,512], dropout 0.3, seed 17); F-full
   fine-tuned on the MSH train split (LR/steps/freezing pinned from dev-trio
   rehearsals before T0).

## 5. Universes Beyond shift (pre-registered analysis)

MSH is a licensed-IP set; its names/flavor live in the encoder's
pretraining as comic-universe text. Handling: (a) the featurizer masks
self-names to `~` before embedding (documented in
`featurizer_manifest.json`); (b) the three-way comparison {full, A-notext,
A-noUB} x {SOS, BRO, TMT, MSH} quantifies the UB text penalty with dev
evidence before MSH is seen; (c) framing: UB makes the test *harder and
more credible*; the TMT-vs-SOS dev gap is the quantitative footnote.

## 6. Claims bands (drafted before results exist)

Band boundaries are set to the exact cited priors (44.54%, the expert-tuned
DraftsimBot number; 55.44%, Bertram's features+meta+image BRO number), not
rounded to 45%/55%, so a headline number cannot fall into a boundary dead
zone where the selected band's own cited-number claim would be false.

- **< 44.54%:** negative-leaning result — scale alone does not buy day-1
  competence from features; hand-tuned expert ratings stay unbeaten at hour
  0. Contribution: the frozen benchmark, the first meta-free multi-set
  zero-shot number, the scaling curve.
- **44.54–55.44%:** best published day-1-feasible drafter (beats expert-tuned
  44.5%, GPT-4o 43%, hour-0 heuristics, each measured on a different test
  set — situates rather than compares head-to-head); below the
  meta-inclusive 55.44% with the asterisk paragraph.
- **> 55.44%:** zero-shot SOTA outright with strictly less information than
  the prior best, on a harder (UB) test set; BRO dev row as the
  same-holdout receipt.

Secondary claims in all bands: normalized-vs-ceiling score, scaling-curve
shape, UB-shift analysis, skill-conditioning effect.

## 7. Reproducibility & licensing

Every run appends one line to `experiments/ledger.jsonl`: run_id, host,
git sha, protocol tag, seed, torch version, full config, data manifest
sha256, wall clock, examples/s, artifact sha256s, dev metrics. Paper tables
map cell -> run_id. Released: code, data manifest, weights, predictions
parquets (Zenodo). MSH raw bytes deposited only after a courtesy note to
17Lands. Attribution: "Data from 17Lands.com (CC BY 4.0)"; Scryfall per API
guidelines; WotC Fan Content Policy boilerplate; Marvel names appear only
as data strings in sourced fields.

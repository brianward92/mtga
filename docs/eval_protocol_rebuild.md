# DraftFM rebuild evaluation protocol

Tag: `eval-protocol-rebuild-v1`
Implementation: `scripts/eval_rebuild_dev.py`
Status: development protocol for the 2026-08-08 from-scratch DraftFM rebuild.

## 1. Scope, and how this differs from v0.1

`docs/eval_protocol.md` (tag `eval-protocol-v1.1`) describes a different
experiment: BRO/TMT/SOS were development sets and MSH was a frozen, single-use
test set. That document and its rail (`scripts/run_frozen_eval.py`,
`scripts/eval_draftfm.py`, `mtga/foundation/evalproto.py`) are preserved
unchanged as historical artifacts. They do not describe this rebuild.

In the rebuild, the card-feature manifest and all three width variants were fit
on 29 sets, with **BRO, FDN, and MSH held out as whole-set development
environments**. They are ordinary first-class development sets here: they are
inspected, compared across widths, and used to inform architecture selection.
No set in this protocol is a frozen test set, and no set receives special
handling — a set code is a filter argument and nothing more.

Any claim derived from these three sets must be stated as *development*
evidence. Because these sets inform the width choice, the resulting numbers are
optimistic relative to a never-inspected holdout, and the paper must say so.

This protocol is written before the comparison numbers are produced. Changing a
definition below after seeing results invalidates the comparison.

## 2. Population

Every scored pick in the three development sets — no sampling, no skill filter
applied to the population itself.

| Set | Formats | Picks | Drafts |
|---|---|---|---|
| BRO | PremierDraft, TradDraft | 4,616,619 | 104,676 |
| FDN | PremierDraft, TradDraft | 6,346,832 | 152,968 |
| MSH | PremierDraft | 1,607,786 | 38,580 |
| **Total** | | **12,571,237** | **296,224** |

MSH has no TradDraft shard, so its per-set numbers are PremierDraft-only. Per
(set, format) rows are reported beside the pooled per-set rows so that this
asymmetry is visible rather than buried in an average.

Rows come from the memmapped training store
(`$MTGA_DATA_ROOT/foundation/shards/<SET>.<FORMAT>/`), which is the same store
the training loop reads. Because these sets were never trained on, the
train/val split inside a shard carries no meaning here and is not applied: all
rows are evaluated.

Population identity across models is exact. All widths score the same rows of
the same shards in the same order, so every cross-width comparison is paired.

## 3. Forward path and conditioning

Scoring uses the training/serving forward path unchanged:
`mtga.foundation.train.make_batch` builds the batch, `DraftFM.encode_set` runs
the card encoder once per (set, format), and `DraftFM.forward` scores the pack.
The model is in `eval()` mode (dropout off) under `torch.no_grad()`.

Conditioning is **human mode**: each pick is scored with the drafter's own
observed win-rate and games-played bucket, exactly as training-time validation
does. Deployment-mode conditioning (forcing a top skill bucket) is a serving
question and is out of scope for this rail.

Each pick is scored from its own observed context — the pool the drafter
actually held and the pack they actually saw. Nothing is rolled forward from
the model's own earlier predictions.

Before any scoring the rail verifies, and aborts on mismatch:

1. the on-disk featurizer manifest `content_hash` equals the expected value;
2. every run's `record.json["featurizer_manifest_sha"]` equals it;
3. every checkpoint's embedded `featurizer_manifest_sha` equals it;
4. every `best.pt` SHA-256 equals the `best_sha256` recorded in its
   `record.json`.

The feature width the shard supplies must equal the width the checkpoint
expects. The single legitimate exception inherited from
`mtga/foundation/predict.py` — a structured-only (no-text) model scored against
a structured+text table, a difference of exactly the text-embedding width — is
allowed; any other width delta is refused rather than silently truncated.

## 4. Draft grouping

Bootstrap resampling needs the draft, not the pick, as its sampling unit. The
rebuild data root carries the shard store but not the curated draft parquets,
so the raw `draft_id` string is unavailable and a draft key is **derived** from
the shard itself.

Shard rows preserve the curated scan order, in which a draft's picks are
contiguous and strictly increasing in (pack number, pick number). A new draft
is declared at row `i` when either

- `(pack, pick)` does not strictly increase from row `i-1` (a normal draft
  boundary), or
- `split[i] != split[i-1]`, where `split` is the stored `crc32(draft_id) % 1000`
  (catches a boundary the first rule misses because a truncated draft record
  leaves pick numbers still increasing across it).

Neither rule can split one true draft into two, because within a draft the
pick key increases monotonically and `split` is constant. Two adjacent drafts
merge only if the pick key increases across their boundary *and* they collide
in the 1000-way `split` hash. Measured on the three sets, the first rule alone
misses 376/50/434/59/150 boundaries per shard, so the expected number of
merged drafts is under one per shard against 13k–133k drafts. Verified
segment lengths peak exactly at the full draft length (45 picks for BRO,
42 for FDN and MSH).

This is a documented approximation, and it affects only the width of the
confidence intervals — never a point estimate.

## 5. Metrics

Let `n_options` be the number of real candidates in the pack, and let the
model's `target_rank` be `1 + #{candidates with strictly greater logit}`.

- **Top-1 agreement** (primary): fraction of picks with `target_rank == 1`.
- **Top-3 agreement**: fraction with `target_rank <= 3`.
- **Mean log loss**: `mean(-log p(chosen card))` in nats per pick, probability
  from a softmax over the pack's real candidates, clipped at 1e-12.
- **Top-label ECE**: expected calibration error of the model's own argmax.
  Confidence is the probability of the argmax candidate; accuracy is whether
  that argmax matched the human pick. **15 equal-mass bins** (equal pick count
  per bin, not equal width), weighted by bin size.

Top-1 uses the rank definition, not `argmax`, so that a tie with the human's
card counts as agreement. The two definitions can differ only on exact
floating-point logit ties; the rail measures and reports the disagreement count
as a diagnostic.

## 6. Slices and the forced-pick rule

Each metric is reported on the cross product of:

**Player slice**
- `all` — every drafter.
- `expert` — high win rate *and* high experience. Mirrors the v0.1 definition
  in `mtga/foundation/evalproto.py` exactly: `wr_bucket >= 0.55` and
  `n_games_bucket >= 100`. Buckets are reconstructed from the shard's stored
  ordinal ids (`wr_bucket = wr_id / 50`, missing id 255 becomes NaN and is
  excluded; `n_games_bucket` is the games-bucket value, missing becomes 0 and
  is excluded).

**Forced-pick policy**
- `all_picks` — every pick, including forced ones.
- `non_forced` — `n_options >= 2` only.

A **forced pick** is a pack with exactly one real candidate (`n_options == 1`).
Forced picks are scored trivially: rank is always 1 and probability always 1,
which inflates top-1 and deflates both log loss and ECE. v0.1 kept them in the
headline; this protocol reports both policies side by side and treats neither
as the sole headline.

## 7. Confidence intervals

Percentile **cluster bootstrap with the draft as the resampling unit**,
**B = 1000** resamples, fixed seed, on **every reported metric** — top-1,
top-3, mean log loss, and ECE. Drafts are drawn with replacement, `n` from
`n`, and the statistic is recomputed on the resampled collection of whole
drafts; the 2.5th and 97.5th percentiles form the interval. All four metrics
share the identical resamples, so their intervals are mutually consistent.

The reference implementation is `mtga.foundation.evalproto.cluster_bootstrap`,
which materializes a resampled frame per iteration and is not affordable at
12.6M rows. The rail therefore uses an algebraically identical kernel: because
all three bootstrapped statistics are means over picks, a resample's value is
`sum(per-draft sums) / sum(per-draft counts)` over the drawn draft indices.
Group order (first appearance) and the per-iteration draw
(`rng.integers(0, n, size=n)`) match the reference exactly, and the rail's
self-test asserts the two agree to floating-point tolerance on a subsample
before any full-population number is produced.

ECE needs its own kernel, because a binned statistic is outside the
mean-decomposable family above. Two facts make it affordable. First, the
binned ECE collapses to a difference of sums — a bin contributes
`(n_bin/N) * |mean(correct) - mean(confidence)|`, which is
`|sum(correct) - sum(confidence)| / N` — so only the per-(draft, bin) sum of
`correct - confidence` and the per-draft pick count are needed, and a resample
is a matrix-vector product against the draft multiplicities. Second, the bin
**edges are held fixed** at the full-sample equal-mass values rather than
recomputed per resample.

That fixed-edge choice is the one approximation in the interval machinery. It
isolates sampling variability in the bin statistics instead of also jittering
the boundaries, and recomputing edges per resample costs an O(N) sort-and-scan
per iteration, which is not affordable at 12.6M picks. The ECE **point
estimate is still exactly `evalproto.ece`** — the rail asserts that — and the
self-test measures the CI discrepancy against the literal
`evalproto.cluster_bootstrap(frame, evalproto.ece)` on a subsample, failing if
it exceeds 2e-3 absolute. The measured discrepancy is recorded in
`reports/provenance.json` for every run.

## 8. By-position agreement

Top-1 is reported per `(pack_number, pick_number)` cell beside the **mean
`1 / n_options`** baseline for the same cell — the agreement a uniform-random
picker achieves there. The baseline is a per-cell mean of per-pick reciprocals,
not the reciprocal of a mean pack size. One plot per set shows the three width
curves and the baseline against draft position.

## 9. Efficiency

Parameter count and training wall-clock time are read from each run's
`record.json` (`n_params`, `wall_clock_s`). Evaluation throughput is measured
by this rail as picks scored per second over the full population, wall clock,
including batch assembly and excluding parquet write time, on the device named
in the report.

## 10. Two-phase execution and cache layout

**Phase A (`predict`)** runs each checkpoint once over each (set, format) and
writes one prediction parquet per combination. **Phase B (`report`)** derives
every table, curve, and plot from those cached files and never loads a network.
Re-deriving a summary must not require a GPU.

```
$MTGA_DATA_ROOT/eval_rebuild/
  preds/<model_id>/<SET>.<FORMAT>.parquet   one row per scored pick
  preds/<model_id>/<SET>.<FORMAT>.json      per-file metadata + row/pick counts
  reports/summary.md                        per-set tables, then the mean
  reports/summary.csv                       tidy long-format, one row per cell
  reports/by_pick_<SET>.csv                 per-(pack, pick) curve data
  reports/by_pick_<SET>.png                 per-set plot with the 1/n baseline
  reports/efficiency.csv                    params, wall time, eval picks/sec
  reports/provenance.json                   hashes, git revision, environment
  sanity/sanity_<model_id>.json             harness gate vs training-time val
```

`<model_id>` is the width tag (`d128`, `d256`, `d512`); the full run id is
recorded in the provenance sidecar.

### Prediction parquet columns

One row per scored pick:

| Column | Type | Meaning |
|---|---|---|
| `draft_id` | int32 | derived draft key (§4); clustering unit. Unique within the file; phase B offsets it when pooling formats of one set |
| `pack_number` | int8 | 0-indexed |
| `pick_number` | int8 | 0-indexed |
| `n_options` | int8 | real candidates in the pack |
| `pack_size` | int8 | alias of `n_options`, for the v0.1 evalproto contract |
| `target_rank` | int8 | 1-indexed rank of the human's card |
| `top1` | bool | `target_rank == 1` |
| `top3` | bool | `target_rank <= 3` |
| `pick_prob` | float32 | probability assigned to the human's card |
| `top_prob` | float32 | probability of the model's own argmax |
| `log_loss` | float32 | `-log(pick_prob)`, clipped |
| `wr_bucket` | float32 | drafter win-rate bucket, NaN if unknown |
| `n_games_bucket` | int16 | drafter games-played bucket, 0 if unknown |

Column names are a superset of the v0.1 predictions contract, so these files
can be read by `mtga.foundation.evalproto` without translation.

## 11. Provenance

`reports/provenance.json` records, for every reported number: each checkpoint's
run id and SHA-256, the featurizer manifest content hash, the git revision of
the repository at run time, the torch version and device, and the SHA-256 of
every prediction parquet the report was derived from.

## 12. Presentation rule

Per-set results are presented **first**. The unweighted three-set mean is
printed after them as a summary only. It is not a winner rule: a width that
leads on the mean while losing on a set must have that reversal stated
explicitly, and equal predictive performance at materially lower size and
runtime is a legitimate reason to prefer a smaller width.

## 13. Reproduction

```sh
export MTGA_DATA_ROOT=<rebuild root>

# Phase A: one inference pass per (model, set, format).
python scripts/eval_rebuild_dev.py predict \
    --runs <d128 run dir> <d256 run dir> <d512 run dir> \
    --sets BRO,FDN,MSH --device mps

# Harness self-check against training-time validation (no dev set touched).
python scripts/eval_rebuild_dev.py sanity --run <d512 run dir> --device mps

# Phase B: all tables, curves, and plots from the cached parquets.
python scripts/eval_rebuild_dev.py report
```

Phase A needs torch; Phase B needs only numpy/pandas/pyarrow, plus matplotlib
for the PNG plots (tables and CSVs are still written when matplotlib is
absent, and `--require-plots` makes its absence fatal).

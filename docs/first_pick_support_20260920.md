# Supporting Francesco Lo Franco's FirstPick

Discussion draft, September 20, 2026; artifact status updated September 25. The project is
[francescolofranco-dev/first-pick](https://github.com/francescolofranco-dev/first-pick),
reviewed from a local checkout. This review inspected local
commit `619de1d`; the worktree was clean. No changes to FirstPick, messages to
Francesco, or publication are included.

## The contribution: rankings before set data arrives

FirstPick is a Kotlin/Compose macOS Arena assistant. It already combines
17Lands ratings, pool-aware heuristics, researched set guidance, and per-set
PickNet models. Its training workflow explicitly waits for raw draft data;
it does not train substitutes from aggregate ratings. DraftFM can supply a
prerelease source during that gap.

Start by supplying the FRA ranking as a versioned data package. It is already
computed, includes all 109 uncommons and the associated Special Guests, and
needs no neural inference at runtime for the exact opening-pick policy.
FirstPick can display a DraftFM reference grade in its set guide and, with a
small adapter, rank an opening pack from the same scores. The first release
should identify this as a **prerelease P1P1 forecast**. Its use as a static
reference later in a draft is different from pool-conditioned advice.

The HOB result is useful evidence for this source: 47.34% experienced-player
first-pick agreement, competitive with several archived reviews, with LLU
at 54.33%. Both belong in the explanation. The product should not describe
these as win rates or a guarantee that the recommended card is optimal.

## A concrete data handoff

Existing files ready for review:

- `paper/data/followup_20260920/fra_p1p1_forecast.csv`: 295 unique names,
  raw scores, ranks, grade labels, identity metadata, and basic-land flags.
- `paper/data/followup_20260920/fra_uncommons.csv`: all 109 uncommons.
- `paper/data/followup_20260920/forecast_manifest.json`: checkpoint,
  feature-manifest and source hashes; conditioning inputs; output digest.
- `paper/draftfm_followup.pdf`: the nine-page research draft, including the
  HOB evaluation and FRA preview. The [FRA forecast was published](https://github.com/brianward92/draftfm/releases/tag/fra-p1p1-2026-09-25)
  on September 25, after prerelease events began.

A Kotlin-friendly export can use the following explicit contract rather than
pretending these are 17Lands observations or a PickNet binary:

| Field | Meaning |
|---|---|
| `schema_version` | Data-interface version |
| `set` / `format` | FRA / PremierDraft |
| `source` | DraftFM prerelease forecast |
| `scope` | P1P1, empty pool |
| `generated_at_utc` | Forecast generation time |
| `forecast_sha256` | Exact original CSV digest |
| `conditioning` | Skill, format, position and set-scalar inputs |
| `cards[].name` | Canonical name, with explicit front/back aliases |
| `cards[].score` | Raw forecast logit; used for ordering |
| `cards[].rank` / `letter` | Original rank and set-relative display grade |
| `cards[].display_only_basic` | Excluded from the opening-pick competition |

Names are sufficient for importing the forecast, but an actual Arena pack
also needs verified ID-to-name resolution. Keep alternate printings as aliases
of one identity; include relevant Special Guests and double-faced names.
Unknown offered non-basic cards should make coverage incomplete rather than
silently disappear from the choice set.

## Where it connects in FirstPick

1. **Independent forecast repository.** `PickNetRepository` currently loads
   per-set `.fpnet` weights; `CardRepository` loads 17Lands observations. A small
   `ForecastRepository` can load the versioned ranking without depending on
   either a trained set model or observed game counts. No ONNX dependency is
   needed for this initial static source.
2. **Readiness and card identity.** `DraftViewModel` currently builds pack rows
   only when the ratings repository is loaded. A true day-zero path needs
   forecast readiness and name resolution to work even if the ratings request
   fails. Metadata and draft-event set recognition also need FRA coverage.
3. **Explicit score source.** `PickNetRanker` reorders heuristic-scored cards and
   redistributes their existing 0–100 values. DraftFM logits and percentile
   letters have different meanings. Show the source's own grade/rank and
   alternatives, without treating logits as those heuristic values or as GIH
   percentages. Do not average those scales without a validated mapping.
4. **P1P1 parity.** At pack one, pick one with an empty pool, sorting a completely
   covered pack must reproduce the exact CSV ordering. The existing PickNet
   reranker accepts 80% coverage; the proposed forecast mode should explicitly
   distinguish complete and incomplete packs. Later contextual advice remains
   a separately evaluated policy.

The full DraftFM model could eventually support later picks before set-specific
training is available. That would require runtime integration, frozen feature
assets, pool/position inputs, complete card coverage, and separate validation.
It is materially larger than importing a first-pick ranking and is not required
for the initial contribution.

## HOB is already supported there

FirstPick's `docs/hob-model-validation.md` records a bundled HOB Premier Draft
PickNet with 193 card identities and 68.67% best validation top-1 agreement over
its training workflow's held-out picks. A 25-draft Kotlin runtime check reports
63.6% raw PickNet agreement over 1,050 picks, compared with 47.9% for the heuristic.
These are results recorded by that project, not new measurements in this task.

Those numbers cannot be placed directly beside our 68.15% result: theirs spans
picks throughout drafts under a different split and player population; ours is
an expert P1P1-only, five-fold, 188-value reference. Our new baseline does not
establish an improvement over FirstPick's existing model.

A useful collaboration is a common evaluation harness. Load the bundled PickNet,
score **only drafts excluded from its training**, then restrict every comparator
to the same complete P1P1 packs and player slice. Its training split is
`(java_hash(draft_id) & 0x7fffffff) % 5 == 0`, unlike our CRC32 folds. Preserve
raw PickNet predictions and the app's final guarded recommendations as different
policies. Since the saved checkpoint was selected using validation results,
training exclusion alone does not turn that validation population into a fresh,
untouched test; a later time window would make a stronger deployment evaluation.

## Recommended sequence

First, agree with Francesco on a small forecast-source adapter and the data
contract above. Deliver FRA's versioned ranking with the HOB evidence and make
its prerelease status visible. Next, validate the no-ratings path, aliases,
unknown-card handling, and opening-pack parity in FirstPick's existing tests.
Then compare its eventual FRA-trained model and the unchanged prerelease source
on common held-out packs. Choose a source transition from validation results,
rather than an arbitrary date or an unvalidated score blend.

The research note and application contribution support each other, but they
remain distinct: the note reports measured HOB behavior; the app can make the
next frozen prediction useful to players.

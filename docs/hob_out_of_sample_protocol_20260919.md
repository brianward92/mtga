# Hobbit follow-up evaluation, 2026-09-19

Analysis rules recorded before computing the follow-up results. The forecast
itself was sealed on 2026-08-09; these detailed analysis rules are retrospective,
not a claim of pre-release preregistration. Do not tune the forecast on HOB.

- Read the `draftfm-v1.0` CSV verbatim and verify its published SHA-256:
  `a16c34767aa382e7703f480207f8480484e29ad22bbab2142aa2195e9b9a94a9`.
- Freeze the currently available HOB PremierDraft public draft dump, recording
  retrieval time, response metadata, byte size, and SHA-256. Report its actual
  date range. This is the first snapshot analyzed here, not a claim that it is
  the first sufficiently complete file ever published by 17Lands.
- Primary task: pack 1 pick 1, matching the sealed static card ratings.
  Compare the observed human selection to each forecast's highest-rated card.
  Report all players and the paper's expert slice (win-rate bucket >= 0.55,
  games-played bucket >= 100). These are behavioral agreement measures, not
  evidence that a card causes wins.
- Use frozen creator transcriptions. Letters use the existing 13-rung ladder;
  slash grades use the first grade; SB is unranked; numeric grades retain
  their native values. Missing values are never imputed. Compare raw model
  scores, not its presentation letters.
- A pack is eligible only if its picked card is present and every distinct
  offered non-basic card has a rating from both contestants. Basic lands are
  removed; a picked basic makes the pack ineligible. No partial-pack candidate
  filtering to make a forecast's coverage look complete.
- Primary accuracy gives 1/k credit if the observed pick is among k distinct
  tied-best card names, otherwise zero. Also report inclusive top-tie accuracy
  and the mean tie size. Random baseline is 1/(distinct offered non-basic names).
- Compare DraftFM to each creator on the same eligible packs. Also produce a
  shared-pack table across all full-coverage sources. Limited Resources covers
  only commons/uncommons and must be reported separately, with coverage counts.
- Report paired DraftFM-minus-creator differences with 95% percentile bootstrap
  intervals, resampling whole drafts (2,000 replicates, seed 17). P1P1 supplies
  one observation per draft; reject duplicate draft IDs rather than weighting
  repeated exports. These are marginal intervals, with no multiple-comparison
  correction; do not select only favorable comparisons.
- Secondary descriptive analysis: compare forecast ranks against cached 17Lands
  GIH win rates and average taken-at values. Use the same matched card set for
  each model/creator comparison, with at least 200 GIH observations for GIH.
  Report Spearman and Kendall tau-b. These aggregate associations are not
  causal card effects, and have no draft-cluster confidence intervals.
- Publish all computed comparisons, exclusions, hashes, date coverage, and
  limitations in a follow-on note. Do not overwrite the original seal.

Data attribution: Data from 17Lands.com (CC BY 4.0).

## Reality Fracture preparation

Use the identical final all-32-set d256 checkpoint (`9442f1de…`) and feature
manifest (`793b9db7…`), with no refit or choice based on the HOB results. Encode
current public FRA card text using the frozen feature vocabulary and text model.
Include the FRA Special Guests associated with this release; exclude Commander
cards. Keep the HOB conditioning (PremierDraft, empty pool, P1P1, 14-pick shape,
win-rate ID 28, games ID 4). Preserve raw scores and the original Hamilton
13-band presentation ladder over the unique-name universe, flagging basics.
Record exact card coverage and unresolved completeness issues before public seal.

Wizards lists prerelease September 25, Arena September 29, and tabletop release
October 2: https://magic.wizards.com/en/news/feature/collecting-reality-fracture
Aim to publish before September 25. Local generation alone is not a public seal.

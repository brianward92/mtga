# Evaluation Data

This directory contains small, reviewable records used for live model
evaluation. It does not contain raw 17Lands datasets or full third-party web
pages.

## `external/untapped/`

Dated, normalized snapshots of the public Untapped.gg Limited pick-order
page. Each snapshot includes its source URL, fetch time, upstream update
times, format/rank scope, visible tier order, and aggregate card counts.

Refresh explicitly with one request:

```bash
python scripts/fetch_untapped_pick_order.py \
  --set ECL \
  --slug lorwyn-eclipsed \
  --out data/external/untapped/ECL_PremierDraft_YYYY-MM-DD.json
```

The importer stores normalized facts only, not HTML, images, scripts, or
presentation assets. Untapped's Premier Draft aggregate is an external
comparison baseline, not a training label and not Quick Draft ground truth.

## `feedback/`

One JSON record per live review decision. A record distinguishes:

- what the installed app actually showed;
- any later rescore under a named model;
- external baselines visible at the time; and
- only the human preferences that were explicitly stated.

Partial feedback remains partial. Do not manufacture a complete ranking from
comments about one card or one pairwise disagreement.

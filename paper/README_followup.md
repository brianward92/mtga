# DraftFM follow-up note

`draftfm_followup.tex` is the 5–10 page follow-up working draft: the sealed HOB
evaluation, post-release fitted reference, FRA preview, and first-pick support.
It is separate from the original manuscript. This note remains unpublished.
The exact FRA forecast was published on September 25, 2026, after prerelease
events began: https://github.com/brianward92/draftfm/releases/tag/fra-p1p1-2026-09-25.

From the repository root:

```bash
.venv/bin/python scripts/build_followup_tables.py
latexmk -cd -pdf -interaction=nonstopmode -halt-on-error paper/draftfm_followup.tex
```

The table builder reads existing aggregate HOB results and the local FRA
forecast (or its included copy if the local scoring directory is absent).
It verifies the FRA forecast digest, writes LaTeX table rows, copies
the complete FRA forecast and uncommon list into `paper/data/followup_20260920/`,
and records input hashes. It does not evaluate or train a model.

The six FRA card images used in the paper are stored under
`paper/figs/cards/fra/`. Their printing identities, Scryfall image URLs, and
SHA-256 hashes are in `paper/figs/cards/fra/sources.json`. They match the
canonical printings in the September 19 card snapshot used for the forecast;
building the PDF does not require downloading images.

For submission, run `python3 scripts/package_followup_submission.py` from the
repository root. It writes a PDF for SSRN, a self-contained LaTeX archive for
arXiv, and file hashes under `paper/submission/`. The [submission handoff](submission/README.md)
records the proposed metadata and current release targets.

The HOB figure and aggregate results are in `docs/results/hob_oos_20260920/`.
The full analysis reproduction commands and limitations are in
`docs/hob_out_of_sample_20260920.md`. The first-pick implementation discussion
is in `docs/first_pick_support_20260920.md`.

The draft distinguishes the **pre-release HOB seal** from the **FRA forecast
published on prerelease night**. The FRA release is publicly timestamped before
Arena play, but it is not a pre-prerelease seal.

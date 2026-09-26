# HOB-trained P1P1 benchmark, 2026-09-20

This exploratory addendum was requested after the sealed-forecast versus
creator comparison had been computed. It is not part of the prerelease seal,
and is not a preregistered claim. The following recipe is fixed before fitting
or seeing this benchmark's results. The original forecasts remain unchanged.

Fit a HOB-specific conditional multinomial logit: one scalar utility per
non-basic card, with a softmax restricted to the distinct cards offered in
each pack. Fit only expert P1P1 observations (win-rate bucket >= 0.55 and
games-played bucket >= 100). No card features, pretrained weights, creator
grades, or game outcomes enter the fit.

Minimize the sum of negative log probabilities plus `0.5 * sum(weights**2)`.
Initialize all weights to zero and use L-BFGS-B (maximum 500 iterations,
`ftol=1e-12`, `gtol=1e-6`). Fail if optimization does not converge. The fixed
ridge penalty provides a finite estimate for rare or never-selected cards.
Do not select a regularization strength or training population by test results.

Use five folds, assigned by `zlib.crc32(draft_id.encode()) % 5`. For each fold,
fit on eligible expert drafts in the other four folds and predict all eligible
drafts in the held-out fold. Every scored draft is excluded from the fit
producing its prediction. This permits comparisons on the full original shared
population rather than shrinking it to a small single test split. Save fold
membership hashes, counts, weights, optimization diagnostics, and predictions.

Report out-of-fold P1P1 agreement for all players and expert players on exactly
the same shared packs as the frozen forecasts. Use the original fractional tie
credit and paired draft bootstrap (2,000 replicates, seed 17). Include every
creator on the common full-review population; LR's incomplete coverage remains
separate. Also show training agreement as a clearly labeled diagnostic.

This is a post-release benchmark with an information advantage, not an oracle
or a proven upper bound. Its random folds mix dates; the result is within-set
generalization, not prediction of a later time period. Draft resampling does
not account for repeated appearances of the same player or the dependence from
overlapping cross-validation training folds. Treat confidence intervals as
conditional on these fitted predictions; they do not include training variance.

# Magic rules reference

This directory contains set-agnostic rules used when designing DraftFM features and sanity-checking model output. Set-specific examples and empirical format claims belong under `docs/formats/<set>/` and should link back to the rule they apply.

Rules claims are checked against the *Magic: The Gathering Comprehensive Rules* effective 7 August 2026. Each subject has one owning file; related documents point to that owner rather than copying procedures. Claims that cannot be confirmed from the cited source must be marked `unverified`.

- [`limited-fundamentals.md`](limited-fundamentals.md): combat decisions, racing, trading, and mulligans.
- [`stack-and-timing.md`](stack-and-timing.md): priority, the stack, triggers, replacement effects, and state-based actions.
- [`zones-and-objects.md`](zones-and-objects.md): zone changes, counters, tokens, copies, and last known information.
- [`blocking-procedure.md`](blocking-procedure.md): the single canonical declare-blockers procedure.


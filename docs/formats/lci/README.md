# Lost Caverns of Ixalan Quick Draft reference

This directory records LCI-specific domain facts used for DraftFM feature engineering and for sanity-checking model output. General rules belong in [`../../rules/`](../../rules/).

The generated card snapshot contains 291 draftable cards. It was built on 2026-09-11 from the Scryfall `set:lci` print snapshot and the 17Lands LCI QuickDraft and PremierDraft pulls dated 2026-09-10. Generated files record these identifiers in their headers or top-level metadata.

- [`mechanics.md`](mechanics.md): descend, discover, craft, explore, Map tokens, and Caves.
- [`commons-review.md`](commons-review.md): empirical review of the 108 non-basic commons.
- [`removal-and-tricks.md`](removal-and-tricks.md): open-mana, removal, and combat-trick reference.
- [`rules-anchors.md`](rules-anchors.md): LCI applications extracted from the general rules documents.
- [`combat-reference.md`](combat-reference.md) and [`cards.json`](cards.json): generated card-pool references.

Regenerate and verify using the commands in [`../../README.md`](../../README.md).


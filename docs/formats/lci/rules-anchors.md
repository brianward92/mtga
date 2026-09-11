# LCI rules anchors

This file owns LCI-specific applications of the general rules. The underlying rules remain in [`../../rules/`](../../rules/).

## Format and role anchors

LCI Quick Draft is best-of-one. Format speed, play/draw measurements, archetype roles, and the empirical value of tempo are properties of this queue and dataset rather than general Magic rules. See [`playbook.md`](playbook.md) and [`commons-review.md`](commons-review.md) for the measured claims.

## Descend and graveyard count

Descend N counts permanent cards currently in the graveyard. “Descended this turn” is a separate boolean that checks whether a permanent card entered the graveyard from anywhere during the turn. See [`mechanics.md`](mechanics.md) for the LCI cards and edge cases.

## Open-mana interpretation

An opponent's untapped sources constrain which LCI instants, flash permanents, and activated abilities are possible. The complete set-specific tables live in [`removal-and-tricks.md`](removal-and-tricks.md) and [`combat-reference.md`](combat-reference.md).

## LCI stack and timing applications

Discover is a triggered keyword action whose resulting spell may be cast during resolution; craft and Map abilities use sorcery-speed activation restrictions printed in their rules text. The card-level timing inventory lives in [`mechanics.md`](mechanics.md).


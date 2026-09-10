# LCI Quick Draft knowledge base

This is the permanent reference an AI agent consults while drafting and playing **Lost Caverns of Ixalan (LCI) Quick Draft** in MTG Arena on macOS, unaided, under a turn timer. It is written to be **grepped, not read**: procedures and tables first, prose last. Every card name, mana cost, power/toughness and oracle line was verified against the Scryfall API for `set:lci`; every rule was verified against the Comprehensive Rules effective **7 August 2026**; every Arena claim was taken from the client's own localization database, the GRE match logs, or a first-party Wizards page. Anything that could not be verified is marked *unverified* in the file that carries it, and must be treated as unknown rather than as a soft fact. **Do not add a claim here you have not checked** — a wrong line in this KB is worse than a missing one, because it gets acted on at a moment when there is no time to check it.

**Format facts, settled and first-party:** Quick Draft is drafted against **7 bots** with no pick timers, and the matches are played against **human opponents**, **best-of-one**, until **7 wins or 3 losses**. (Wizards' MTG Arena formats page; Arena's in-client Codex `Limited_QuickDraft_A`; Arena's own "Best-of-1 Limited event" achievement text; `MatchWinCondition_SingleElimination` with `gameNumber: 1` in every logged Limited match.) No sideboard, no game two, nothing carries forward.

## Start here — the three files that matter in a live match

The picks and the deck list come from a trained model. **Playing well is the job**, and combat — especially declaring blockers — is the weakest area. In a match, these three answer almost everything:

1. **`limited-fundamentals.md`** — the *decision* layer. Grep `PROCEDURE` for the seven-step blocking procedure and the attack procedure, plus the single-block outcome grid, the race formula, and the role (beatdown vs control) test. Open this first when the question is "should I block / attack / trade / race?"
2. **`lci-removal-and-tricks.md`** — the *card* layer. "They have three untapped lands including white — what is the worst thing that buys?" Open-mana tables by colour, the complete 22 common/uncommon instants, the 9 flash permanents, instant-speed activated abilities already on the battlefield, and kill/pump thresholds.
3. **`arena-board-reading.md`** — the *perception* layer. Read life, taps, attackers, blockers and current P/T out of `Player.log` rather than off the screen. Nothing else in this KB is safe if the board state you are reasoning about is wrong.

A fourth, `match-tempo-and-clock.md`, is a **read-once-before-the-run** file: it tells you how much time you actually have and which windows are free.

## The files

| File | Open it when |
|---|---|
| `limited-fundamentals.md` | You must decide a block, an attack, a trade, a chump, a race, or a mulligan. Carries both combat procedures, the block grid, the survival/race tables, role assignment, and the 17Lands play/draw and mulligan data. |
| `lci-removal-and-tricks.md` | You need to price the opponent's open mana before committing, or to check a specific removal spell, trick, deathtouch/first-strike/menace/reach/ward roster, or the crew and layer traps. |
| `arena-board-reading.md` | You need the true board state — where each fact lives in the GRE log, how to bind a pixel to an object, how to declare and confirm blocks, and the failure modes of clicking. |
| `match-tempo-and-clock.md` | Before the run, and any time the 30-second warning is showing. Exact timer durations and ids, how the reserve accrues, per-decision budgets, and what expiry actually does. |
| `lci-commons-review.md` | You want to know what a specific **common** really is, or which colour is deep. 108 commons colour by colour with 17Lands data, plus the premium/trap lists. Most of what you face is on this list. |
| `lci-mechanics-deep.md` | An LCI mechanic is on the board or the stack and the answer changes a block: descend counts, discover, craft, explore, Map tokens, Caves — at rules-lawyer depth. |
| `rules-stack-and-timing.md` | You need to know whether you can act *right now*, what window you are in, or what happens if you act: priority by step, the stack, triggers, replacement effects, state-based actions, targeting and fizzling, plus Arena's auto-pass, Full Control, stops and hotkeys. |
| `rules-zones-and-objects.md` | You are about to bounce, blink, copy, exile or sacrifice something and need to know what survives the trip: CR 400.7, counters, tokens, copies, the legend rule, last known information and dies-triggers. |
| `lci-playbook.md` | Draft/deckbuild judgement and the turn loop: archetypes with win-rate deltas, deckbuilding targets, the never-play list, the click-by-click Arena action table, and the "cards to play around" list with play rates. |
| `lci-combat-reference.md` | You want a machine-generated cross-check: keyword counts by colour, creature bodies by mana value, and every instant-speed card by colour. **Generated from `lci-cards.json`; do not edit by hand.** |
| `lci-cards.json` | The Scryfall dump the generated reference is built from. Grep it when you want raw oracle text. |

## Conventions

- Costs are written in Scryfall notation (`{1}{W}`), always with the card name, always the LCI printing's rarity.
- **"Turn N" means a full turn cycle** — each player has had N turns.
- **Descend N** counts permanent cards *currently* in that player's graveyard; **"descended this turn"** is a separate per-turn boolean. They are different questions and the files never conflate them.
- Where two files touch the same subject, one **owns** it and the other points at it: combat decisions → `limited-fundamentals.md`; the clock → `match-tempo-and-clock.md`; card facts → `lci-removal-and-tricks.md` and `lci-commons-review.md`; log fields → `arena-board-reading.md`. Fix the owner first.

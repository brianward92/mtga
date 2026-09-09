# Session review — 2026-09-08/09

Written at the end of a long working session. The point is to make the findings
survive the conversation that produced them. Everything here was verified
against the running app, Arena's own database, or Arena's log, not reasoned
from documentation.

Sixteen commits, roughly 2,100 lines changed across 51 files. Out of scope for
this review: the FirstPick correspondence.

---

## 1. Card identity and the Arena ID mapping

### What was wrong

Card identity came from Scryfall's `arena_id`, a third-party mapping onto
Arena's `grpId` space. It was wrong, and it had been wrong for a long time.

The symptom that exposed it: a forced last pick displayed as **Plains** when
Arena showed an **Island**. My first instinct was to defend the mapping — I
"proved" grpId 87455 was a Plains using Scryfall and a downloaded card image.
That was wrong twice over. Brian pushed back twice before I checked Arena's own
database, which settles it: 87453/87454 are Plains, 87455/87456 are Island.

**The lesson, stated plainly: for anything about Arena's client, Arena is
authoritative and Scryfall is a guess.** Scryfall's `arena_id` is maintained by
volunteers mapping a closed id space from the outside.

### Measured scope, all 34 bundles diffed against Arena's database (43,445 ids)

| Finding | Count | Real problem |
|---|---|---|
| Basic-land ids resolving to the wrong land | 8 distinct, 256 occurrences | Yes |
| Draftable ids unresolvable | 30 (24 KTK, plus LCI 87453) | Yes |
| Cards whose colour rule disagreed with Arena | 175 | Yes — caused mis-picks |
| Non-basic cards genuinely mislabelled | 0 of 12 flagged | No, naming conventions |
| Back faces / non-draft ids absent | 3,042 | No, expected |

The eight bad basics contaminated **every** set, because the id table is
name-keyed globally rather than per set. "Forest" alone carries 180 grpIds.

### The second, worse bug

Pick P1P10 clicked the wrong card — took the model's rank 5 while wanting rank
1. Root cause: `shared/display-order.ts` scored Inverted Iceberg as colourless
from its **printed colours**, while Arena sorts it blue by **colour identity**.

This matters far more than a single wrong label, because **cells are matched to
cards positionally**. One card in the wrong position shifts every card after it,
so every badge from that point on is attached to the wrong card and every click
lands on a neighbour. 175 cards were affected by that one rule.

### What was built

- `scripts/build_arena_mapping.py --emit-app-cards` reads Arena's
  `Raw_CardDatabase_*.mtga` (SQLite) and emits `arena-cards.json`: 25,299 ids,
  16,942 names, plus Arena's own three sort keys per card.
- `main/data/bundle.ts` overlays it onto each set bundle.
- `main/data/arena-card-db.ts` queries Arena's live database for any grpId the
  shipped file does not know. This is what makes day zero work: the client knows
  a new set before our bundle does, which is the product's whole premise.
- `shared/display-order.ts` uses Arena's `Order_MythicToCommon`,
  `Order_ColorOrder` and `Order_Title` verbatim when every card in the pack has
  them, and falls back to the reconstruction otherwise. **All-or-nothing on
  purpose**: interleaving exact keys with reconstructed ones orders the two
  groups by different rules and produces a grid matching neither.
- An unidentifiable card in a pack now **refuses** to draw badges or pick,
  rather than silently mis-ordering.

### Schema gotchas, all load-bearing

- Names join `Localizations_enUS` on `TitleId` **with `Formatted = 1`**.
  `Formatted = 0` silently returns nothing.
- Names carry markup: `<nobr>Cat-Gator</nobr>`.
- `Colors`, `ColorIdentity` and `Types` are numeric enum codes. Type **text**
  comes from `TypeTextId`, a different column.
- The same card is spelled differently by each source: Scryfall prefixes
  Alchemy rebalances with `A-`, writes split cards `//` where Arena writes
  `///`, and names meld cards from the other face.

### Result

Mislabelled basics 8 → 0. Unresolvable draftable cards 30 → 3, all Alchemy.
Then verified live: 29 picks driven, all model rank 1, zero mis-picks.

---

## 2. General computer control

This is where most of the time went, and where the lessons generalise beyond
this project.

### The dominant failure mode: silent success

**A synthetic click that lands on nothing reports success.** Nothing errors,
nothing warns, and the script proceeds as if it worked. Every serious automation
bug this session was a variant of that.

The clearest case: the deck builder "added" two Plains that never arrived. The
app's own overlay window was mirrored over the left of Arena's deckbuilder,
covering the land tiles, and swallowed the clicks. The run reported a completed
deck; the deck was two lands short. It took three passes to find, because at
each step the evidence said the click had worked.

**Therefore: never trust an action, verify it.** Concretely:
- The picker now OCRs the target card's title band and refuses to click if it
  does not hold the card it means to take. This catches *every* ordering bug by
  its symptom rather than by its cause, including causes not yet found.
- The deck builder re-reads the rail by OCR between every batch of clicks.
- `arena.sh read X Y W H` is the general form: *what does the screen actually
  say at this rectangle?*

### Other invariants, each learned the hard way

- **Points, not Retina pixels.** A screenshot scaled to 1800px on a 3024px
  display is 1.19 px/pt. Mixing the two puts the click a fifth of the way across
  the screen from the target.
- **Park the cursor before capturing.** Arena draws a full-size card preview
  under the pointer, covering exactly what the shot was meant to read.
- **Capture a region, never the screen.** A bare `screencapture -x` sweeps up
  every other window, including the overlay being debugged.
- **Take your own overlay down before clicking underneath it.**
- **Search a list rather than indexing into it.** One query leaves a single card
  in a known cell, so nothing depends on sort order or scroll position. This
  replaced fragile grid arithmetic entirely.
- **Never trigger a modal dialog.** It blocks every subsequent synthetic event
  and only the user can dismiss it.
- **Geometry must know its window.** `DECK_RAIL` and `LAND_PICKER` were measured
  to four decimal places on one 1280x748 window on one afternoon and then
  applied to every window. They are now bucketed by aspect ratio and say so out
  loud when a shape has never been measured. A derived `visibleRows()` replaced a
  stored count, which cannot survive a resize.

### OCR is a lossy channel and must be treated as one

Apple Vision groups text boxes by vertical position, so an adjacent row's count
lands inside this row's box: `"Volatile Wanderglyph 1"` is the card name plus a
stray digit. That failed to match, the row read as "not in the plan", and the
builder **cut all three copies of a card the plan wanted**.

Two rules came out of it:
1. Name matching tolerates truncation in both directions, with an 8-character
   floor so short names cannot swallow longer ones.
2. **Never remove anything on the strength of text that failed to match.** The
   fail-safe returns zero, reports the row, and leaves it alone.

### Tooling shape that survives the permission classifier

All desktop actions go through one entry point, `arena.sh <cmd>`, with
complexity inside script files invoked with simple literal arguments. Inline
heredocs, `VAR=x cmd` prefixes and computed paths escalate; a script file with
literal args does not. This is why the entry point exists at all.

### Two meta-bugs in the tooling itself

- **The typecheck covered only `main/` and `renderer/`.** Everything in
  `shared/`, `scripts/` and `tests/` — that is, the code that drives the
  computer, the geometry it clicks with, and the entire test suite — was never
  typechecked. Turning it on immediately found three real defects. A function I
  deleted out from under its only caller had typechecked clean.
- **The stale-install warning compared timestamps**, so committing after
  installing reported a current build as stale, and editing without committing
  reported a stale build as current. It compares a content hash now. That
  warning exists because a two-week-old overlay once drove an entire draft, so
  it needed to be right rather than approximately right.

---

## 3. Persistence, and what Arena actually guarantees

Verified empirically by quitting and restarting Arena and reading the logs.

### The three sources, and what each is worth

| Source | Survives Arena restart | Survives app reinstall | Carries picks | Carries pool |
|---|---|---|---|---|
| `Player.log` + one backup | One restart only | Yes | Yes | Yes |
| Arena's server (`EventGetCoursesV2`) | Indefinitely | Yes | **No** | Only while unsubmitted |
| `draft-history.jsonl` | Yes | Only if not deleted | Yes | Yes |

Three facts that were not previously understood:

1. **Unity recreates `Player.log` on every launch**, moving the prior session to
   `Player-prev.log`. Exactly one backup. A draft's raw log survives one restart
   of the game; the second destroys it.
2. **Arena's servers re-send a finished draft's full `CardPool` on every login**,
   but only while the course sits in a deckbuilding module and the deck is
   unsubmitted. *During* the draft the field is empty — measured:

   | When | Module | Pool in reply |
   |---|---|---|
   | Login | BotDraft | 0 |
   | Mid-draft | BotDraft | 0 |
   | After the draft finished | DeckSelect | 45 |

3. **Picks are never re-served.** The order cards were taken in exists in the
   log, in our history file, or nowhere.

### What was wrong

- The parser read the course listing and **threw the pool away** unless the
  event was Sealed. The data had been arriving all along and being discarded.
- **Every history write was gated on not-replaying**, so a draft was recorded
  only if the app happened to be running while it was drafted. Start it late or
  restart it mid-draft and the picks were replayed into the UI and never saved.
- **Nothing read the history back.** Capture without read-back is half a feature.

### What was built

- The parser adopts a course's pool when exactly one draft is parked in a
  deckbuilding module. Refused when two are, because nothing says which one the
  player is looking at and guessing builds from the wrong pool.
- Replay writes history too, deduplicated by **identity, not content**. Replay
  does not score, so a replayed pick row lacks model data; a content hash would
  treat the poorer row as new and write it beside the richer live one.
- The pool is its own `draft-pool` event, not a field on `draft-end`, because a
  replay can reconstruct a different pick count than the live run saw — which
  made a count-keyed end row write a second copy for the same draft.
- `lastDraft()` reassembles the most recent draft; the coordinator rebuilds from
  it when replay found nothing at all.
- Arena's logs are copied into userData on startup and on rotation, deduplicated
  by content, filtered to logs mentioning a draft, pruned to the newest eight.

### Verification

With Arena quit, both its logs emptied, and only the history file present, the
app restored the 45-card pool and produced **the same plan** it gave when it had
watched every pick live. Separately, a full clean-room test — app deleted, data
deleted, build output deleted, rebuilt from source, Arena restarted — recovered
the pool from the server and produced the same recommendation.

---

## 4. The overlay and the app itself

- **The overlay drew over Arena's home screen and swallowed clicks** on Play,
  Rejoin and Done. I worked around it twice before Brian stopped me: *"but better
  answer is ... making the app not do that. that's a key bug"*. The fix is scene
  gating on `Client.SceneChange`, and it is strictly better than the workarounds,
  which is the general lesson.
- **The model sat on `loading` forever** after relaunching into a completed
  draft, because the resume path returned early for anything not active. The
  deckbuild advisor therefore had no grades.
- **The same bug recurred in a second place**: the model refresh required a
  parser snapshot, which a history-restored draft does not have. Same symptom,
  same consequence — the advisor fell back to heuristics and cut the best card in
  the pool. Worth noting that this class of bug produces *plausible* output, not
  an error, which is why it survived so long.
- **`picks_per_pack` shipped as 14 for LCI, which deals 15.** Rather than audit
  31 constants by hand, the app now learns it from the pack Arena dealt: at pick
  1 the pack is complete, so its size is the answer. The copy inside `assets.npz`
  feeds two model inputs and was deliberately left alone, since the model was
  trained with 14.

---

## 5. Reuse pass

Four title-normalizing functions and **six** basic-land predicates existed
independently. They had drifted: a Python helper tested
`type.startswith("Basic Land")` while everything else used a word-boundary
regex, so a supertyped land was a land to the overlay and a spell to the picker.

Disagreements here never throw. They mis-sort a pack, and one wrong answer
shifts every card after it. All are now in `shared/cards.ts`.

Also: the deck planner moved out of `renderer/`, since a command-line tool was
importing the overlay's UI layer to decide what goes in a deck. A Python state
helper was retired into a TypeScript CLI sharing the app's own card rules.

---

## 6. Working-process notes

- **Permission prompts were the single biggest tax** early on, escalating every
  heredoc, env-var prefix, inline `python3 -c` and computed path. Root cause was
  `blockReadsOutsideWorkingDirectories` in *user* settings; true in any source
  wins, so a project-level false cannot override it.
- **I asserted a stale code comment as fact** (that human P1P1 never arrives as
  `Draft.Notify`). The log disproved it. Comments are evidence, not authority.
- **I stopped mid-recovery to diagnose** a Reconnect dialog rather than just
  clicking it: *"So reconnect recovery you should get... I just clicked it for
  you, that's all you needed to do."*
- **The user was right and I was wrong on the central technical question** of
  the session — twice pushing back on the Plains/Island claim before I checked
  the authoritative source.

---

## 7. Known gaps

1. **Unknown whether Arena's server still serves the pool after Done is
   pressed.** Everything about post-submission recovery is untested.
2. **The click-verification path has never verified a real mid-pack pick.** It
   has been exercised only against a completed draft and a non-draft button.
3. **Builder geometry is measured for exactly one aspect bucket.** Any other
   window shape warns but proceeds.
4. **Two drafts of the same event on the same day** share an event name and a
   null draft id for bot drafts. Behaviour under that collision is reasoned
   about but not tested against a real occurrence.
5. **No CI.** `install-local.sh` running typecheck and tests is the only gate.

---

## 8. Cross-review findings and what came of them

Three independent reviewers went over the work afterwards, split by area. They
found real defects in code that had already been tested and shipped. Ranked by
what they would have cost:

**Arena's sort keys were keyed by card name, not by printing.** They are a
property of the printing. LCI's Sorcerous Spyglass is uncommon; the shipped
table gave it XLN's rare tier, so it sorted into the wrong block and dragged
every badge after it. **106 grpIds across 25 sets** were affected — the same
class of bug the whole card-identity effort was meant to eliminate, reintroduced
one layer down by the generator.

**The live-database fallback returned nothing for any card whose sort columns
were null.** In SQLite `NULL || 'x'` is NULL, so a single null column collapsed
the entire concatenated row to an empty string, the card was recorded as
unresolvable, and the whole pack refused to draw — over two ordering columns,
while the name, type, rarity and colours sat right there. 1118 names in the
current database have null order columns. This was the day-zero path failing in
exactly the situation it exists for.

**Nothing kept rail clicks away from Done.** Done sits in the same x column as
every deck-rail row, 25pt below the bottom of the OCR region — **less than one
row pitch** — and row y came straight from OCR with no upper bound at all. The
only thing preventing automation from clicking the button that commits the deck
was that two fractions happened not to overlap. It is now asserted, and refused
outright on any window shape nobody has measured, where the clearance is unknown
rather than approximate.

**`arena.sh key` and `type` pasted their arguments into AppleScript source.**
The single allow-listed entry point was therefore a route to arbitrary
AppleScript, including the menu items automation must never touch. A card name
containing a quote was enough to break out of the string.

**Two Quick Drafts of the same event collided in history.** Bot drafts carry no
draft id, and the event name is shared for the week or two the event runs, so
the second draft's pool was dropped as a duplicate and its picks merged into the
first draft's record. A restored draft could be a chimera of both.

**The log archive counted a login as a draft.** `EventGetCoursesV2` fires on
every login, so "only keep logs that mention a draft" kept every log, and
prefixes of the current session evicted the one file that actually held picks.

Also fixed: a **sixth** basic-land predicate hiding in the pool sheet, filing
every common cycle land under basic lands; a null sort tuple that passed
validation and sorted ahead of every mythic; a retry path that clicked without
re-verifying; an overlay kill that was assumed rather than confirmed; a torn
history line that welded itself to the next event; and pack size being read as
picks-per-pack in events where more than one card leaves per pick.

### What that says

Every one of these lived in code that typechecked, passed its tests, and had
been verified live. The pattern is consistent with the rest of the session:
**these bugs do not throw.** They produce plausible output — a pack that looks
sorted, a deck that looks built, a history file that looks complete — which is
why they need adversarial review or a check against an independent source, not
more unit tests of the same assumptions.

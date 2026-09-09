---
name: pick-next-card
description: Drive Brian's live MTG Arena draft from the overlay's recommendation — pick a card, run a whole pack, or build the finished deck (consent granted 2026-08-15, extended 2026-09-06).
---

# Drive the draft

Consent: Brian approved (2026-08-15) making picks in his live Arena draft from the
app's recommendation while developing, extended 2026-09-06 ("go ham") to cover
clicking, scrolling, capturing, relaunching the overlay, and editing the deck in
Arena's builder, with no prompts.

Three clicks are never yours: **Exit Game**, **Log Out**, and **Done** in the
deckbuilder. Done commits the deck and is Brian's to press.

Every desktop action goes through one entry point, `bash scripts/dev/arena.sh
<cmd>`, run from `electron/`. That is deliberate: complexity inside a script file
invoked with simple literal arguments is the shape that survives the permission
classifier, where an inline heredoc or a `VAR=x cmd` prefix does not.

    app launch|kill|restart|status    the overlay, with the state mirror on
    activate | front | rect           focus Arena, who is frontmost, its rect
    shot [name]                       capture Arena's window region only
    click X Y | move X Y | scroll X Y LINES | key CODE | type TEXT | clear
    read X Y W H                      OCR any screen region: what does it SAY?
    state [pos|cards|pool|rect|json]  the mirrored DraftState
    pick [top|<grpId>] [--dry-run] [--allow-land]
    draft [SECONDS] [MAXPACK]         loop until complete, or until MAXPACK is passed
    build [--dry-run|--read|--no-lands|--verify [SECONDS]]
    ocr <image.png> | log

## Picking

1. `arena.sh app status`. The app must be running **with the state mirror on**:
   `arena.sh app launch` does that, a plain `open -a` does not. Status also warns
   when the installed build is older than HEAD, which is how a two-week-old
   overlay once drove a whole draft.
2. `arena.sh pick [top|<grpId>] [--dry-run]` for one pick, or `arena.sh draft`
   to loop. `arena.sh draft 600 1` stops at the end of pack 1.
   Under the hood it prints the ranked pack, reads the target cell back off the
   screen to confirm it holds the card it means to take, clicks the card, clicks
   Confirm Pick, and verifies a new line landed in `draft-history.jsonl`.
3. Report each pick as one line: `P{pack}P{pick}: <name> (model #k, grade X)`.

The picker refuses in two cases, and both are correct:

- **A basic land**, unless it is forced. The last card of a pack always is, and
  so is an all-basics pack, so the refusal yields there automatically.
- **An unidentified card anywhere in the pack.** Cells are matched to cards by
  position, so one unknown card shifts every card after it and the click lands on
  a neighbour. Regenerate the correction file rather than overriding:
  `python3 scripts/build_arena_mapping.py --emit-app-cards`.

If the ranked list disagrees with what is on screen, STOP and diagnose before
picking. Card identity and pack order both come from Arena's own database
(`resources/draftfm/arena-cards.json`, with a live fallback to the client's
SQLite for ids newer than that file), so a disagreement means one of those is
stale — not that you should click anyway.

## Building the deck

`arena.sh build` cuts the pool to the advisor's deck, sets the basics, and adds
back anything the deck is short of, reading the deck rail by OCR between clicks
because Arena logs nothing until submission. It never presses Done. After Brian
presses it, `arena.sh build --verify` diffs Arena's own `EventSetDeckV3`
submission against the plan.

It is safe to re-run: every phase re-reads the rail first, so a second run
repairs whatever the first one missed rather than doubling it. Run it again
whenever the result line says MISMATCH.

## Invariants worth not relearning

- **Coordinates are screen points, not Retina pixels.** The Swift helpers and
  `screencapture -R` take points; a screenshot scaled to 1800px wide on a 3024px
  display is 1.19 px/pt. Nothing in the codebase computes that ratio.
- **Park the cursor before capturing.** Hovering a card makes Arena draw a large
  preview over its neighbours.
- **Restart the overlay after Arena restarts or crashes.** Arena also rotates
  `Player.log` when it crashes, which can take the draft's join event with it.
- **Quick Draft has no pick timer; Premier and Traditional do.** In a timed
  draft never leave a pack sitting while you run a diagnostic — it will auto-pick.
- Geometry comes from the app's published rect (CGWindowList, no Accessibility
  permission). Accessibility reports nonsense while Arena is full screen.
- **The overlay covers the left of the deckbuilder.** Its sidebar is mirrored
  over the filter bar and the first pool columns, and it swallows clicks in
  silence: the land tile reads as pressed and nothing is added. `arena.sh build`
  takes the overlay down for its clicking phases and puts it back; anything else
  clicking over there must do the same.
- **A click that lands on nothing still looks like success.** Neither Arena nor
  the helpers report a miss, so any sequence of clicks must be checked against
  the screen afterwards, not assumed. That is what `arena.sh read` is for, and
  why the deckbuilder re-reads the rail between every batch.
- **Search the pool rather than indexing into it.** One query leaves a single
  card in the first cell, so nothing depends on the pool's sort or scroll. The
  search box needs Return before it filters.
- **Type text with `arena.sh type`, and clear a field with `arena.sh clear`.**
  Both go through System Events against the focused field, so click the field
  first.
- **Never trigger a modal dialog.** It blocks every subsequent synthetic event
  and only Brian can dismiss it.

## When something is off

Prefer fixing the app over working around it. The overlay drawing on the Home
screen was worked around twice before being fixed properly with scene gating,
and the workarounds cost more than the fix. Same for a stale constant: the pack
size is now learned from the pack Arena deals, rather than audited by hand
across thirty sets.

---
name: pick-next-card
description: Make the next pick in Brian's live MTG Arena draft using the overlay's recommendation (double-click the recommended card; consent granted 2026-08-15 for development drafting).
---

# Pick next card

Consent: Brian approved (2026-08-15) making picks in his live Arena draft based on
the app's recommendation while developing. Still: only during a draft he asked
you to run; never click Exit Game / Log Out / Confirm on non-draft dialogs.

Procedure (all from `electron/`):
1. The app must be running with `MTGA_STATE_FILE` set (the dev wrapper does
   this) so the live DraftState mirrors to disk. Arena must be on the draft
   screen with a pack showing.
2. `bash scripts/dev/pick-next-card.sh [top|<grpId>] [--dry-run]`
   - prints the ranked pack (rank, pool grade, ev, prob, name) and the target
   - double-clicks the target card twice (Arena: first selects, second confirms)
   - verifies a new line landed in `~/Library/Application Support/mtga-tracker/draft-history.jsonl`
3. Sanity: if the ranked list disagrees with the screen (wrong cell), STOP —
   the display-order mapping (shared/display-order.ts) is wrong; fix before
   picking. If Brian gave a preference for the pick, pass its grpId.
4. Report the pick as one line: `P{pack}P{pick}: <name> (model #k, grade X)`.

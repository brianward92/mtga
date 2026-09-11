# Live draft run, 2026-09-10 — improvement data

Collected as it happened. Each entry: what was observed, what it cost, what to change.

## Draft phase

- **First glyph clipped, three ways.** "hupacabra Echo" (missing), "Valk with
  the Ancestors" (W read as V), "kawalli … Tower 1*" (missing + trailing pip).
  Three matcher patches. Root cause: the verify band's 12% left inset cuts into
  the first letter. Fix the band, keep the tolerant matcher as defence.
- **Stray tokens on the title row** ("1", "4"). The nearest-to-centre rule chose
  them over the title. Any-line-in-cell is now the rule; safe because the crop
  is per cell.
- **A refused pick parked the loop** until its budget ran out: no pick timer in a
  bot draft means nothing else changes the position. Now retries, gives up at 6.
- **Loop output drops the MISMATCH detail** (its grep keeps only the verdict
  line), so a refusal needs a manual re-run to diagnose. Echo the detail too.
- **Purchase confirm button is "OK"** — two characters, and a "longer than two"
  filter skipped it. Button matching must not assume length.
- **Overlay restores the previous completed draft on launch** (phase=complete,
  pool=45). The draft loop exits immediately on phase=complete, so it must not
  be started until the mirror shows the new course.

## Timing

- Pick cadence with the loop healthy: ~5s per pick, ~25s of verified picks
  between refusals.
- **ROOT CAUSE of the clipped titles: the verify band's 12% left inset.** Every
  refused pick was a first glyph cut off. With the left inset at 5% (right kept
  at 12%, where the pip sits) pick 8 read "Fanatical Offering" exactly. The
  matcher now also carries a similarity threshold (≥0.8 on ≥10 chars) as
  defence, replacing three stacked special cases. Four picks were lost to
  refusals before this; each cost a stop, a manual diagnosis, and a relaunch.
- **Monitor the loop, don't wait on it.** A tail on the loop's output with a
  filter for PICKED/ABORT/GIVING catches a refusal on its first occurrence
  instead of after six. Same treatment for build and play.

## Build phase

- **The audit's prediction came true: a lost rail row reads as "have 0" and
  the builder ADDS.** Arena auto-adds 17 basics when the builder opens. The
  Swamp row read as "17x ( Swamp"; "( Swamp" is not a basic-land name; the
  script saw zero Swamps, added 16, and finished at 57/40 with 33 Swamps. The
  spells were right. Fix: strip leading non-letters from a parsed rail name.
  Recovery: rerun the build — its excess-removal path clicks the row 17 times.
- **Cut phase was clean**: 22 cuts, each read back from the header count,
  62 → 40, no misses. Stray tokens on rail rows ("Skulltaker ( 2",
  "Seethi... 1") were absorbed by the tolerant matcher.
- **Idea:** before adding basics, if the header count already exceeds the
  target, refuse — adding cannot be right. A count sanity check would have
  caught this even with the parse failure.
- **`build --verify` cannot name basics.** The submitted list carries the basic
  Swamp as grpId 97170, which is not in the pool map, so it reports "Swamp:
  want 16, submitted 0" and "#97170: submitted 16, not in plan" — the same 16
  cards, twice. Map basic-land grpIds (per printing) in the verifier.

## Play phase (match 1)

- **Press point below the window.** With eight cards the outer ones sit so low
  that title+20 is past the bottom edge; the press hit the Dock, the card stayed,
  Arena lost focus, and the next keystroke went nowhere. Clamped to 8pt inside.
  Cost: one missed land drop and a whole missed turn (turn 4 auto-passed).
- **"clock 2s" was a delay timer, not the rope.** Only ActivePlayer /
  NonActivePlayer timers are the clock. Fixed in the parser.
- **Reading "their creature row" caught the right-hand card preview** (x≈1222)
  as the first box. Exclude x > 1150 when reading creature rows.
- **Cast candidate ids do not map to names.** No local grpId→name for this
  deck, so "cast #223 cost 2" still needs a guess at which card that is.
  Build the map from the deck submission (EventSetDeckV3 has grpIds) + Scryfall.
- **Optional "you may" triggers show as a screen prompt with no distinct GRE
  request** ("Mill two cards?" with Decline / Take Action), so the parser reports
  "decision: none" while the game waits on us. Detect via the bottom-right
  button text: "Take Action" / "Decline" means an optional trigger is pending.
- **Synapse Necromage's prompt was a hand-discard choice, not a graveyard one.**
  I took the biggest creature (Abyssal Gorestalker) and left Malicious Eclipse,
  which then wiped my two 1/1s. With a board of small creatures, take the
  sweeper/removal over the fatty. Knowing the card's text before choosing would
  have made this obvious — the name map below is for that.
- **Arena auto-passes when tapped out with no actions** ("Auto-Passing"), so
  turns advance without an explicit pass. Fine, but it means "decision: none
  in my main" can be "the turn already ended", not "a hidden prompt".
- **Never run long off-screen work during the opponent's turn.** A 40s Scryfall
  loop overlapped a "choose a creature to sacrifice" prompt; it resolved without
  me. Off-screen work must be under ~5s while a game is live, or wait for the
  between-games screen. (Also: the name-map attempt matched a 169-card
  collection line, not the 40-card submission, and Scryfall's /cards/arena/
  endpoint returned nothing — do this from the set bundle offline instead.)
- **"decision: none, mana spent, no new creature" means the spell is on the
  stack** and the opponent holds priority. Not a failed cast. The stack shows
  as a card panel on the right edge (x≈1075 of 1200). A state read right after
  a drag is too early; settle on gameStateId, then read.
- **Turn 16 was genuinely lost**: a cast that did not register, then auto-pass.
  Cause unconfirmed — the two candidates are a drag released before the card
  was "picked up" (12 steps may be too few under load) and a hover preview
  intercepting the drop. Verify every cast by creature count before passing.
- **The bottom-right button is context-sensitive: read it before every click.**
  "All Attack" in the attackers step, "End Turn" in second main. Three blind
  advance clicks declared all four creatures and then ended the turn with five
  mana unspent. step.sh now reads the label and refuses those two unless asked.
- **A name box marks a card's LEFT edge, not its centre.** Clicking at the
  title's x on a tight three-card row hit the neighbour. Click at name-x + 40
  (card centre) for selection; keep name-x + 35 in y for the body.
- **Stacked tokens are one pile.** Selecting two of them for a sacrifice needs
  the stack badge, not two clicks on the pile (the second click deselects).
- **GAME 1 LOST to two compounding tool bugs, not the board.** (1) The attacker
  locator took the topmost text box in a wide band, which was a land in their
  top row (Hidden Volcano at y≈173), so the block drag assigned nothing.
  (2) step.sh treated "No Blocks" as a plain advance and clicked it. Seven
  damage at six life. Fixes: attacker.sh reads only the attack lane (y 220-340)
  and excludes land names; step.sh refuses "No Blocks"/"Decline" unless asked
  by name. A no-block must be an explicit decision, never a default.
- **The macOS Screen Time shield fired between games 1 and 2** ("You've
  reached your limit on MTGA", OK / Ignore Limit). It sits over Arena's window,
  so every click aimed at Keep landed on the dialog and the mulligan looked
  stuck. Dismissed via "Ignore Limit" → "Ignore Limit For Today" (authorized).
  Detect it: a bottom-band read showing OK + Ignore Limit. Consider
  raising/removing the MTGA limit before a run.

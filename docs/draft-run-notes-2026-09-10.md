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
- **Shift+Enter passes the TURN, not priority.** Used as an "End Turn" fallback
  while still in first main, it skipped combat outright: six unblockable damage
  forgone on turn 14 of game 2. Never fall back to it before combat; use the
  step button (Next / To Combat) and only key-pass from second main or later.
- **Selecting an attacker by clicking is unreliable this game** (two failures
  at the right card centre with the button still reading All Attack). Arena
  also accepts a short drag of the creature toward the opponent to declare it;
  use that. And "No Attack" exists as its own button (x≈1324, y≈651) when the
  main one reads All Attack — use it by name rather than the key-pass.
- **Overlapping cards: two clicks 41px apart hit the same card and cancel.**
  With four creatures the Echoes overlap; undeclaring "each" toggled one twice.
  Click each card's unique visible strip (its left edge), or reduce the target
  set first. And step.sh must never auto-click "N Attackers"/"N Blockers" —
  that submits the declaration. Cost: a 3-creature attack instead of a lone
  deathtouch poke on turn 20 of game 2.
- **Game 2, turn 20: the accidental three-creature attack cost the board.**
  Overlapping-card undeclare failed, the helper auto-submitted "3 Attackers",
  the opponent flashed in a blocker and shrank an Echo at instant speed, and I
  lost Necromage plus both Echoes for a 1/2. Lone-attacker lines are only
  safe if the declaration is verified to be exactly one BEFORE submitting.
- **"No Attacks" moves.** With three buttons stacked (count / No Attacks / All
  Attack) the fixed coordinate I had for it hit All Attack instead, and three
  1/1s went into four blockers. Locate it by label every time (btn.sh "No Attack").

## Game 2 (loss, 0-2)

- Was winning 22-10 on the lone-deathtouch-lifelink line until the accidental
  three-creature attack (overlap undeclare + auto-submitted count) fed the
  board away. Then Join the Dead on the Necromage and a −4/−0 on the Marionette
  removed the wall; 15 power into 7 life.
- Things that worked and should be kept: All Attack → undeclare → verify "1
  Attacker" → submit by name; Marionette deathtouch blocks verified via
  `declared` before submitting; No Attacks / End Turn by label; reading card
  text from the local card file before deciding (Crawler/Marionette deathtouch).
- Things to change for game 3: never attack unless the declaration count is
  verified equal to the plan; treat "decision: actions" during THEIR turn as
  "pass with the button, never a key"; keep both deathtouchers home when they
  hold removal mana.

## Game 3 (loss by inactivity, 0-3) — the event ended here

- Turns 1-5 went to plan: land every turn, Echo of Dusk on 3, a lone Echo
  attack on 5 (20→18), Visage of Dread in second main with the opponent as the
  target. Then the agent's context was compacted. The game kept running.
- **Three consecutive rope expiries lose the match outright.** Turn 7 (my
  main, actions), turn 8 (their attack, blockers), turn 9 (my main): each
  timed out at roughly one-minute intervals, 23:23 → 23:26, and Arena ended
  the game `ResultReason_Timeout`, winner seat 2. I was back at 23:30. Life was
  17-18 with a 2/2 against three creatures, so the board was not lost; the
  clock was.
- **This is the single biggest hole in the setup.** Everything reads the game
  from the log and clicks through the UI, and every action waits for the model.
  When the model is absent (compaction, a long think, a crash) nothing keeps
  the game alive. A backend dead-man's switch fixes it: watch-match already
  sees every decision that is ours and the rope timer; if a decision has been
  ours for longer than N seconds (say 35 of the 60-second rope) and no click
  has happened, take the minimum-regret default — play a land if one is in
  hand in first main, otherwise pass priority with the button; on blockers,
  submit no blocks only if no lethal is on the table, else chump the largest
  attacker with the smallest creature. Any answered prompt resets Arena's
  timeout count, so even a bad default keeps the match alive for the model to
  resume. It must never run while the model is mid-action (a lock file the
  helpers touch), and it must log every default it took.
- **Compaction itself is predictable.** The context ran out a few turns into
  the game after ~44 hours of session. Before a match starts, check how much
  context remains; if it is below a safe margin, compact deliberately between
  games (the event page has no clock), never mid-game.
- Visage of Dread's `targets` prompt was answered by an ad-hoc click script
  (it happened to work: target instance 2 = the opponent, and they discarded).
  `targets` needs a proper handler in act.sh: read the prompt's legal targets
  from the log and click the matching avatar/card, then verify the response.
- OCR read the event page's "Claim" button as "Сlaйm" (Cyrillic С and й).
  `click-text` missed it once because й→i was not in the homoglyph map; the
  second look read it clean. The map now has й and the other Cyrillic letters
  Vision reached for. Prize claimed: 50 gems (12,760 → 12,810) plus the pack,
  confirmed in the log as `Source: EventReward`.

## Event result

0 wins, 3 losses. 750 gems in, 50 gems and one LCI pack out. Games 1 and 2
were lost to tool bugs in combat (attacker locator, auto-submitted counts),
game 3 to the model being away. None of the three was lost to the draft or the
deck: the picks and the 40-card build went through cleanly on the first try
after the rail-parser fix.

Priority order for the next run: (1) the dead-man's switch above, (2) a real
`targets` handler, (3) never let a helper submit a declaration count, (4) a
pre-match context check.

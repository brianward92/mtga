# Driving Arena

> Use this when: you are about to play a game through the client. Read it once
> before starting, not during.

Learned by playing four practice games end to end. Every item here cost real
time or a real card.

## The division of labour

**Read from the log, act on the screen.** The screen does not carry what playing
needs: power is drawn as art, counters as pips, summoning sickness as a tint.
The log carries all of it exactly, plus the legal moves — a blocker request
names, per creature, precisely which attackers it may legally block, with
evasion and menace already applied. Never re-derive legality.

The screen is only ever used to deliver a decision that was made from the log.

## Combat

1. **A gang block is a gift, not a disaster.** When several creatures block one
   attacker, you choose how to divide its damage and the engine hands you each
   blocker's exact lethal threshold. Four damage across thresholds of 1, 2 and 1
   kills three creatures. `bestAssignment()` computes it.
2. **Cheapest-first is subtly wrong.** It maximises how many die, not what dies:
   1+1+1 kills two 1/1s where 1+2+1 kills the 2/2 instead. Same count, more
   removed. Enumerate the subsets; there are never many blockers.
3. **"Attack with everything" is a blunt instrument.** Pressing `a` sent two 1/1s
   into a 2/3 to die for nothing. Attack selectively: click each creature that
   profits, then confirm. One extra step, real cards saved.
4. **Do not commit every blocker while they have mana open.** One trick turns a
   free block into a lost creature. This is the mistake that looks safest.
5. **Stalled at combat damage always means an assign-damage prompt.** Nothing
   advances until it is answered, and it is easy to miss.

## Clicking

6. **Park the cursor before clicking, not just before reading.** Hovering a card
   pops a preview of that same card over the thing you meant to click, and the
   click lands on the preview. Twice this looked like a dead target.
7. **The drop point is not the assignment.** Attackers stack in the UI, so
   dropping three blockers on one visual pile puts two on the same creature:
   four blockers killed three attackers. Read `declared` back from the log
   between drags.
8. **Deck tiles select on the art, not the name label.** Clicking the label does
   nothing and the Play button stays inactive, which reads as a failed click.

## Reading the state

9. **An omitted number is zero, not unknown.** `power: {}` means a 0/5 wall. Read
   as unknown, two harmless blockers looked like unread threats for several turns.
10. **Booleans go stale.** Arena drops `isTapped` and `hasSummoningSickness` when
    they become false, so a merge keeps the old `true`. Never decide from them;
    the engine's `qualifiedAttackers` is authoritative about who can attack.
11. **The legal-action list is not filtered by affordability.** On turn one with
    no lands it still lists every castable card in hand. Count mana yourself.
12. **A full game state means a NEW GAME.** Clear the result and turn counter, or
    game two opens reporting that game one was won, on turn nineteen.

## Text on screen

13. **Recognised text substitutes lookalike letters.** "Keep" came back with a
    Cyrillic character in it. A plain comparison then misses a button that is
    plainly there. `macctl` folds homoglyphs before matching.
14. **Read unmerged boxes for anything in a row.** Merged lines weld a whole hand
    of card names into one string centred on no card. `macctl read --boxes`.
15. **Crop generously.** The hand arcs, so outer cards sit lower; a tight band
    returns nothing at all rather than a partial answer.

## Things the client does for you

16. It warns before the legend rule kills your copy, and the answer is usually
    "No" — a second copy just dies.
17. It defaults the damage assignment sensibly. Check it against
    `bestAssignment()`, but it is often already right.

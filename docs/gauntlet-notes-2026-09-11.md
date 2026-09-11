# WUBRG gauntlet — five colors, three straight wins each

The brief: play white until three wins in a row, then blue, then black, then
red, then green. A color once mastered is not revisited. The point is not the
record, it is to walk every colour's mechanics through the tooling and find
where it breaks, timing things as we go.

A standing question runs underneath it: which of these fixes belongs in
`macctl`, the general Mac control instrument, and which belongs in mtga, the
particular business of driving Arena. The split is worth keeping honest,
because the first one is reusable and the second one is not.

## Before game one

- **Launching a Unity app against a sleeping display corrupts its saved window
  size.** `macctl launch` woke the display and reported `displayWasAsleep:
  true`, but Arena came up 480x327 with a black canvas, and its Unity prefs had
  been rewritten to `Screenmanager Resolution 960x598`. Every Arena fraction in
  this repo was measured at 1280x748, and 480x327 is not even the same aspect
  ratio, so nothing would have clicked where it was aimed.
  - Not fixable from the OS side: the window is not resizable. A corner drag at
    the exact corner did nothing, `AXSetSize` was accepted and silently ignored,
    and the window has no `AXZoomWindow` action. Unity owns its geometry.
  - The fix is the app's own state: quit, `defaults write com.wizards.mtga
    "Screenmanager Resolution Width" 2560` and `Height 1440` (the prefs are in
    pixels; at 2x backing that is the 1280x720 canvas plus a 28pt title bar),
    then relaunch.
  - **macctl lesson (general):** waking a display is not the same as the display
    being ready, and `launch` should either wait for a settled, non-zero display
    mode before starting a GPU app or report that it did not. A `--wait-window
    WxH` on launch would have turned this into an error instead of an evening.
  - **mtga lesson (particular):** assert the window is 1280x748 before any run,
    and repair it via the plist rather than trying to resize it.

## Tool gaps found before a single card was played

- `find`, `click-text`, `wait-for` and `verify` take no `--region` and no
  `--boxes`, though `read` and `shot` both do. That is the entire reason
  `btn.sh` exists: 30 lines re-implementing region-cropped, unmerged,
  homoglyph-folded text search in Python, including a second copy of the
  homoglyph table that has already drifted from the Swift one. Pushing
  `--region`/`--boxes` down into macctl deletes that file.
- `macctl window rect --app MTGA` is the syntax in the design doc; the binary
  implements `macctl window <app>`, and given "rect" it reported *"rect is
  running but has no on-screen window"* — it had taken the subcommand as an app
  name. Doc and binary have diverged, and the error was actively misleading.
- There is no resize. For an app that honours it, `macctl window <app> --size
  WxH` is a general primitive worth having; Unity would still refuse it, which
  is itself worth reporting rather than silently no-op'ing the way AX did.

## Findings from the first three white games

### The one that changes everything: Arena takes a double-click, not a drag

Every card play in this repo was a drag — hover-settle, twelve steps of
intermediate motion, release over the battlefield. In this client that does
nothing at all, and neither does a single click. A **double-click on the card
in hand** plays it, every time, and costs about a second instead of three.

The asymmetry is worth writing down, because it is not guessable:

| Target | Gesture that works |
|---|---|
| Card in hand | double-click |
| Creature on the battlefield (attack, target, choose) | single click, **after a hover** |
| Buttons | single click |

The hover matters. A cold click at a creature's exact centre selected nothing
on one Luminarch Aspirant trigger and worked on the next; moving there, waiting
about half a second, then clicking has not missed since. `click-at.sh` now does
hover-then-click for every board click.

### Arena's legal-action list is not an affordability list

The engine keeps offering `ActionType_Cast` for cards there is no mana to pay
for. Acting on that offer double-clicks the card, Arena picks it up waiting for
mana that never comes, and the game sits in a modal with a **Cancel** button
while the log reports the unhelpful `decision: other`. Worse, the client is now
showing a hand that is not the hand, so every subsequent card lookup reports
"not in hand" and the rest of the turn quietly does nothing.

Three fixes, all needed:
- Count real mana as the engine's `Activate_Mana` offers **intersected with
  permanents that are actually untapped** — the engine lists a mana ability for
  a land it has already tapped.
- Settle for a beat before re-reading affordability; Arena reports lands it has
  just tapped a beat late.
- If a cast does get stranded, find the Cancel button and click it. It is **not**
  at a fixed position: 1337,697 one time and 793,646 the next.

### Modal cards need the chooser answered

A channel land (Eiganjo, Seat of the Empire) or a double-faced card opens a
"Choose One" panel — normal face left, alternative right — and until one is
picked the card is neither played nor in hand. This is what "not in hand" meant
for two whole turns of missed land drops. `play-card.sh` now detects the panel
and takes the left face.

### Unity ignores synthetic scroll wheels; scrollbar track clicks work

`macctl scroll` delivers, and Arena's deck grid does not move — not at any
magnitude, and a drag inside the grid selects a tile instead of scrolling.
Clicking the **scrollbar track** pages it, and clicking at a position along the
track jumps proportionally. This is how the deck list was navigated at all.
Almost certainly a general Unity fact rather than an Arena one: a candidate
`macctl` improvement is pixel-unit scroll events with continuous phases, which
is what a real trackpad sends.

### Reading a running app's database can take it down

`plan.py` resolved grpIds to card names by opening Arena's own
`Raw_CardDatabase_*.mtga` — read-write, by default, on every single call. Arena
then died mid-match with SIGSEGV inside `sqlite3_step`, in its own query path.
Whether or not those two facts are cause and effect, the fix is not optional:
snapshot the file once and read the copy. The crash cost a game in progress,
because a bot match does not resume.

### OCR is the fragile layer, and it fails in specific ways

- **The first glyph of a card at the crop's left edge goes missing** —
  "Luminarch Aspirant" reads as "uminarch Aspirant", "Hopeful Initiate" as
  "lopeful Initiate". Name matching now tries substring, then the same test
  ignoring the leading character, then a loose subsequence.
- **The same crop read twice gives different results.** A creature present in
  one read is absent from the next. Anything that locates a card by name needs
  to look more than once; `play-card.sh` takes three looks a beat apart.
- **The hand physically recentres after every play**, so a read taken during
  that animation returns only the names it catches mid-slide.
- **Letters get substituted, not just doubled**: "4 Attackers" came back as
  "4 Aftackers", which an exact-ish regex refused. `step.sh` now folds and
  matches a near-subsequence.
- **Power/toughness boxes are dropped often enough to matter.** `board.sh` pairs
  each creature name with the P/T below it (the P/T is horizontally centred on
  the card, the name is not), and when there is no readable P/T it falls back to
  name-x plus half a card width rather than dropping the creature — a creature
  the helper cannot see is one it cannot click, and that turned a "choose a
  creature" prompt into a dead end.

### Buttons are not where you assume

- The step button stacks a **main label over a sub-label** and the two were
  being joined before matching. At the opponent's end step it reads "My Turn"
  over "End Turn", so a plain pass was refused every single turn. Refusal is now
  judged on the main label, permission on the whole thing.
- **Assign Damage has its own Done button in the centre of the screen**, not the
  usual bottom-right one. Clicking the usual spot does nothing and the game sits
  there.
- **"No Attacks" is a separate button above "All Attack"**, and the mulligan's
  Keep renders a beat after the log announces the mulligan — so the first click
  lands on nothing about half the time.

### Throughput

The point of all of the above is round trips. A turn was eight or nine separate
commands; it is now typically two or three.

| Helper | What it collapses |
|---|---|
| `guard.ts` | tails the log incrementally and keeps one state in memory, replacing a watcher that re-read and re-replayed a 17MB log every 1.2s |
| `await.sh` | waits on the guard's journal (a small text file) instead of respawning `tsx match.ts` every two seconds |
| `plan.py` | the whole board, by name, in one command |
| `turn.py` | land + every affordable creature |
| `push.py` / `go.py` | every priority pass that carries no decision |
| `cycle.py` | a full turn, stopping only at a real decision |
| `newgame.sh` / `mull.sh` / `finish.sh` | the between-games loop |

Combat is deliberately still manual. Every game lost in this project has been
lost in combat by a helper acting on its own.

### The guard, and the lesson about guards

The rope guard worked on its first outing — it kept a mulligan I was too slow
to answer — and then immediately caused the exact class of harm it was built to
prevent. It passed priority three times while I was diagnosing something with
ad-hoc commands, which moved the game out of the main phase and quietly made
every land drop illegal. The failure looked precisely like "drags do not work",
and cost twenty minutes of chasing the wrong bug.

A guard needs to know when someone else is driving. It now stands down on a
lock file that every helper touches, and fires on the **rope** (Arena's own
clock at 12s) rather than only on a fixed idle, so a slow human thought is no
longer mistaken for an absent one.

## Score so far

White: **win, win, loss.** Three straight is the bar, so white restarts at zero.
Game 3 was lost on the board, not to a tool: a flier we could not block, at two
life, with a strong ground board that could not race it.

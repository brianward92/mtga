# Playing fast without misplaying

> Use this when: you need to know how much time you actually have, which window to spend it in, or what to do when the 30-second warning is showing.

## Quick reference

| Fact | Value |
|---|---|
| **Your clock runs only while the game waits on you** | 0 of 424 sampled game states had both players' timers running. The opponent's thinking time is free. |
| Your turn opens at | **61 s**, and the budget grows during the turn (median peak **115 s**, max seen 156 s) |
| Your windows on their turn open at | **45 s** (median peak 70 s) |
| Warning fires at | **30 s remaining** (`warningThresholdSec: 30`, on every take-control timer) |
| Reserve credit | 30 s each, 1 per 3 of your own turns, cap 4. **None before your turn 4.** |
| Turn clock hits 0 | Your **turn** ends. Not the game. |
| Inactivity clock hits 0 | 150 s with no input from you → **you concede**. This is the one that loses matches. |
| Format | Quick Draft is **Best-of-One**, 7 wins or 3 losses, bots draft / humans play, draft picks untimed |
| Remaining time | `durationSec - elapsedSec` on your timer with `"running": true`. Timer **3** (seat 1) / **9** (seat 2) = your turn; **4** / **10** = their turn. |

**Five rules, in priority order:**

1. When the 30-second warning appears, stop deliberating and submit the line you already hold.
2. Do all expensive computation in the opponent's decision windows. It costs zero.
3. Two passes over the same information means stop and act.
4. Never go 60 s without sending any input to the client, even mid-think.
5. Never lock Full Control (`Shift + Ctrl`). Arena's own tooltip: *"While enabled, Full Control stops at all possible times."*

---

## 1. The clock, exactly

Every game the server issues each player six timers in `gameStateMessage.timers`. Seat 1 gets ids 1–6, seat 2 gets 7–12, and **the id→type mapping is fixed**:

| Seat 1 id | Seat 2 id | Type | Base duration | Behaviour on expiry |
|---:|---:|---|---:|---|
| 1 | 7 | `TimerType_Prologue` | **120 s** | `TakeControl` |
| 2 | 8 | `TimerType_Epilogue` | 145 s | `TakeControl` |
| 3 | 9 | `TimerType_ActivePlayer` | **61 s**, grows | `TakeControl` |
| 4 | 10 | `TimerType_NonActivePlayer` | **45 s**, grows | `TakeControl` |
| 5 | 11 | `TimerType_Delay` | 2 s | `StartDelayedTimer` |
| 6 | 12 | `TimerType_Inactivity` | **150 s** | **`Timeout`** |

Every `TakeControl` timer carries `warningThresholdSec: 30`.

**Prologue is a live clock,** not a label: it was observed `running: true` with `elapsedSec` reaching 47. It covers the whole pre-game — die roll, play/draw, every mulligan in that game — as one 120 s budget, not 120 s per mulligan.

**The active-player clock is one cumulative budget for the whole turn.** It does not reset between Main 1, combat and Main 2. A slow main phase steals directly from combat.

**But the budget grows as the turn unfolds.** Measured increments to `durationSec`, across 8 Bo1 Limited games:

| Increment | Occurrences |
|---:|---:|
| +7 s | 144 |
| +15 s | 53 |
| +13 s | 14 |
| +22 s | 12 |
| +24 s | 8 |
| everything else | ≤5 each |

Measured per-turn, across 38 own-turn segments and 37 opponent-turn segments:

| | Opens at | Median peak budget | p90 | Max |
|---|---:|---:|---:|---:|
| Your turn | 61 s | **115 s** | 142 s | 156 s |
| Your windows on their turn | 45 s | **70 s** | 76 s | 126 s |

And how much time two competent humans actually spent:

| | Median | p90 | Max |
|---|---:|---:|---:|
| Per own turn | **~10 s** | 30 s | 55 s |
| Per opponent turn | **0 s** | 13 s | 79 s |

**There is no per-match clock in this format.** `TimerType_MatchClock` exists in the client enum and the warning string exists — *"Less than {minutesRemaining} minutes remaining in your match timer. You will concede the match if it expires."* — but **no match clock was issued in any of the 8 logged Bo1 Limited games**; each player received only their six ids.

---

## 2. The reserve

Arena's reserve is a credit system, not a penalty. `gameInfo` states the parameters:

```
"maxTimeoutCount": 4, "maxPipCount": 3, "timeoutDurationSec": 30
```

**Accrual: one pip per one of your own turns; 3 pips convert to one 30 s credit.** Traced across two full games, both players gained pips in lockstep with their own turn count regardless of how fast they played. Pips are not earned by being slow and not lost by being fast.

Observed `timeoutCount` against the player's own turn number — **every** sample, both seats, both games:

| Your turn | Credits held | Reserve |
|---:|---:|---:|
| 1–3 | 0 | **0 s** |
| 4–6 | 1 | 30 s |
| 7–9 | 2 | 60 s |
| 10–12 | 3 | 90 s |
| 13+ | 4 (cap) | 120 s |

No sample at your turn 1, 2 or 3 ever showed a credit. Both players start each game at 0/0, and **the reserve does not carry between games or matches.**

**Spending, observed live.** A `GREMessageType_TimeoutMessage` fired at the exact moment a timer reached its duration:

```
timerId 4  durationSec 60  elapsedSec 59  running   <- about to expire
timerId 4  durationSec 90  elapsedSec 60  running   <- TimeoutMessage; +30 s
timerId 4  durationSec 97  elapsedSec 61             <- turn budget keeps growing
```

Spent automatically, one 30 s credit at a time, the instant the clock hits zero. On-screen banner: **`TIMEOUT USED`** (`DuelScene/TimeoutUsed`). The reserve UI is a pip meter around the avatar (`MeterPipCount`, `PipFill`, `ITimeoutDisplayController` in the client metadata).

**Consequence:** on your first three turns there is no safety net. A 61-second dither over a turn-1 land drop is the entire turn, gone — and that is exactly the window where a trivial decision is most likely to be over-thought.

---

## 3. Your clock only runs when the game is waiting on you

The single most important fact here, and it is measured, not assumed.

Across 424 logged game states in which any player timer was `running: true`, **the two players' clocks never ran simultaneously — not once** (250 states with only seat 1 running, 174 with only seat 2).

| Active player | Decision player | Which of your clocks runs |
|---|---|---|
| you | you | ActivePlayer (id 3 / 9) |
| opponent | you | NonActivePlayer (id 4 / 10) |
| you | opponent | **nothing of yours** |
| opponent | opponent | **nothing of yours** |

Poll `turnInfo.decisionPlayer`. If it is not your seat, thinking is free.

Every second the opponent spends deciding is free: their whole turn apart from your priority windows, their mulligans, their agonised combat decision. `TimerType_Delay` (2 s, `StartDelayedTimer`, 375 occurrences) additionally fires on each hand-off before your clock starts.

**The one limit on free thinking:** `TimerType_Inactivity`, 150 s, `TimerBehavior_Timeout`. Its warning string is explicit: *"Warning! You haven't acted recently. Act soon or you'll concede the game!"* It fires at 120 s elapsed (30 s remaining). Its `elapsedSec` was 0 in every sample, because the players kept acting.

**Hard rule: never let 60 seconds pass without sending some input.** Break a long think with a harmless input — a hover, a mouse move — rather than sitting still. 60 s is a chosen margin against a 150 s limit, not a measured threshold.

---

## 4. What expiry does: two different failure modes

**1. Turn-clock expiry — `TimerBehavior_TakeControl`.** Costs you *this turn*, auto-passed. Arena's own tutorial text:

> `NPE/Timers/28`: "When you play with other people, you'll only have about a minute to take your turn."
> `NPE/Timers/30`: **"If the timer runs out, your turn will be over."**

**2. Inactivity expiry — `TimerBehavior_Timeout`.** 150 s with no input at all → you concede. Arena's Codex says the same in plain language: *"here on MTG Arena, if a player hasn't taken an action in a while, they will automatically concede."* `ResultReason_Timeout` exists in the result enum alongside `Concede`, `Game`, `Loop` and `Force`.

**When the 30 s warning fires, the correct response is not to think faster — it is to stop thinking.** 30 s is far more than enough to execute a plan (a full block declaration is a handful of clicks) and far too little to reach a better one. A slightly suboptimal attack beats an auto-passed turn, every time.

---

## 5. Per-decision budgets

**These are operating policy**, calibrated on the measured numbers above (61 s floor, 30 s warning, ~10 s human median per turn) and standard Limited practice. They are not measurements. Total target per turn: **under 20 s**.

| Decision | Budget | Rule that makes it fast |
|---|---:|---|
| Land drop, one land in hand | **0 s** | Not a decision. Click it. |
| Land drop, multiple lands | 3 s | The one that casts the most of your hand this turn and next; untapped over tapped unless you have nothing to cast this turn |
| Only one castable spell | 2 s | Cast it, unless deliberately holding an instant |
| Choice among castable spells | 8 s | Prefer the line using all your mana; ties go to the play that affects the board |
| Attack declaration | 12 s | Decided in the turn plan; this is execution |
| Block declaration | **15 s** (5 s if precomputed) | Table lookup — §8 |
| Removal target | 8 s | Kill the creature that most changes combat next turn |
| Explore: top or bin | 3 s | §10 |
| Trigger ordering | 3 s | Leave Auto Order Triggered Abilities on |
| Instant response on their turn | 5 s, or 0 s | Holding no instant → auto-pass handles it free |
| Combat trick timing | 10 s | Pre-decided as "cast if they block X with Y" |
| Mulligan (Prologue, 120 s total) | 20 s for the first | Land count first |
| Play/draw | 2 s | Play first in Limited |

**Escalation rule:** the moment the 30 s warning appears, drop to the fallback for whatever decision you are on and submit.

---

## 6. The one-pass turn procedure

The failure mode that costs turns is deciding one action at a time and re-reading the board between each. Replace it with one planning pass, then pure execution.

At the start of your turn, before clicking anything:

1. **Lethal check first.** Sum your attackers' damage against their untapped blockers assuming they block to survive. If lethal is available, take it and stop planning.
2. **Land drop.** Decide and play it immediately.
3. **Main 1 vs Main 2 split.** Only these belong in Main 1: anything that changes who can attack or block profitably (pump, +1/+1 counters, Map activations, craft), and anything that cannot be held. Everything else goes to Main 2, after combat has resolved.
4. **Attack declaration.** Which creatures, and what you are willing to lose.
5. **What mana to leave up** — and only leave it up if you hold an instant you would actually cast.

Then **execute the whole plan without re-deliberating.** If a trigger or reveal changes something material, re-plan from that point only, never from scratch.

**Plan Main 1 to execute in under 8 seconds.** The budget grows through the turn, so time spent early is the most expensive time you have: burn 45 s in Main 1 and you reach declare-attackers with the warning already up.

---

## 7. What to compute while the opponent is deciding

Your clock is stopped whenever `turnInfo.decisionPlayer` is not you. Use those windows for everything expensive, in this order of value.

1. **The block table.** Build it before they declare anything — see §8.
2. **Their open mana and what it represents.** Count their untapped lands and colours once per turn; hold the shortlist of commons at that cost that would blow out your attack or block. See `lci-combat-reference.md` §"What open mana threatens".
3. **Your next turn, branched on the draw.** "If I draw a land, X; otherwise Y." Two branches decided in advance turn your next upkeep into a zero-second decision.
4. **Descend counts and other running tallies.** Track permanent cards in your graveyard incrementally as cards go there. Never recount a graveyard on your own clock.
5. **Trigger ordering and targets** for anything you plan to cast.

**Do not** plan your attack before seeing what they leave untapped. Nothing that depends on a decision that has not happened yet.

---

## 8. Declaring blockers under the clock

**The rule that dictates the procedure — CR 509.1:** the defending player declares *all* blockers as one simultaneous turn-based action that does not use the stack. Per 509.1a each chosen blocker must be **untapped**, cannot be a battle, and is assigned to **one** attacker. If any part of the declaration is illegal, *"the game returns to the moment before the declaration."* You cannot block one attacker, see the result, and then block another. There is no incremental feedback to buy time with.

**Two rules that change how you evaluate a double-block:**

- **CR 510.1c:** *"If two or more creatures are blocking it, it assigns its combat damage to those creatures divided as its controller chooses among them."* There is no damage assignment order and no requirement to assign lethal in sequence. **The attacker's controller divides freely**, so a double-block does not protect either blocker — assume they kill as many of your creatures as their power allows. A 3-power attacker double-blocked by your 2/2 and your 1/1 kills both.
- **CR 302.6 (summoning sickness):** it stops a creature from *attacking* and from using `{T}` abilities. **It does not stop it blocking.** A creature you cast this turn is a legal blocker. In the log, `hasSummoningSickness: true` is not a reason to exclude it from the block table.

**Procedure when attackers are declared:**

1. **Lethal check on yourself.** Total incoming damage vs your life. If unblocked damage is lethal, start from "which blocks survive this", not "which blocks are profitable".
2. **Look up your precomputed table.** Do not rebuild it.
3. **Pick the assignment, click every blocker, submit once.**
4. **Budget 15 s if precomputed, 25 s if not.** Past 25 s, take the fallback and submit.

**The table to build on their clock:**

| Their potential attacker (live P/T, keywords) | My untapped creature | Legal? | Outcome if I block alone |
|---|---|---|---|

"Legal?" comes from evasion (flying, menace, "can't be blocked by…"); menace is an evasion ability per CR 702.111a and needs two or more blockers. "Outcome" is one of: *I kill it and live / we trade / I die for nothing / I chump for N*.

**Default fallback block, when the clock is going:**

- Incoming damage not lethal and no block trades up → **block nothing.**
- Incoming damage lethal → chump the largest attackers until the remainder is survivable.
- Never take a block you cannot explain in one sentence while the warning is showing.

**Read live P/T from the log, never from the card face.** `gameObjects` carry `power: {value: N}` and `toughness: {value: N}` as they currently are, after every counter, aura, pump and descend bonus, plus `isTapped`, `hasSummoningSickness`, `damage` (already marked), `attackState`, `attackInfo: {targetId, orderedBlockers[]}`, `blockState` and `blockInfo: {attackerIds: [...]}`. Keywords are not spelled out — they sit in `uniqueAbilities[].grpId`. Resolve grpId → keyword set once at deck-load time, never mid-combat. Full field map: `arena-board-reading.md` §4.

---

## 9. The four traps

**Trap 1 — the trivial land drop.** One land in hand, or two of the same type, is a zero-second action. Detect the trivial case and act *before* any evaluation runs. Most costly on turns 1–3, which is exactly when you hold zero reserve.

**Trap 2 — re-reading a board that did not change.** Arena sends `GameStateType_Diff` messages carrying `prevGameStateId` and only the changed objects (1,006 diffs vs 2 full states in one 8-game log). Cache the board keyed on `gameStateId`; on a diff, update only the listed objects. Symptom to watch for: the same board evaluation twice in one turn.

**Trap 3 — thinking versus stalling.** An operational test:

> You are **thinking** if you can state, in one sentence, the question you are answering *and* what observation would answer it.
> You are **stalling** if the last five seconds produced no new fact.

**Two passes over the same information means stop and act.** Re-reading a card you have read is stalling. Re-simulating a combat you already simulated is stalling. Enumerating a fifth line when the first three were close is stalling — when lines are close the cost of picking wrong is small and the cost of the clock is large.

**Trap 4 — deliberating on your own clock instead of theirs.** Measured median: ~10 s on your own turn, 0 s on theirs. If you are computing something on your turn that did not depend on your draw, it belonged in the previous free window.

**Bonus trap — Full Control left locked.** `DuelScene/ScreenSpace/Prompts/FullControlToolTip`: *"[Shift + Ctrl] Lock/Unlock Full Control. While enabled, Full Control stops at all possible times."* Locked Full Control turns every hidden auto-pass into a decision you must clear, and will drain the clock and the entire reserve. Use the momentary hold (`Hold Full Control`) only for a specific known interaction.

---

## 10. LCI mechanics that cost clock

Each adds real decision points; each has a fast default. Oracle text verified via the Scryfall API.

**Explore** (18 LCI cards) — *"Reveal the top card of your library. Put that card into your hand if it's a land. Otherwise, put a +1/+1 counter on this creature, then put the card back or put it into your graveyard."* (reminder text as printed on **Cenote Scout** `{G}`, 1/1, uncommon).
- Land reveal is **not a decision** — it goes to hand automatically. 0 s.
- Nonland reveal is binary: top or graveyard. Default **bin it** if you have descend payoffs or the card is weak; keep it on top only if you actively want to draw it next turn. 3 s.
- The +1/+1 counter changes combat math. Re-read the displayed P/T from the log; do not recompute it.

**Map token** — *"{1}, {T}, Sacrifice this artifact: Target creature you control explores. **Activate only as a sorcery.**"* Sorcery speed, so it must be folded into the main-phase plan. Decide in the turn plan whether a Map fires and in which main phase; do not reach for it mid-combat, where it is not even legal.

**Craft** (19 LCI cards) — *"Craft only as a sorcery."* Sorcery speed, and the cost exiles **this artifact plus a permanent or card of the named type** from the battlefield or your graveyard, which opens a chooser. Example: **Tithing Blade** `{1}{B}` — *"Craft with creature {4}{B} ({4}{B}, Exile this artifact, Exile a creature you control or a creature card from your graveyard: Return this card transformed under its owner's control.)"* Decide which permanent you are exiling *before* you start the activation.

**Discover N** (24 LCI cards) — *"Exile cards from the top of your library until you exile a nonland card with mana value N or less. Cast it without paying its mana cost or put it into your hand. Put the rest on the bottom in a random order."* Example: **Geological Appraiser** `{2}{R}{R}`, 3/2, uncommon, discover 3. This is the biggest single clock event in the set — a hidden reveal, a binary, then possibly a full cast with targets. **Budget 20 s and cast it early in the turn**, while your budget is still growing.

**Descend N** (28 LCI cards) — a static count of permanent cards in your graveyard. Example: **Basking Capybara** `{1}{G}`, base **1/3**, common — *"Descend 4 — This creature gets +3/+0 as long as there are four or more permanent cards in your graveyard"*, so a **4/3** attacker the moment the count hits four. Track the count incrementally; never recount the graveyard on your own clock; never assume a descend creature's printed stats.

---

## 11. Settings and controls that buy time

The client currently sends (`ClientMessageType_SetSettingsReq`):

```
"autoPassOption": "AutoPassOption_ResolveMyStackEffects",
"manaSelectionType": "ManaSelectionType_Auto",
"defaultAutoPassOption": "AutoPassOption_ResolveMyStackEffects",
"autoSelectReplacementSetting": "Setting_Enable"
```

Auto-pass on, auto-tap on, auto-choose-replacement on. **Leave these as they are.**

**Keep on** (Settings → Gameplay), with Arena's own tooltips:

| Setting | Tooltip | Why |
|---|---|---|
| Auto Tap | "Automatically taps mana sources and spends mana when paying costs." | Removes clicks per spell |
| Auto Assign Combat Damage | "Your creatures automatically assign their combat damage." | Removes a damage-division UI |
| Auto Order Triggered Abilities | "Automatically order triggered abilities rather than manually ordering them." | Removes a modal per multi-trigger |
| Auto Choose Replacement Effects | "Automatically choose the order for replacement effects rather than manually selecting them." | Same |

Auto-pass modes in the enum: `None`, `Clear`, `EndStep`, `FullControl`, `ResolveAll`, `ResolveMyStackEffects`, `Turn`, `UnlessAction`, `UnlessOpponentAction`. `ResolveMyStackEffects` is what the client sends and the right one. Do not fight it.

**In-duel actions that exist** (all rebindable): Pass Priority, Pass Turn (`EndTurnHardPass`), Pass Until Response (`EndTurnSoftPass`), Pass To End, Resume Turn, Full Control, Hold Full Control, Undo, Float All, Cycle Chat.

**Assignable keys, complete set:** `Ctrl`, `Enter`, `L`, `Shift + Ctrl`, `Shift + Enter`, `Space`, `Tab`, `Z`. Only one mapping is documented in-client: **Shift + Ctrl = Lock/Unlock Full Control**. **Read the actual bindings once from ESC → Keybindings at session start** rather than assuming; keyboard actions are faster and more reliable than clicking.

**Phase stops.** Right-clicking the phase ladder toggles stops ("Click to Add Stop" / "Click to Remove Stop"). Available stops include "Stop on opponent's declare attackers", "Stop on my declare blockers", "Stop on opponent's end step" and roughly twenty more. **Add only the stop you need for a specific held instant, then remove it.** Every unnecessary stop is a decision window that runs your clock for nothing.

---

## 12. Conceding cleanly, and what never to click

**CR 104.3a:** *"A player can concede the game at any time. A player who concedes leaves the game immediately. That player loses the game."*

Procedure:

1. Press **ESC** → the menu titled **"Menu"** opens.
2. Click **"Concede"** (`DuelScene/EscapeMenu/Concede_Button_Text`).
3. Confirm at the **"Are You Sure?"** dialog (`DuelScene/ClientPrompt/Are_You_Sure_Title`).
4. Verify in the log: the result arrives as `ResultReason_Concede`, and in Bo1 the `MatchScope_Match` result arrives alongside the `MatchScope_Game` result.

**Three adjacent controls that must never be clicked by mistake:**

| Control | Where | What it does |
|---|---|---|
| **Exit Game** | ESC menu, same short list as Concede | Quits the Arena client |
| **Resign** | Event page, not in-match | *"This will remove you from the event. You will be rewarded based on your current number of wins."* — ends the whole Quick Draft run |
| **Concede Match and Exit** | Client prompt (`DuelScene/ClientPrompt/Forfeit_Match`) | Concedes *and* leaves |

The full ESC menu is: Resume, Concede, Settings, Keybindings, Customize, Check Status, Forums, Exit Game. Concede and Exit Game sit in the same list. Menu buttons are not game objects, so they emit no `onHover` — **confirm the label under the cursor visually before clicking.**

**When to concede in Bo1 Quick Draft:** only when the game is genuinely unwinnable. Conceding ends the *match* and costs one of your three event losses immediately; there is no game 2 whose clock you are protecting. **Time pressure is never by itself a reason to concede** — a roped turn costs one turn, a concession costs the match.

---

## 13. Quick Draft: format and event loop

**Best-of-one, confirmed three ways:**

1. Every logged Bo1 Limited game carried `"matchWinCondition": "MatchWinCondition_SingleElimination"` (8 of 8). The alternative `MatchWinCondition_Best` exists in the client enum and never appeared.
2. Arena's own achievement text: *"Get 7 wins in a Best-of-1 Limited event without losing a single game."*
3. Draftsim's Arena draft guide: Quick Draft is *"Ranked Best-of-One matches (BO1) against players"*, *"Draft with bots and without timers"*, *"Play until you reach 7 wins or 3 losses"*.

Arena's in-client Codex on the format: *"You draft with bots! In Quick Draft, there are no pick timers, and no waiting in between picks! So while you'll still play against other human opponents, you'll be drafted with 7 other AI opponents."*

| | Quick Draft | Premier Draft |
|---|---|---|
| Drafting opponents | 7 bots | 7 humans |
| Pick timer | **none** | yes |
| Waiting between picks | none | yes |
| Match format | Bo1 | Bo1 |
| Event ends at | 7 wins / 3 losses | 7 wins / 3 losses |

**In-match timers are identical between the two.** They come from the match's format config (`SuperFormat_Limited`), not from the event. The draft being untimed does **not** mean the matches are.

**Bo1 consequences:** no sideboarding, no between-games screen, one game is one match. There is no "save my clock for game 2". (Arena's Codex confirms sideboarding between games belongs to Traditional Bo3 draft; the Bo1 sideboard limit of 7 cards exists only for cards that fetch from outside the game.)

**Event module flow**, from `CurrentModule` in the local logs for `QuickDraft_LCI_20260908`: `BotDraft` → `DeckSelect` → `CreateMatch` → (repeat) → `ClaimPrize` → `Complete`.

- End of match: banner `VICTORY` (`DuelScene/EndMatch/Victory`) or `Defeat` (`DuelScene/EndMatch/Defeat`), then back to the event page.
- Event page shows the record (`{qty} Wins` / `{qty} Losses`). Next match: click **"Play"** (`MainNav/EventPage/Button_PlayMatch`). Do **not** click **"Resign"**.
- End of event: module becomes `ClaimPrize`; click **"Claim"** (`MainNav/Rewards/EventRewards/ClaimPrizeButton`); module becomes `Complete`.

**The idle trap between matches.** Pause on the event page and Arena raises **"Are You There?"** — *"Your session will expire in the next {seconds} seconds and you will be disconnected unless you confirm you're still here and active."* Button: **"Stay Connected!"** Miss it and you get *"You have been disconnected. Please reconnect to continue playing."* with a **"Reconnect"** button. Watch for it whenever more than a minute passes outside a match.

**Mulligans** use `MulliganType_London` (CR 103.5): draw a full 7 each time, then put one card per mulligan taken on the bottom. The whole sequence shares the 120 s Prologue budget.

---

## 14. Corrections to `arena-board-reading.md`

That file's §3 contains three claims this measurement contradicts. Trust this file on these points:

| Claim there | Correction |
|---|---|
| "Burn all 4 and the game is conceded for you." | Turn-clock expiry is `TimerBehavior_TakeControl` → **your turn ends**. Only `TimerType_Inactivity` (`TimerBehavior_Timeout`) concedes. |
| "There is a whole-match clock as well as per-turn banks." | The `MatchClockLowTime` string exists, but **no match clock timer was issued** in any of 8 logged Bo1 Limited games. |
| "A 55-second turn is free; a 95-second turn costs a timeout." | The turn budget **grows** past its 61 s opening — median peak 115 s. A 95 s turn is usually still free. Read `durationSec - elapsedSec` instead of assuming 61. |

Its §4 says summoning sickness is "not a field… `summoningSick` appears 0 times". The field is spelled **`hasSummoningSickness`** and does appear (43 occurrences). It is also irrelevant to blocking (CR 302.6).

---

## Unverified

Marked so they are never trusted as fact.

- **The timer numbers come from HOB Sealed and HOB Premier Draft Bo1 Limited games, not from an LCI Quick Draft match.** No Quick Draft match GRE data exists on this machine. The config is per-format (`SuperFormat_Limited`, `MatchWinCondition_SingleElimination`) and should be identical. **Confirm once in the first LCI Quick Draft game: grep `maxTimeoutCount` and check it reads 4 / 3 / 30.**
- **The trigger for each budget extension.** +7 s (144×) and +15 s (53×) dominate, but 13, 22, 24, 10, 14, 20 and 30 also occurred, probably coalesced updates. Treat the measured openings (61 s / 45 s) and peaks (median 115 s / 70 s) as solid and the per-increment rule as approximate.
- **What `TimerBehavior_TakeControl` does after firing.** Inferred from `NPE/Timers/30` plus the existence of `TimerBehavior_ReleaseControl`. No logged game expired with an empty reserve, so whether control is released immediately or held longer was not observed. `ResultReason_Timeout` exists in the enum but never appeared.
- **Whether `TimerType_Inactivity` resets on the opponent's actions or only on your own input.** Its `elapsedSec` was 0 in every sample. The 60-second input rule is safe under either reading.
- **Default keybindings.** Stored server-side, not in the local plist. The assignable key set and the action list are verified; the mapping between them is not, except `Shift + Ctrl`.
- **The visual form of the low-time warning.** `warningThresholdSec: 30` is certain; the reserve UI is a pip meter. No "rope" class or asset name appears anywhere in the client metadata, so the classic burning-rope description may be out of date. Confirm visually once.
- **`TimerType_Delay` (2 s, 375 occurrences)** is read as a grace period before your clock resumes on hand-off, from its name and duration. It could be an animation gate. Low stakes.
- **`Undo`** exists and is rebindable, but has no tooltip in the localization database. What it can take back is unknown; do not rely on it as a speed safety net.
- **Whether Auto Assign Combat Damage is enabled on this account.** It is not in the `SetSettingsReq` payload the client sends, so it may be client-side only. Check Settings → Gameplay before the first match.
- **§5 budgets, the "two passes" rule and the default fallback block** are operating policy synthesized from the measured clock data and standard Limited practice, not sourced claims.

---

## Sources

1. **Arena GRE protocol**, read directly from `/Users/brianward/Library/Logs/Wizards of the Coast/MTGA/Player-prev.log.bak-20260822` — 8 Bo1 Limited games, 2026-08-20. Source of: all timer types, durations and id→seat mapping; `warningThresholdSec`; `maxTimeoutCount` / `maxPipCount` / `timeoutDurationSec`; the observed pip accrual and the `GREMessageType_TimeoutMessage` spend; `matchWinCondition`; the `gameObjects` field set; `GameStateType_Diff` / `prevGameStateId` counts; `onHover` counts; `ClientMessageType_SetSettingsReq` contents; the 424-sample simultaneity check.
2. **Arena event logs**: `Player-prev.log.draft-20260908` and `Player.log` — `QuickDraft_LCI_20260908` `CurrentModule` values (`BotDraft`, `DeckSelect`, `ClaimPrize`, `Complete`; `CreateMatch` observed for other courses); 0 `onHover` messages during drafts.
3. **Arena client localization database** (SQLite, table `Loc`): `/Users/brianward/Library/Application Support/com.wizards.mtga/Downloads/Raw/Raw_ClientLocalization_cc198ec371902bf594a5a38b59070986.mtga` — every quoted on-screen string: `NPE/Timers/27-32`, `DuelScene/TimeoutUsed`, `DuelScene/Warning/AFK_Warning`, `DuelScene/Warning/MatchClockLowTime`, `DuelScene/EscapeMenu/*`, `DuelScene/ClientPrompt/Are_You_Sure_Title`, `DuelScene/ClientPrompt/Forfeit_Match`, `DuelScene/ScreenSpace/Prompts/FullControlToolTip`, `DuelScene/SettingsMenu/Gameplay/*`, `DuelScene/PhaseLadder/PhaseStop/*`, `DuelScene/Browsers/Click_Add_Stop`, `MainNav/Settings/Gameplay/*`, `MainNav/EventPage/*`, `MainNav/Rewards/EventRewards/ClaimPrizeButton`, `Codex/WaysToPlay/Formats/Limited_QuickDraft_A`, `Codex/HowToPlay/QuickStart/BeginAndEnd_C`, `Achievements/Core/Advanced/Undefeated_desc_alt_2`, `SystemMessage/System_Network_Idle*`.
4. **Arena il2cpp metadata string table**: `/Users/Shared/Epic Games/MagicTheGathering/MTGA.app/Contents/Resources/Data/il2cpp_data/Metadata/global-metadata.dat` — the complete `TimerType_*`, `TimerBehavior_*`, `ResultReason_*`, `MatchWinCondition_*`, `AutoPassOption_*` and `ManaSelectionType_*` enums; `MeterPipCount`, `PipFill`, `ITimeoutDisplayController`; the absence of any "rope" identifier.
5. **Magic: The Gathering Comprehensive Rules**, effective 7 August 2026 (`https://media.wizards.com/2026/downloads/MagicCompRules%2020260819.txt`) — 103.5 (London mulligan), 104.3a (concession), 302.6 (summoning sickness), 509.1 and 509.1a–i (declare blockers), 510.1a–e (combat damage assignment), 702.111a (menace).
6. **Scryfall API** (`https://api.scryfall.com`) — oracle text, mana costs, power/toughness and rarity. LCI mechanic counts by `e:lci oracle:<kw>`: explore 18, discover 24, descend 28, craft 19 (`oracle:"craft with"`). Cards cited: Cenote Scout, Tithing Blade // Consuming Sepulcher, Geological Appraiser, Basking Capybara, Map token (`tbig`).
7. **Draftsim, MTG Arena draft guide** (`https://draftsim.com/mtg-arena-draft-guide/`) — Quick Draft is Bo1 against players, drafted against bots without timers, 7 wins or 3 losses, 750 gems / 5,000 gold entry.
8. **Sibling KB files**: `arena-board-reading.md` (§4 field map, §5 combat), `lci-combat-reference.md` (open-mana threats), `rules-stack-and-timing.md` (§16 auto-pass and stops).

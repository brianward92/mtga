# Reading the Arena board state

> Use this when: you need to know what is actually on the battlefield — life, taps, attackers, blockers, open mana — before committing to a click, and especially before declaring blockers.

Companion file: `lci-combat-reference.md` (what the opponent's open mana can actually do). This file is about *reading* the board; that one is about *what the cards do*.

## Quick reference

| # | Fact | Why it matters |
|---|---|---|
| 1 | **Read state from `Player.log`, not the screen.** The GRE writes life, every zone, `isTapped`, `attackState`, `blockState`, `blockInfo.attackerIds`, phase/step and `decisionPlayer`. | The screen lies: animations in flight, hover previews, and stacked permanents. |
| 2 | **`power.value` / `toughness.value` on a game object are already the current modified values.** Do not re-derive from the printed card. | Verified: a printed 2/2 read `"value": 2`, then `"value": 3` after a +1/+1 counter. |
| 3 | **There is no damage assignment order any more.** Arena removed ordering in Foundations; you assign damage to each blocker directly, and it is dealt immediately with no priority window. | Any advice about "left-most blocker is damaged first" is obsolete and wrong. |
| 4 | **A Vehicle must already be a creature when blockers are declared.** Crewing after the declare-blockers step does not let it block. | CR 509.1a. Crew in the declare-attackers step if you want the Vehicle to block. |
| 5 | **Maps cannot be used in combat.** The Map token reads "Activate only as a sorcery." No LCI card lets a creature explore at instant speed. | Do not decline a good block fearing an explore pump. It cannot happen. |
| 6 | **Craft is sorcery-speed only and expensive** ({5}{G}{G} for the 7/7). It never happens mid-combat. | An "empty" board of artifacts is not a combat threat; it is a main-phase threat. |
| 7 | Quick Draft is **best-of-one**, human opponents, run ends at **7 wins or 3 losses**. No sideboarding, ever. | Never hold a card back "for game two". |
| 8 | **Full Control on Mac is Cmd**, not Ctrl. Space passes priority. Shift+Return passes the rest of the turn but **still stops for blocks**. | Shift+Return is the safe workhorse key. |
| 9 | **The rope starts with 30 s left**, not at zero. Banks *open at* 61 s your turn / 45 s theirs and **grow as the turn goes on** (median peak 115 s / 70 s). Running a turn bank to zero **ends that turn**, it does not concede. | A 95 s turn is usually still free. The clock that concedes you is `TimerType_Inactivity` (150 s with no input). Read `durationSec - elapsedSec`; never assume 61. |
| 10 | Attackers = objects with `attackState`; `attackInfo.targetId` = what they hit. Blockers = objects with `blockInfo.attackerIds`. `BlockState_Unblocked` = getting through. | The whole combat picture in three fields. |
| 11 | **Never count lands off the screen.** Identical permanents collapse into one card with a quantity badge. Count from the log, and add Treasures. | An OCR land count is systematically low. |
| 12 | Summoning sickness **is** a log field, spelled **`hasSummoningSickness`** (`summoningSick` is not a field and greps to 0 — that is a spelling miss, not an absence). | Grep the right name. And it is irrelevant to blocking: CR 302.6 stops attacking and {T} abilities only, so **never exclude a summoning-sick creature from the block table.** |
| 13 | Hovering writes `"onHover": {"objectId": N}` to the log. | The exact way to bind a pixel to a game object. |
| 14 | Clicking a hand card usually only **previews** it, and the preview animation looks like a cast. **Drag to play**, then verify in the log. | The single most common false success. |

---

## 1. Two channels, and which one to trust

Arena's macOS accessibility tree is empty (window + 3 buttons + title; Unity's a11y plugin is iOS-only). There is no element-level read. There are exactly two channels:

| Channel | Gives | Trust |
|---|---|---|
| `Player.log` GRE messages | Complete game state: life, all zones, `isTapped`, `attackState`, `blockState`, counters, phase/step, `decisionPlayer`, and the legal `actions` array | **Ground truth.** Use for every "what is the state" question |
| Screen capture + OCR (`macctl read`) | Text and its window-point position | Use to *locate click targets* and to catch client-only modals the log never mentions |

**Rule: never answer a state question from the screen if the log can answer it.**

Log file:

```
/Users/brianward/Library/Logs/Wizards of the Coast/MTGA/Player.log
```

Verbose logging must be on. Verified currently `UseVerboseLogs = 1` in `~/Library/Preferences/com.wizards.mtga.plist`. If it is ever `0`, the GRE payloads vanish and you are blind.

Message framing:
- Server to client: `[UnityCrossThreadLogger]<date>: Match to <accountId>: GreToClientEvent`, then a JSON blob.
- Client to server: `[UnityCrossThreadLogger]<date>: <accountId> to Match: ...`

Latest full state:

```bash
grep -a 'GreToClientEvent' "$L" | tail -1
```

The newest `"type": "GameStateType_Full"` is a complete snapshot; `GameStateType_Diff` messages patch it.

---

## 2. Event structure: LCI Quick Draft is best-of-one

| Evidence | Source |
|---|---|
| "Draft cards against bots with no time limits. Build a 40-card deck to play against **live players** until reaching either **seven wins or three losses**, whichever comes first." | WotC official formats page |
| `"matchWinCondition": "MatchWinCondition_SingleElimination"` in GRE `gameInfo` | Limited Bo1 match log |
| Quick Draft desc: "Play games and receive prizes based on how many **games** you win!" | Loc key `Events/Event_Desc_LCI_Quick_Draft` |
| Traditional Draft desc, by contrast: "Play **best-of-three-game matches** ... how many **matches** you win" | Loc key `Events/Event_Desc_LCI_Trad_Draft` |
| "Get 7 wins in a **Best-of-1** Limited event without losing a single game" | Achievement `Core/Advanced/Undefeated_desc_alt_2` |

**Consequences that change play:**
- **No sideboarding, ever.** One game per match.
- **No information carry-over.** Every opponent is new.
- Opponents are **human**; only the *draft* is against bots (`Codex/WaysToPlay/Formats/Limited_QuickDraft_A`: "you'll still play against oth[er human opponents]"). Assume a human's blocks and bluffs.

**Quick Draft vs Premier Draft, in-match: no difference.** Same GRE, same timers, same Bo1 (WotC: "Premier Draft: ... battle others in **Best-of-One** matches"). The differences are all in the draft (bots, no pick timers, no waiting) and in entry cost, prizes and ranked effect — Premier Draft results affect season rankings, Quick Draft's do not.

---

## 3. Clocks

Verified from the `"timers"` array of a real limited Bo1 match. Each player gets their own set of six.

| Timer | Duration | Behavior | What it is |
|---|---:|---|---|
| `TimerType_Prologue` | **120 s** | TakeControl | Mulligan / opening decisions |
| `TimerType_ActivePlayer` | **61 s** | TakeControl | Your bank while it is your turn |
| `TimerType_NonActivePlayer` | **45 s** | TakeControl | Your bank while it is the opponent's turn |
| `TimerType_Epilogue` | **145 s** | TakeControl | End-of-game decisions |
| `TimerType_Delay` | 2 s | StartDelayedTimer | Inter-action grace |
| `TimerType_Inactivity` | **150 s** | Timeout | AFK detection |

Also in `gameInfo`: `"maxTimeoutCount": 4`, `"timeoutDurationSec": 30`, `"maxPipCount": 3`, `"startingLifeTotal": 20`, `"superFormat": "SuperFormat_Limited"`.

**The rope.** Every TakeControl timer has `"warningThresholdSec": 30`. That is the rope: it starts burning with **30 seconds left**, not at zero. When the bank empties, one of your 4 timeouts is consumed and you get a fresh 30 s; the client prints `TIMEOUT USED` (loc key `DuelScene/TimeoutUsed` — OCR that exact uppercase string).

**Running a turn bank out does NOT concede the game.** These are `TimerBehavior_TakeControl` timers: expiry with no credit left ends *that turn* (`NPE/Timers/30`: "If the timer runs out, your turn will be over"). Only `TimerType_Inactivity` (`TimerBehavior_Timeout`, 150 s with no input at all) concedes you.

**The bank grows during the turn.** 61 s and 45 s are opening values, not caps: measured across 8 Bo1 Limited games the active-player budget reaches a median peak of 115 s (p90 142 s, max 156 s) and the non-active budget 70 s. So a 95-second turn is usually still free. Read `durationSec - elapsedMs/1000` off your own running timer rather than assuming. Full measurement: `match-tempo-and-clock.md` §1–§4, which owns this subject.

Two OCR-able warnings:
- `DuelScene/Warning/AFK_Warning` — "**Warning!** You haven't acted recently. Act soon or you'll concede the game!" This is the inactivity clock, and it is the one that loses matches.
- `DuelScene/Warning/MatchClockLowTime` — "Less than {minutesRemaining} minutes remaining in your match timer. You will concede the match if it expires." **The string exists but no match clock is issued in this format:** `TimerType_MatchClock` appears zero times in the logs, and each player received only their six timer ids in all 8 logged Bo1 Limited games. Do not budget for a whole-match clock.

Read the live remainder from the log, not the rope animation: timer objects carry `"running": true` and `"elapsedMs"`.

---

## 4. Where each board fact lives in the log

| Board fact | GRE path | Notes |
|---|---|---|
| Both life totals | `players[].lifeTotal`, keyed by `systemSeatNumber` | `startingLifeTotal: 20` |
| Whose turn | `turnInfo.activePlayer` | Seat id |
| Who must act | `turnInfo.decisionPlayer` | The field to poll |
| Turn number | `turnInfo.turnNumber` | |
| Phase / step | `turnInfo.phase`, `turnInfo.step` | Enums below |
| Cards in hand | count `gameObjects` in that player's Hand zone | Opponent's hand is `Visibility_Private`: you get the **count**, not contents |
| Battlefield | `gameObjects` in `ZoneType_Battlefield` | One shared zone; split by `controllerSeatId` |
| Tapped | `"isTapped": true` on the object | **Absence means untapped** |
| **Current P/T** | `power.value`, `toughness.value` **on the object** | Already includes counters and layered effects. Do not recompute |
| Counters | `persistentAnnotations` entries of type `AnnotationType_Counter`, with `details` keys `counter_type` and `count` | **Not** a `counters` field on the object |
| P/T was modified | `AnnotationType_ModifiedPower`, `ModifiedToughness`, `PowerToughnessModCreated` | Tells you *that* it is buffed, useful for judging whether the buff is temporary |
| Graveyard / Exile | objects in `ZoneType_Graveyard` / `ZoneType_Exile` | Browsable in-client for both players |
| The stack | objects in `ZoneType_Stack` | |
| Summoning sickness | **`hasSummoningSickness`** on the object (40 log lines carry it in the reference match). `AnnotationType_EnteredZoneThisTurn` is a cross-check | The string `summoningSick` is not the field name and greps to 0. Relevant to attacking and {T} abilities only — **not** to blocking (CR 302.6) |
| Legal actions | the `"actions"` array on any decision message | If a cast is not in it, it is not castable |

**Phase and step enums** (exact spellings, from observed frequencies in a real match):

`Phase_Beginning` · `Phase_Main1` · `Phase_Combat` · `Phase_Main2` · `Phase_Ending`

`Step_Upkeep` · `Step_Draw` · `Step_BeginCombat` · `Step_DeclareAttack` · `Step_DeclareBlock` · `Step_FirstStrikeDamage` · `Step_CombatDamage` · `Step_EndCombat` · `Step_End` · `Step_Cleanup`

**Zone types observed:** `ZoneType_Limbo` · `Stack` · `Hand` · `Battlefield` · `Library` · `Graveyard` · `Exile` · `Pending` · `Sideboard` · `Revealed` · `Suppressed` · `Command`

**Hover to disambiguate a pixel.** During a match, hovering writes `{"onHover": {"objectId": N}}` to the log (164 of 1,121 hover messages in one match carried an id; the rest are hover-off or non-object hovers). Park the pointer on a card, read the last `onHover` line carrying an `objectId`, and you know the exact object under that pixel. This does not exist during drafts.

---

## 5. Combat

The agent's weakest area. Treat the log as mandatory here, not optional.

### Attack and block state

| Field | Values observed | Meaning |
|---|---|---|
| `attackState` | `AttackState_Declared` → `AttackState_Attacking` | Declared = chosen this step; Attacking = locked in |
| `blockState` | `BlockState_Declared`, `BlockState_Blocking`, `BlockState_Blocked`, `BlockState_Unblocked` | `Blocked`/`Unblocked` describe the **attacker**; `Blocking` describes the **blocker** |
| `attackInfo` | `{"targetId": 1}` | What the attacker is hitting: a **seat id** for a player, an object id for a planeswalker |
| `blockInfo` | `{"attackerIds": [219]}` | On the **blocker**, listing what it blocks. A multi-block shows several ids |

Complete combat picture: every object with an `attackState` is an attacker; `attackInfo.targetId` says what it hits; every object with `blockInfo.attackerIds` is a blocker and the array says which attackers it is on.

### Declaring blocks

1. "To block, **click or drag** one of your creatures into an attacker." Both work; the click form is two clicks (blocker, then attacker).
2. Multi-block by repeating onto the same attacker.
3. Confirm with the **bottom-right button** ("Confirm your blockers by clicking the button in the bottom right"). Its label OCRs as `{n} Blockers`, or `No Blocks` if declining.
4. Rejection prints exactly `Illegal blocks. Try again.` (attacking equivalent: `Illegal attacks. Try again.`). Treat that as a hard signal to re-derive from the log, not to retry the same clicks.

### Damage assignment — the rule changed, do not use old advice

**There is no damage assignment order.** The Comprehensive Rules (effective 2026-08-07) contain zero occurrences of the phrase; ordering was removed from Magic in 2018. Arena was the last holdout and removed it in Foundations:

> "Foundations is also introducing a change to blockers. Instead of ordering how your creatures attack, you'll assign damage to individual blockers directly. This damage is dealt immediately after assignment, without a priority window for casting spells or activating abilities."
> — in-client mailbox, `MainNav/Mailbox/2024_43_0_FDN_Announcement_Description`

What this means at the table:

- **CR 510.1c:** a blocked creature with two or more blockers assigns its damage "divided as its controller chooses among them." You pick freely — you are not constrained to any order.
- **Damage is dealt immediately after you assign it, with no priority window.** Neither player can respond between assignment and damage. Do not plan a trick for that gap; there is none.
- **CR 702.19b (trample):** you must assign lethal damage to *every* blocking creature before any excess goes to the player. You may choose not to, but then no damage tramples through.
- **CR 702.2c (deathtouch):** any nonzero combat damage from a deathtouch source counts as lethal for excess-damage purposes. A 1-power deathtouch trampler assigns 1 to each blocker and the rest to the player.

Current prompt strings (`Order Blockers` / `Order Attackers` still exist in the localization DB as dead legacy keys — ignore them):

| String | Meaning |
|---|---|
| `Assign Damage` / "Drag creatures to pre-assign damage." | The current assignment browser |
| "Use arrows to assign damage." | Same, arrow variant |
| `Auto Allocate Damage` | Let the client assign for you |
| `Assign damage as though {cardName} weren't blocked?` | The trample-style question |
| `{value} Damage` (`DuelScene/RuleText/PredictedDamage`) | Arena shows you the arithmetic; use it as a cross-check |

### Two settings that silently change combat

- **`Auto Assign Combat Damage`** — "Your creatures automatically assign their combat damage." If on, you never get the assignment prompt and the client picks for you. This is a real skill loss in multi-block spots.
- **`Auto Order Triggered Abilities`** — removes the trigger-ordering prompt. Rarely matters in LCI.

Decide deliberately whether these are on.

---

## 6. Counting the opponent's available mana

A log question, not a vision question, with an exact answer every time.

1. From the latest `GameStateType_Full` plus diffs, take `gameObjects` in `ZoneType_Battlefield` with `controllerSeatId` == the opponent's seat.
2. Keep those whose `cardTypes` contains `CardType_Land`.
3. Count the ones **without** `"isTapped": true`. Absence of the field means untapped.
4. Resolve each `grpId` to a name and colour to get *which* colours are available, not just how many.
5. **Add untapped Treasure tokens.** The Treasure token reads `{T}, Sacrifice this token: Add one mana of any color.` — no timing restriction, so it is instant-speed mana of any colour. Fifteen LCI cards create Treasures. `Kitesail Larcenist` `{2}{U}` 2/3 (rare) additionally turns existing artifacts and creatures *into* Treasures, so a permanent that was a creature last turn can be mana now — another reason to re-read `cardTypes` rather than remember.

**Do not count lands off the screen.** "When cards are stacked together on the battlefield, you can click on the quantity number to select all of them while attacking and blocking." Four Islands may render as one card with a `4` badge. An OCR land count is systematically low.

**Caves: a permanent's type can change.** Fifteen LCI cards transform into a land. The three at common/uncommon that matter in draft:

| Front | Cost | Transforms when | Back |
|---|---|---|---|
| Dowsing Device | `{1}{R}` | an artifact enters and you control four or more artifacts | Geode Grotto (Land — Cave) |
| Twists and Turns | `{G}` | a land enters and you control seven or more lands | Mycoid Maze (Land — Cave) |
| Grasping Shadows | `{3}{B}` | third dread counter (one per solo attack) | Shadows' Lair (Land — Cave) |

Always re-read `cardTypes` from the current state rather than remembering what was cast.

---

## 7. Is this card castable right now?

**Ask the log first.** Every decision message carries an `"actions"` array enumerating exactly the legal actions available to you. If a cast is not in that array, it is not castable. No vision, no ambiguity.

**Negative visual cues, with exact strings.** Zoom a card and the client attaches "hangers":

| OCR string | Loc key | Meaning |
|---|---|---|
| `Can't Cast` / "You can't cast this spell right now." | `AbilityHanger/PlayWarning/Cast_Prevented_*` | Not castable |
| "You can't cast this spell because of {preventerCardName}." | `Cast_Prevented_By_Text` | Named lock piece |
| `Can't Play` / "You can't play this card because of {cardTitle}." | `Play_Prevented_*` | Land drop or play blocked |
| `Can't Activate` | `Activate_Prevented_Title` | Ability unavailable |
| `Can't Attack or Block` | `Attack_Block_Prevented_Title` | |
| `Can't Attack` | `Qualification/CantAttack_Title` | |
| `Enters Tapped` | `Header_EntersTapped` | |
| `Duplicate Legendary` | `Header_Legendary` | |

`Summoning Sick` ("Creatures can't attack on their first turn.") and `Tapped` ("Creatures tap when they attack. Tapped creatures can't block.") exist only under `AbilityHanger/SpecialHangers/NPE/*` — the new-player-experience namespace. Do not rely on them appearing in a ranked match; derive summoning sickness from `AnnotationType_EnteredZoneThisTurn` instead.

**Getting a hanger on screen: right-click or hover to zoom.** "Right-click or hover over a card during a game to zoom in, giving you more information." This is the highest-value OCR action available: it converts a picture of a card into readable text including current modified P/T, counters, and why it cannot be played.

**The positive cue (a lifted/highlighted hand card) is a render state, not text.** Do not rely on it.

**The preview-vs-play trap:** clicking a card in hand often only opens a zoom preview, and the preview animation looks exactly like the card being played. Cards in hand generally need a **drag** to actually cast. Verify by log, never by animation.

---

## 8. Keyboard and mouse

**Verified bindings, with the Mac variant:**

| Key (macOS) | Action | Source |
|---|---|---|
| **Space** | Pass priority | `Queue_Tip_6`: "you can pass priority with the spacebar" |
| **Cmd** (Ctrl on Win) | Full Control, **next action only** | `Queue_Tip_18`: "Press 'CTRL' key ('CMD' key on Mac) to use Full Control for the next action" |
| **Shift + Cmd** | **Lock** Full Control until turned off | `Queue_Tip_18`; and `FullControlToolTip`: "[Shift + Ctrl] Lock/Unlock Full Control. While enabled, Full Control stops at all possible times." |
| **Return** | Cancel a pending End Turn | `Queue_Tip_1`: "cancel that by quickly pressing 'ENTER' ('RETURN' on Mac) or clicking End Turn again" |
| **Shift + Return** | Pass priority for the **rest of the turn**, *unless prompted to block* | `Queue_Tip_142` |

**The Mac difference that will cost a game: Full Control is Cmd, not Ctrl.**

`Shift+Return` deliberately still stops for blocks, which makes it the safe workhorse key for skipping through an opponent's turn you have no interactions in.

**Unresolved — do not act on these without checking.** The Keyboard Shortcuts page lists keys (`Ctrl`, `Shift + Ctrl`, `Enter`, `Shift + Enter`, `Space`, `Tab`, `L`, `Z`) and actions (Pass Priority · Pass Turn · Pass To End · Pass Until Response · Resume Turn · Auto-Passing · Float All · Full Control · Hold Full Control · Cycle Chat · Undo) in two separate localization namespaces and never pairs them; the pairing is built at runtime. By elimination `Tab`/`Z`/`L` cover Cycle Chat, Undo and Float All, but which is which is **unverified**. A conflicting in-client tip (`Queue_Tip_192`) says "Pressing 'QQ' will tap all your noncreatures that add mana and 'float' it", which contradicts the page listing `Key_L`; likely stale copy, unconfirmed. Resolve by opening Settings → Gameplay → Keyboard Shortcuts and OCR-ing the panel.

**Confirmed gestures:**

| Gesture | Effect |
|---|---|
| Right-click / hover a card | Zoom with full rules text and hangers |
| Click a phase on **either** phase bar | Set a stop there |
| Click graveyard or exile zone | Open that zone's browser (titles OCR as `Graveyard`, `Exile`, `Library`, `Stacked Cards`) |
| Click the quantity badge on a stack | Select **all** copies for attack/block |
| Press-and-hold your avatar | Full Control (touch equivalent) |

The phase ladder is a setting (`Show Phases`, "Show phase and combat step icons in game"). Currently enabled. If the phase bar is ever missing from a capture, check it.

**Bluffing, from the client:** "You can bluff having a spell to cast by entering Full Control ('CTRL' key, or 'CMD' key on Mac), or clicking a phase on a Phase Bar to set a stop." Your *pass speed is public information* to a human opponent — passing instantly on an empty board and then tanking on the turn you have a trick is a tell.

---

## 9. LCI cards that break naive board reading

All counts computed from the 292-card Scryfall LCI set.

### 9.1 Thirty-five double-faced transform cards

A permanent's current face is not the card you saw cast. The craft artifacts become large creatures — **but craft is sorcery-speed only and costs real mana**, so this is a main-phase threat, never a combat trick.

**LCI has 19 craft cards, not 9.** The table below is only the subset whose back face is a large body — the ones that change combat math. For the complete 19, with materials and back-face text, see `lci-mechanics-deep.md` §4.

| Front | Front cost | Craft cost | Also exile | Back | Back P/T |
|---|---|---|---|---|---|
| Oteclan Landmark | `{W}` | `{2}{W}` | an artifact | Oteclan Levitator | 1/4 |
| Spring-Loaded Sawblades | `{1}{W}` | `{3}{W}` | an artifact | Bladewheel Chariot | 5/5 Vehicle |
| Waterlogged Hulk | `{U}` | `{3}{U}` | an Island | Watertight Gondola | 4/4 Vehicle |
| Inverted Iceberg | `{1}{U}` | `{4}{U}{U}` | an artifact | Iceberg Titan | 6/6 |
| Visage of Dread | `{1}{B}` | `{5}{B}` | two creatures | Dread Osseosaur | 5/4 |
| Saheeli's Lattice | `{1}{R}` | `{4}{R}` | one or more Dinosaurs | Mastercraft Raptor | \*/4 |
| Kaslem's Stonetree | `{2}{G}` | `{5}{G}` | a Cave | Kaslem's Strider | 5/5 |
| Jade Seedstones | `{3}{G}` | `{5}{G}{G}` | a creature | Jadeheart Attendant | 7/7 |
| Sunbird Standard | `{3}` | `{5}` | one or more | Sunbird Effigy | \*/\* |

Every craft ability ends "Craft only as a sorcery." Mastercraft Raptor's power equals the total power of the exiled cards; Sunbird Effigy's P/T equals the number of colours among the exiled cards.

### 9.2 Six Vehicles — not creatures until crewed

| Vehicle | Cost | P/T | Crew |
|---|---|---|---|
| Watertight Gondola | (back of Waterlogged Hulk `{U}`) | 4/4 | 1 |
| Bladewheel Chariot | (back of Spring-Loaded Sawblades `{1}{W}`) | 5/5 | 1 |
| Subterranean Schooner | `{1}{U}` | 3/4 | 1 |
| Careening Mine Cart | `{3}` | 3/3 | 1 |
| The Belligerent | `{2}{U}{R}` | 5/5 | 3 |
| Magmatic Galleon | `{3}{R}{R}` | 5/5 | 2 |

**The timing rule that matters.** CR 702.122a: crew is an activated ability, "Tap any number of **other** untapped creatures you control with total power N or greater." It has no timing restriction, so it can be activated whenever its controller has priority — **but CR 509.1a requires a blocker to be a creature at the moment blockers are declared.** So:

- To **block** with a Vehicle, crew it during the declare-attackers step, before blockers are declared. Crewing later does not work.
- Crewing taps your other creatures, and **tapped creatures cannot block** (CR 509.1a). Crewing a 5/5 with two 1/1s costs you two blockers.
- When counting the *opponent's* possible blockers, add any uncrewed Vehicle they have the untapped creatures to crew.

### 9.3 Five flash creatures — surprise blockers

`Cogwork Wrestler` `{U}` 1/2 · `Malcolm, Alluring Scoundrel` `{1}{U}` 2/1 · `Tishana's Tidebinder` `{2}{U}` 3/2 · `Kutzil's Flanker` `{2}{W}` 3/1 · `Mischievous Pup` `{2}{W}` 3/1.

Two non-creature flash cards also ambush combat:
- **`Spring-Loaded Sawblades` `{1}{W}`** — flash; on entry deals 5 damage to target **tapped** creature an opponent controls. Attacking taps your creature. This kills an attacker after you have committed.
- **`Lodestone Needle` `{1}{U}`** — flash; on entry taps a creature and puts **two stun counters** on it.

### 9.4 Explore is never a combat trick

Twenty-five LCI cards reference explore. Exact text:

> Reveal the top card of your library. Put that card into your hand if it's a land. Otherwise, put a +1/+1 counter on that creature, then put the card back or put it into your graveyard.

**Every activated explore source in LCI is sorcery-speed.** The Map token reads `{1}, {T}, Sacrifice this token: Target creature you control explores. **Activate only as a sorcery.**` Nine LCI cards create Maps. Three instants (`Get Lost` `{1}{W}`, `Brackish Blunder` `{1}{U}`, `Fanatical Offering` `{1}{B}`) create Maps at instant speed, but the Maps still cannot be cracked until their controller's main phase.

**Do not decline a block because the opponent has an untapped Map.** It cannot pump during combat.

### 9.5 Descend is two different mechanics

Do not conflate them:

| Mechanic | Exact meaning |
|---|---|
| "descended" | A per-turn boolean: "(You descended if a permanent card was put into your graveyard from anywhere.)" Checks *whether* it happened this turn |
| "Descend N" | A threshold on a count: "if there are N or more **permanent cards** in your graveyard". `Descend 4` on 10 cards, `Descend 8` on 7 |

Twenty-eight LCI cards reference descend. Both count **permanent cards**, not all cards — instants and sorceries in the graveyard do not count.

The client shows the running count itself: `DuelScene/RuleText/SupplementalTextYouCountTypeZone` → "You have {count} {types} in your {zones}", plus an opponent equivalent. **Read that string rather than counting graveyard cards by eye.**

### 9.6 Stun counters

"If a permanent with a stun counter would become untapped, remove one from it instead." A tapped creature with a stun counter will **not** untap next turn — do not count it as a future blocker.

LCI sources: `Waylaying Pirates` `{3}{U}` (common; ETB taps + 1 stun if you control an artifact), `Lodestone Needle` `{1}{U}` (flash; taps + 2 stun), `Pugnacious Hammerskull` `{2}{G}` (self-stun when it attacks without another Dinosaur).

---

## 10. Procedures

### P1 — Full state refresh (start of every decision)

```bash
L="/Users/brianward/Library/Logs/Wizards of the Coast/MTGA/Player.log"
grep -a 'GreToClientEvent' "$L" | tail -1
```

Answer in this order: `turnInfo.activePlayer` → `turnInfo.decisionPlayer` → `turnInfo.phase`/`step` → both `lifeTotal`s → battlefield objects split by `controllerSeatId` → opponent's untapped lands + untapped Treasures.

### P2 — Before declaring blockers

1. List every object with an `attackState`. For each, read `attackInfo.targetId`.
2. Read each attacker's **`power.value` / `toughness.value` straight off the object.** These are already modified. Do not recompute from the printed card.
3. Zoom (hover or right-click) any attacker whose abilities you are unsure of and OCR the hangers — deathtouch, first strike, trample and flying all change the answer and all appear as text.
4. Count the opponent's untapped mana (P1) and ask what trick that permits — see `lci-combat-reference.md`. Rule out explore: it cannot happen now.
5. Count **your** blockers: untapped creatures, **minus** any you would tap to crew, **plus** Vehicles you crew *now* (before blockers are declared), **plus** flash creatures you can hold up.
6. Exclude anything tapped, stunned, or carrying `Can't Attack or Block`.
7. Declare; confirm bottom-right; verify the button reads `{n} Blockers`.
8. If `Illegal blocks. Try again.` appears, re-derive from the log — do not re-click.

### P3 — Assigning damage in a multi-block

You have free choice (CR 510.1c) and there is **no priority window** after you assign — damage is dealt immediately.

1. If the attacker has **trample**, assign exactly lethal to each blocker first; only then does excess reach the player. Assign less than lethal to any blocker and *nothing* tramples through (CR 702.19b).
2. If the attacker has **deathtouch**, 1 damage is lethal to each blocker (CR 702.2c) — spread it.
3. Otherwise concentrate damage to actually kill the most valuable blocker rather than spreading it and killing nothing.
4. Cross-check against the client's `{value} Damage` prediction.

### P4 — Bind a screen position to a game object

Park the pointer on the card, then read the last `"onHover": {"objectId": N}` in the log. That is the object under the cursor, exactly.

### P5 — Screen read

```bash
macctl read MTGA --json
```

Returns `{"at":[x,y],"text":"..."}` in window points plus the live window `region` and `scale`. Park the cursor somewhere neutral first — hover previews cover what you meant to read. Never cache the rect; every command re-reads geometry.

### P6 — First-match calibration (two minutes, do once)

Duel-scene pixel geometry has **not** been measured. On the first match, record as *fractions of the window*: the y-band of each battlefield row, both life totals, the phase bar, the graveyard and exile piles, and the bottom-right action button. Then open Settings → Gameplay → Keyboard Shortcuts and OCR the panel to close the `Tab`/`Z`/`L` gap.

---

## 11. Failure modes

| Failure | Why it happens | Guard |
|---|---|---|
| Clicked and nothing happened, but the click "succeeded" | A posted click that lands on nothing still reports success; `macctl click` returns `"verified": false` | Use `click-text`, or verify by log afterwards |
| Card zoomed instead of being cast | Clicking a hand card opens a preview whose animation looks like a cast | Drag to play; confirm via the log |
| Land count too low | Identical permanents collapse into one card with a quantity badge | Count from the log, never from the screen |
| Opponent "tapped out" but casts a spell | Untapped Treasures are instant-speed mana of any colour | Count artifact tokens as mana |
| Creature counted as a blocker that cannot block | Tapped, stunned, `Can't Attack or Block`, an uncrewed Vehicle, or a creature you just tapped to crew | Check `isTapped` + stun counters + hangers |
| Creature *not* counted that can block | Uncrewed Vehicle (Crew 1 is cheap) or a flash creature in hand | Add Vehicles and known flash creatures |
| Vehicle crewed too late to block | Crew is untimed, but blockers must be creatures when declared (CR 509.1a) | Crew during declare attackers |
| Blocked with stale P/T | Used the printed P/T instead of the object's | Read `power.value` / `toughness.value` |
| Declined a good block fearing an explore pump | Maps and every LCI explore activation are sorcery-only | Explore is never a combat trick |
| Assigned trample damage and nothing got through | Every blocker must be assigned lethal first | CR 702.19b |
| Waited for a response window after assigning damage | Foundations removed it | Damage is dealt immediately |
| Lost to the clock | Going 150 s with **no input at all** hits `TimerType_Inactivity` and concedes the game. (Running a turn bank out only ends the turn.) | Send a harmless input — a hover or right-click zoom — at least once a minute; OCR the AFK warning |
| Read a black frame as "control not present" | Display asleep | `macctl` wakes it and reports `wokeScreen` |
| Every input silently refused | Screen locked, or Secure Event Input held | Exit code 3 with a reason. Reads still work while locked; input does not. `macctl awake --while-pid $$` before a long run |
| A modal blocks everything | Disconnect and confirmation dialogs are announced nowhere in the log | Detect by OCR; the idle-disconnect dialog reads "You have been disconnected.  Please reconnect to continue playing." |
| Log has no game state at all | `UseVerboseLogs` turned off | Check the plist; without it you are blind |

---

## Unverified

Marked explicitly so they are never trusted as fact:

- **Duel-scene pixel layout was never measured.** Nothing positional in this file is a coordinate; every positional claim is quoted client copy (bottom-right confirm button, both players' phase bars, clickable graveyard/exile) or replaced by a log-side method. Close with P6.
- **`Tab`, `Z`, `L` bindings.** By elimination they cover Cycle Chat, Undo and Float All; which is which is unknown. `Queue_Tip_192`'s "QQ" for Float All conflicts with the settings page listing `Key_L`.
- **Which of `Enter` / `Shift+Enter` maps to which of Pass Turn / Pass To End / Pass Until Response.** Only the two behaviours quoted in §8 are verified.
- **Timer values come from a Sealed limited Bo1 match, not an LCI Quick Draft match.** They are server-issued per match. Confirm the `"timers"` array on the first LCI Quick Draft game before trusting 61 s / 45 s precisely.
- **`ShowPhaseLadder = 2` semantics** (the plist key is account-prefixed, `X46VJGUWLVDFLCD47UBFMOLTLU.ShowPhaseLadder`). Likely a 3-state Off/Auto/Always. What matters is that Show Phases is enabled.
- **Whether the legacy `Order Blockers` browser can still appear in any edge case.** The FDN announcement and the CR both say ordering is gone, and the loc keys look vestigial, but this was not observed live.
- **Whether Cave lands and craft artifacts obey the same quantity-badge stacking rule as basic lands.** Only the general stacking rule is confirmed.

## Sources

- **Scryfall API**, `https://api.scryfall.com/cards/search?q=e%3Alci&unique=cards` — the full 292-card LCI set, fetched fresh this session. Source for every card name, mana cost, P/T, type line, oracle text, craft cost, crew value, and every count in §9. Token text from `q=e%3Atlci`.
- **Comprehensive Rules**, effective 2026-08-07 — CR 509.1a (blockers must be untapped creatures), 510.1a–c (damage assignment is a free division), 702.19b (trample), 702.2b–c (deathtouch), 702.122a–c (crew). Confirmed the phrase "damage assignment order" appears **zero** times.
- **WotC official formats page**, `https://magic.wizards.com/en/news/mtg-arena/mtg-arena-formats` — "Quick Draft: Draft cards against bots with no time limits. Build a 40-card deck to play against live players until reaching either seven wins or three losses, whichever comes first."; "Premier Draft: ... Best-of-One matches."
- **Arena client localization database** (21,005 UI strings, SQLite): `/Users/brianward/Library/Application Support/com.wizards.mtga/Downloads/Raw/Raw_ClientLocalization_cc198ec371902bf594a5a38b59070986.mtga` — every quoted UI string, hanger title, prompt-button label, hotkey tip, event description, and the Foundations blocker-change announcement.
- **Arena GRE match log** (real limited Bo1 match, 737 `GreToClientEvent` messages): `/Users/brianward/Library/Logs/Wizards of the Coast/MTGA/Player-prev.log.bak-20260822` — timer values, `matchWinCondition`, `attackState`/`blockState`/`attackInfo`/`blockInfo` enums, phase/step/zone enums, `isTapped`, annotation types, `onHover` object ids, and the `power.value` observation proving GRE P/T is pre-modified.
- **Arena Unity preferences**: `~/Library/Preferences/com.wizards.mtga.plist` — `UseVerboseLogs = 1`, `ShowPhaseLadder = 2`, window 2560x1440.
- **Prior in-house brief**: `/Users/brianward/src/mtga/docs/arena-automation-brief-20260906.md` — Arena's macOS AX tree is empty, log-as-oracle pattern, click-swallow and hover-occlusion failure modes.
- **macctl operating guide**: `/Users/brianward/src/macOS-computer-control/AGENTS.md` — exit-code semantics, window-fraction coordinates, reads work while the screen is locked.

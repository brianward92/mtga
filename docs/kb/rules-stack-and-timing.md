# Rules: the stack, timing and priority

> Use this when: you need to know whether you can act right now, what happens if you act, or whether the window you wanted has already closed — especially anywhere in combat.

## Quick reference

- **SORCERY SPEED = your turn + a main phase + empty stack + you have priority.** All four. (CR 117.1a, 307.1)
- **INSTANT SPEED = any time you have priority.** After you cast a spell you get priority back, so you can respond to your own spell (CR 117.3c). In Arena that needs Full Control (**Cmd** on Mac).
- **TARGETS lock on announcement** (CR 601.2c) and are re-checked on resolution (CR 608.2b). If *every* target is illegal the spell does nothing at all, including its untargeted riders. If one target is still legal, the rest resolves.
- **STATE-BASED ACTIONS run only when a player would get priority, and never during resolution** (CR 704.3, 704.4). A creature at lethal damage sits on the battlefield until the next check.
- **BLOCKED STAYS BLOCKED.** Kill the blocker after blocks are declared and your attacker deals combat damage to nobody (CR 509.1h, 510.1c). Killing it *before* blocks is a different play.
- **DAMAGE DIVISION IS FREE.** An attacker blocked by two or more creatures divides its damage among them however its controller chooses (CR 510.1c). There is no damage assignment order and no lethal-first rule — **except for trample** (CR 702.19b). So a 4/4 blocked by two 2/2s kills both.
- **NO PRIORITY between damage assignment and damage being dealt** (CR 510.2). Once you are in the combat damage step it is already too late to save anything.
- **LAST WINDOW before attackers are declared** = beginning of combat step. **Last window before blockers are declared** = declare attackers step.
- **SUMMONING SICKNESS stops exactly two things:** attacking, and activating abilities with {T} or {Q} in the cost (CR 302.6). It does **not** stop blocking.
- **MANA POOL empties at the end of every step and phase** (CR 500.5, 106.4, 703.4q). Mana floated in main phase 1 is gone before attackers are declared.
- **ARENA AUTO-PASSES priority.** Without Full Control or a phase stop you silently skip windows. Mac: **Cmd** = Full Control next action, **Shift+Cmd** = lock it on.
- **ILLEGAL ACTIONS ARE IMPOSSIBLE IN ARENA,** not punished. You get "Can't Cast" / "Can't Play" / "Can't Activate". Budget zero for a rules rewind.
- **TIMER:** run the fuse out with no banked extension and Arena auto-passes your **entire turn** (Queue tips 7–9).
- **QUICK DRAFT = best-of-one vs humans; 7 wins or 3 losses ends the event.** No sideboarding.
- **"MAY" triggers still go on the stack;** the choice happens on resolution (CR 603.5). An intervening "if" is checked twice — on trigger and again on resolution (CR 603.4).

---

## 1. Event context

| Fact | Value | Source |
|---|---|---|
| Draft opponents | 7 bots, **no pick timers** | Arena Codex `Limited_QuickDraft_A`: "you'll still play against other human opponents, you'll be drafted with 7 other AI opponents" |
| Match opponents | **Human players** | same string |
| Match length | **Best-of-one** — one game decides the match | mtg.wiki Arena/Events; Draftsim. Arena Codex confirms Traditional Draft is the Bo3 exception (`Limited_TraditionalDraft_A`) |
| Event ends | **7 wins or 3 losses** | mtg.wiki Arena/Events; Draftsim |
| Entry | 750 gems / 5,000 gold | mtg.wiki Arena/Events; Draftsim |
| Sideboarding | None — there is no game 2. Deck **is** editable between matches | Draftsim |
| Starting life | 20 | CR 103.4 |
| Mulligan | London mulligan; **no free mulligan** (that is multiplayer and Brawl only) | CR 103.5, 103.5c |
| Opening hand | Bo1 hand smoothing: "your starting hand is selected from two random hands, leaning towards the one with the more average land-spell mix" | Arena `Queue_Tip_22` |

**Consequences**

1. A concede costs a full match — one third of the loss budget. Never concede a game the opponent could still misplay away.
2. No plan B inside a match. Do not hold cards for a hypothetical game 2.
3. Opponents are human, so bluffs work in both directions (see §16).

**Quick Draft vs Premier Draft:** only the *drafting* differs (bots, untimed). Both are Bo1, both are 7 wins / 3 losses. Nothing about the stack, priority or timing changes between them. Traditional Draft is the Bo3 one.

---

## 2. Priority windows over a full turn (two-player)

Read the middle column first: those actions have **already happened** by the time you get priority in that step.

| Step / phase | Turn-based actions taken first (no priority) | First to get priority | What it means |
|---|---|---|---|
| Untap | phasing, day/night check, untap all | **nobody** (CR 117.3a) | Cannot respond to an untap. Last chance was the previous end step. |
| Upkeep | none (CR 503.1) | active player | Upkeep triggers are already on the stack (CR 503.1a). |
| Draw | active player draws (CR 504.1) | active player | The card is already drawn. You cannot respond to the draw. |
| Precombat main | Saga lore counters, Attractions (CR 505.4–5) | active player | Sorcery-speed window. Stack must be empty for sorcery-speed plays. |
| Beginning of combat | none in a two-player game (CR 507.1 is multiplayer-only; 507.2 gives priority) | active player | **Last window before attackers are declared.** |
| Declare attackers | attackers declared and tapped (CR 508.1) | active player (CR 508.2) | Attack is locked in; attack triggers already on the stack (CR 508.2b). **Defender's last window before committing blockers.** |
| Declare blockers | blockers declared (CR 509.1) | active player (CR 509.2) | Blocks are locked in. This is where combat tricks are cast. |
| Combat damage | damage assigned, then dealt simultaneously (CR 510.1, 510.2) | active player | **No priority between assignment and dealing** (CR 510.2). Damage is already on the board when you act. |
| Second combat damage step | only if a first/double striker existed as the first damage step began (CR 510.4) | active player | Extra window between first-strike damage and regular damage. |
| End of combat | none (CR 511.1) | active player | "Until end of combat" effects expire at the end of the *phase*, not this step (CR 500.5a). |
| Postcombat main | none | active player | Second sorcery-speed window. |
| End step | none (CR 513.1) | active player | Standard window to spend mana on the opponent's turn. |
| Cleanup | discard to hand size, remove all damage, end "until end of turn" effects (CR 514.1–2) | **normally nobody** (CR 514.3) | Priority only if an SBA fires or a trigger waits; then another cleanup step follows (CR 514.3a). |

**Four things that follow**

1. Your last chance to act before attackers *exist* is the beginning of combat step.
2. The defender's last chance to act with full knowledge of the attack, but before committing blockers, is the declare attackers step.
3. "Removal in response to blockers" happens in the declare blockers step, after blocks are locked. See §3.
4. You cannot save a creature after damage is assigned but before it lands.

---

## 3. Blocked stays blocked

The single highest-value timing rule for combat.

> **CR 509.1h:** "An attacking creature with one or more creatures declared as blockers for it becomes a blocked creature... **A creature remains blocked even if all the creatures blocking it are removed from combat.**"
>
> **CR 510.1c:** "A blocked creature assigns its combat damage to the creatures blocking it. **If no creatures are currently blocking it (if, for example, they were destroyed or removed from combat), it assigns no combat damage.**"

| You want to... | Cast the removal | Result |
|---|---|---|
| Stop a blocker blocking at all, so the attacker connects with the player | **before blockers are declared** (declare attackers step or earlier) | Creature is gone, never blocks, attacker is unblocked and hits the player. |
| Save your attacker from dying while still pushing damage | before blockers are declared | Only option. |
| Kill a blocker after it has blocked | in the declare blockers step | Blocker dies; **your attacker deals no combat damage to anyone** and takes none. Fine 1-for-1, but it pushes zero damage. |
| Push damage past a chump block | you cannot, with removal | The attacker stays blocked and deals nothing. Trample is the only answer. |

**Tapping is not a combat answer after declaration.** CR 506.4a: once a creature is declared as an attacker or blocker, effects that would have kept it from attacking or blocking do not remove it from combat. CR 506.4b: "Tapping or untapping a creature that's already been declared as an attacker or blocker doesn't remove it from combat and doesn't prevent its combat damage." Tap effects only answer combat *before* the relevant declaration.

---

## 4. Combat damage: how it is divided

| Rule | Statement | Consequence |
|---|---|---|
| CR 510.1a | Each attacking and blocking creature assigns damage equal to its power. 0 or less assigns nothing. | — |
| CR 510.1c | A blocked creature blocked by **two or more** creatures assigns its damage "divided as its controller chooses among them." | **No damage assignment order exists in the rules.** No lethal-first requirement. A 4/4 blocked by two 2/2s can assign 2 and 2 and kill both. |
| CR 510.1d | A creature blocking two or more creatures likewise divides its damage as its controller chooses. | — |
| CR 702.19b | **Trample is the exception:** assign lethal damage to every blocker first, then the excess goes where the controller chooses, including the defending player. | Only trample forces a lethal-first split. |
| CR 702.2c | Any nonzero combat damage from a deathtouch source counts as lethal for excess-damage purposes. | A 5/5 deathtouch trampler blocked by two 2/2s assigns 1 + 1 and 3 to the player. |
| CR 510.2 | All assigned combat damage is dealt simultaneously; no player acts between assignment and dealing. | Everything lethal dies together at the next SBA check. |
| CR 120.5 | Damage does not destroy anything by itself; state-based actions do. | See §9. |

**Defensive consequence:** double-blocking a big creature can lose you *both* blockers, because the attacker divides freely. Compute the split the attacker would prefer before you double-block.

**Arena caution:** the setting **Auto Assign Combat Damage** ("Your creatures automatically assign their combat damage") takes the CR 510.1c division choice away from you. Turn it off if you want to make the split yourself.

---

## 5. The stack: what uses it, what does not

CR 405. Last-in, first-out (CR 405.2). Exactly one object resolves at a time, with a full round of priority between each resolution (CR 405.5, 608.1).

| Uses the stack | Does NOT use the stack |
|---|---|
| Spells being cast (CR 405.1, 601.2a) | **Mana abilities** — resolve immediately, cannot be targeted, countered or responded to (CR 605.3b, 405.6c) |
| Activated abilities (CR 602.2a) | **Static abilities** — continuously true, priority does not apply (CR 604.1, 117.2b, 405.6b) |
| Triggered abilities (CR 603.3) | **Replacement effects** — modify an event as it happens (CR 614, 405.6a) |
| — | **Special actions**, including playing a land (CR 116.1, 116.2a, 305.1, 405.6d) |
| — | **Turn-based actions** — untap, draw, declaring attackers, declaring blockers, assigning and dealing combat damage (CR 703, 405.6e) |
| — | **State-based actions** (CR 704.1, 405.6f) |
| — | **Conceding** — happens immediately (CR 405.6g) |

**Easy to get wrong**

- **Playing a land is not a spell.** It never goes on the stack and cannot be responded to (CR 305.1). There is no window between "land played" and "land on battlefield."
- **Declaring attackers and declaring blockers are turn-based actions,** not spells. You cannot respond to the declaration; you get priority only *after* it has happened (CR 508.1/508.2, 509.1/509.2).
- **Several objects put on the stack at once:** active player's go on lowest, then each other player's in APNAP order; a player controlling several chooses their relative order (CR 405.3).
- **Casting during resolution** (LCI's `discover`): the cast spell becomes the topmost object on the stack and **no player receives priority at that moment**; the resolving spell finishes first, then priority passes with the new spell on top (CR 608.2g). A discovered spell *can* therefore be responded to before it resolves.

---

## 6. The four ability types

CR 113.3. Every ability is exactly one of these. Identify it by shape.

| Type | Written as | Uses stack? | When it happens | Respondable? |
|---|---|---|---|---|
| **Spell ability** | body text of an instant or sorcery (CR 113.3a) | it *is* the spell | on resolution, in written order (CR 608.2c) | respond to the spell |
| **Activated** | `[Cost]: [Effect]` — always a colon (CR 113.3b) | Yes (CR 602.2a) | whenever you have priority (CR 117.1b), unless it says otherwise | Yes |
| **Triggered** | starts with **when / whenever / at** (CR 113.3c) | Yes (CR 603.3) | triggers immediately but sits waiting; goes on the stack the next time a player would get priority (CR 117.2a) | Yes — the trigger sits on the stack |
| **Static** | a plain statement of fact (CR 113.3d) | **No** (CR 604.1, 405.6b) | continuously true while the object is in the right zone | **No** |
| *(Mana ability — a subtype of activated or triggered)* | adds mana, no target, not a loyalty ability | **No** (CR 605.3b, 605.4a) | resolves immediately on activation | **No** |

**Recognition traps**

- **"[This permanent] enters tapped" / "enters with N counters" / "As this enters, choose..." is a STATIC ability generating a replacement effect, not a trigger** (CR 603.6d, 614.1c). It never goes on the stack, cannot be responded to, cannot be countered.
- Colon → activated. No colon but when/whenever/at → triggered. Neither → static.
- **A mana ability must meet all four tests** (CR 605.1a): no target, it *could* add mana on resolution, it is not a loyalty ability, and its cost and effect do not move any card to or from a library. It stays a mana ability even when the game state stops it producing mana (CR 605.2). An ability with a target is **not** a mana ability and uses the stack (CR 605.5a).
- **Mana abilities can be activated without priority** — mid-cast, mid-activation, or whenever any rule or effect asks for a mana payment (CR 117.1d, 605.3a).
- **Equip is an activated ability meaning "[Cost]: Attach this permanent to target creature you control. Activate only as a sorcery."** (CR 702.6a). It uses the stack and can be responded to, but only at sorcery speed.
- An **Aura spell is targeted**; the resulting Aura permanent is not (CR 115.1b).

---

## 7. Triggered abilities

| Rule | Statement | Why it matters |
|---|---|---|
| CR 603.2 | The ability triggers automatically; **nothing happens at that moment** | The board does not change until it resolves |
| CR 117.2a / 603.3 | Waiting triggers go on the stack the next time a player would receive priority | Several triggers from one event land together |
| CR 603.2a | Triggers work even when casting spells is illegal; effects that stop *activating* abilities do not stop them | — |
| CR 603.2c | An ability triggers once per occurrence, but repeatedly if one event contains several occurrences | A sweeper fires a death trigger once per creature |
| CR 603.2e | "Becomes" triggers ("becomes blocked", "becomes attached") fire only when the named event happens — **not** if the permanent already entered in that state | "Enters tapped" does not trigger "becomes tapped" |
| CR 603.2g | An event that is **prevented or replaced triggers nothing** | Prevented damage fires no damage triggers |
| CR 603.3b | Multiple triggers: each player in APNAP order puts their own on the stack in **any order they choose**. Active player's go on first, so the non-active player's resolve first | You control the order of your own simultaneous triggers |
| CR 603.4 | **Intervening "if"** ("When X, *if* Y, do Z"): Y is checked when it would trigger — if false it never triggers — and checked **again on resolution**; if false then, it is removed from the stack and does nothing | Two separate checks |
| CR 603.5 | **"May" triggers go on the stack regardless;** the choice is made on resolution. Same for "unless" triggers | You cannot decline a "may" trigger by not putting it on the stack |
| CR 603.6 | Zone-change triggers look for the object in the zone it moved to; if it cannot be found, that part does nothing | — |

**LCI worked example.** Cards reading *"At the beginning of your end step, if you descended this turn..."* carry an intervening "if". Per the official release notes: "if you haven't descended this turn as your end step begins, the ability won't trigger at all. **It's not possible to put a permanent card into your graveyard during the end step in time to have the ability trigger.**" The descend must already have happened. Card: **Stalactite Stalker** {B}, Creature — Goblin Rogue, 1/1, rare — menace; "At the beginning of your end step, if you descended this turn, put a +1/+1 counter on this creature."

---

## 8. Replacement effects vs triggered abilities

CR 614. A replacement effect is a **shield**: it watches for an event and replaces it. The original event **never happens** (CR 614.6), so nothing triggers off it.

**Recognising one (CR 614.1a–e)**

| Wording | Rule |
|---|---|
| "...**instead**..." | 614.1a |
| "**Skip** [your draw step / ...]" | 614.1b |
| "[This permanent] **enters with** ... counters" | 614.1c |
| "**As** [this permanent] enters ..." / "enters **as** ..." | 614.1c |
| "[This permanent] **enters** ..." / "[Objects] **enter** ..." | 614.1c–d |
| "**As** [this permanent] **is turned face up** ..." | 614.1e |

| | Replacement effect | Triggered ability |
|---|---|---|
| Uses the stack | No | Yes |
| Can be responded to | No | Yes |
| Can be countered | No | Yes (by counter-the-ability effects) |
| Timing | applies *as* the event happens | resolves *after* the event, once priority comes round |
| Must already exist | Yes — cannot go back in time (CR 614.4) | must exist when the event occurs (CR 603.7a for delayed triggers) |
| Repeats on itself | No — one bite per event (CR 614.5) | can trigger repeatedly if the event recurs |

**CR 614.4 example, verbatim:** "A player can activate an ability to regenerate a creature in response to a spell that would destroy it. Once the spell resolves, though, it's too late to regenerate the creature."

**Practical test:** ask *when the shield had to be up*. Replacement effects had to be in place already. Triggers give you a window after the fact but before the effect happens.

**LCI example — finality counters** (official release notes): "If a permanent with a finality counter on it would go to a graveyard from the battlefield, exile it instead." It does not stop other zone changes — bounce to hand works normally. "Finality counters aren't keyword counters, and a finality counter doesn't give any abilities to the permanent it's on. If that permanent loses its abilities and then would go to a graveyard, it will still be exiled instead." Multiple finality counters are redundant.

**Ordering choice:** when two or more replacement effects would apply to one event, the affected object's controller chooses one to apply first (CR 616.1). Arena's **Auto Choose Replacement Effects** setting takes that choice away.

---

## 9. State-based actions

CR 704. Automatic, no stack, not controlled by any player, cannot be responded to.

**When they are checked — CR 704.3, verbatim:** "Whenever a player would get priority, the game checks for any of the listed conditions for state-based actions, then performs all applicable state-based actions simultaneously as a single event. If any state-based actions are performed as a result of a check, the check is repeated; otherwise all triggered abilities that are waiting to be put on the stack are put on the stack, then the check is repeated."

**When they are NOT checked — CR 704.4, verbatim:** "Unlike triggered abilities, state-based actions pay no attention to what happens during the resolution of a spell or ability."

That second rule is the one people get wrong. A creature at 0 toughness in the middle of a resolving spell does **not** die at that instant; if the spell later restores its toughness, it survives.

**SBAs that fire in an LCI limited game**

| Rule | Condition | Result |
|---|---|---|
| 704.5a | Player at 0 or less life | That player loses |
| 704.5b | Player attempted to draw from an empty library since the last check | That player loses (at the *next* check, not at the moment of the draw) |
| 704.5d | Token in a zone other than the battlefield | Ceases to exist |
| 704.5f | Creature toughness **0 or less** | To owner's graveyard. **Regeneration cannot replace this** |
| 704.5g | Creature toughness > 0 with total marked damage ≥ toughness | Destroyed. Regeneration *can* replace it |
| 704.5h | Creature toughness > 0 dealt damage by a **deathtouch** source since the last check | Destroyed. Regeneration *can* replace it |
| 704.5j | Two legendary permanents with the same name under one controller | Controller keeps one, rest to graveyard (legend rule) |
| 704.5m | Aura attached to an illegal object/player, or unattached | Aura to owner's graveyard |
| 704.5n | Equipment attached to an illegal permanent or to a player | Becomes unattached, stays on the battlefield |
| 704.5q | Permanent has both a +1/+1 and a -1/-1 counter | Remove N of each, N = the smaller count |

**Two things that follow**

- **-X/-X to 0 toughness (704.5f) and lethal marked damage (704.5g) are different SBAs.** Damage stays marked until cleanup (CR 302.7, 514.2), so a 3-toughness creature that already took 2 damage this turn dies to one more damage. Toughness reduction is not damage but stacks with it: a 3/3 with 2 damage marked dies to a -1/-1 effect (toughness 2, damage 2 ≥ 2).
- **Damage does not destroy anything by itself.** CR 120.5: "Damage dealt to a creature, planeswalker, or battle doesn't destroy it... Rather, state-based actions may destroy a creature." Combat damage is simultaneous (CR 510.2), then everything lethal dies together at the next check.

**Last-known-information subtlety (CR 704.8):** if a permanent leaves the battlefield as part of an SBA check alongside other SBAs, its last known information comes from the game state *before* any of those SBAs ran.

---

## 10. Targeting, and fizzling

| Rule | Statement |
|---|---|
| CR 115.1 / 601.2c | Targets are chosen **as the spell is cast** (or as the ability is put on the stack) and cannot be changed except by an effect that says so |
| CR 601.2e | Legality is checked at announcement. An illegal proposal is reversed (CR 733) |
| CR 608.2b | **On resolution, targets are re-checked.** If **all** targets, for every instance of the word "target", are illegal, the spell or ability **does not resolve at all** — removed from the stack, and a spell goes to its owner's graveyard |
| CR 608.2b | If **at least one** target is still legal, it resolves. Illegal targets are simply unaffected; everything else happens |
| CR 115.3 | The same target cannot be chosen twice for one instance of "target", but can be chosen once per instance if "target" appears in several places |
| CR 115.5 | A spell or ability on the stack is an illegal target for itself |
| CR 115.6 | A spell may allow **zero** targets to be chosen; it is "targeted" only if one or more were actually chosen |
| CR 700.2a | For a modal spell, **a mode with no legal target cannot be chosen** |

**The fizzle check, as a procedure.** Your removal spell is on the stack and the opponent responds:

1. Is at least one target still in the same zone, and still matching every restriction in the spell text (colour, type, tapped/untapped, "attacking or blocking", hexproof, protection)?
2. If **no** → the spell does nothing. Not even the untargeted half. CR 608.2b's own example: Sorin's Thirst "deals 2 damage to target creature and you gain 2 life" — if the creature is an illegal target on resolution, **you do not gain the life**.
3. If **yes** → resolve. Illegal targets are skipped, legal ones are affected.

**"Target" vs "choose" vs "affects"**

| | "target" | "choose" / untargeted |
|---|---|---|
| Chosen when | on announcement (CR 601.2c) | on resolution (CR 608.2d) |
| Locked once chosen | Yes | N/A |
| Re-checked on resolution | Yes — can fizzle | No |
| Stopped by hexproof / protection / "can't be the target of" | Yes | **No** |
| Triggers "whenever this becomes the target of" | Yes | No |

**CR 115.10a, verbatim:** "Just because an object or player is being affected by a spell or ability doesn't make that object or player a target of that spell or ability. **Unless that object or player is identified by the word 'target'**... it's not a target." **CR 115.10b:** "the word 'you' in an object's text doesn't indicate a target."

So a sweeper ("destroy all creatures") kills hexproof creatures, and "each opponent sacrifices a creature" gets past hexproof. Only the literal word *target* is stopped by hexproof, protection, or targeting restrictions.

**LCI worked example — Daring Discovery** {4}{R}, Sorcery, common: "Up to three target creatures can't block this turn. Discover 4." Release notes: "You can cast Daring Discovery with no targets and just discover 4. However, if you choose any targets, and all of those targets are illegal by the time Daring Discovery tries to resolve, it won't resolve and none of its effects will happen. **You won't discover 4.** As long as one target remains legal... you'll discover 4."

---

## 11. Sorcery speed vs instant speed

**The sorcery-speed test — all must be true (CR 117.1a, 307.1):**

1. It is **your** turn, and
2. you are in a **main phase**, and
3. the **stack is empty**, and you have priority.

The "stack is empty" clause is the one that bites: you cannot play a land or cast a creature while one of your own triggers is still on the stack.

| Sorcery-speed thing | Rule |
|---|---|
| Sorcery spells | CR 307.1 |
| Creature spells | CR 302.1 |
| Enchantment spells (unless flash) | CR 303.1 |
| Artifact spells (unless flash) | CR 301.1 |
| Playing a land — a **special action**, no stack, once per turn, your turn only | CR 116.2a, 305.1, 305.2, 305.3 |
| Abilities reading "Activate only as a sorcery" — sorcery timing, though the ability is not a sorcery and you need no sorcery card | CR 602.5d |
| **Equip** | CR 702.6a |
| **Craft** — LCI keyword, "Activate only as a sorcery" in the rules; printed reminder text reads "Craft only as a sorcery" | CR 702.167a; Scryfall |
| **Map tokens** — "{1}, {T}, Sacrifice this token: Target creature you control explores. **Activate only as a sorcery.**" | Scryfall (Map token reminder text); LCI release notes |
| Loyalty abilities — your turn, main phase, empty stack, once per planeswalker per turn | CR 606.3 |

**Instant speed (any time you have priority)**

- Instant spells (CR 117.1a) and anything with **flash**.
- Any activated ability with no stated timing restriction (CR 117.1b) — sacrifice outlets, pump abilities, mana abilities.
- Mana abilities go further: activate them mid-cast, whenever a payment is asked for (CR 117.1d, 605.3a).

**Land drops (CR 305.2a–b, 305.3):** compare lands you *can* play this turn against lands you *have already* played. "A player can't play a land, for any reason, if the number of lands the player can play this turn is equal to or less than the number of lands they have already played this turn." Never on someone else's turn. Effects that **"put"** a land onto the battlefield are not "playing" it and do not use the land drop (CR 305.4).

---

## 12. "May" vs "must", and impossible instructions

| Situation | Rule | Behaviour |
|---|---|---|
| Optional **triggered** ability ("you may draw a card") | CR 603.5 | Goes on the stack **whether or not** you intend to use it. Decide on resolution |
| "...**unless** [X is true / a player pays]" trigger | CR 603.5 | Also goes on the stack normally; the "unless" is handled on resolution |
| Choices offered by a resolving effect | CR 608.2d | Announced as the effect is applied. **You cannot choose an illegal or impossible option.** CR's example: "You may sacrifice a creature. If you don't, you lose 4 life" — a player with no creatures cannot choose the sacrifice |
| Any impossible part of an instruction | CR 101.3 | "Any part of an instruction that's impossible to perform is ignored." Do as much as you can |
| "can't" vs "can" | CR 101.2 | **"Can't" always wins** |
| Activating mana abilities to pay a mandatory cost | CR 118.3c | "Activating mana abilities is not mandatory, even if paying a cost is" |
| Paying a cost you cannot afford | CR 118.3, 601.2h | You cannot. Partial payments are not allowed |
| A {0} cost | CR 118.5, 118.5a | Still has to be actively paid; a {0} spell does not cast itself |
| Cast "without paying its mana cost" with {X} in the cost | CR 107.3b; Arena `Queue_Tip_26`; LCI notes on discover | **X must be 0** |

**Modal spells (CR 700.2):** the mode is chosen as part of casting (700.2a) or as the trigger goes on the stack (700.2b). A mode with no legal target cannot be chosen. If no mode can be chosen for a triggered ability, it is removed from the stack (CR 603.3c). Changing targets never changes the mode (CR 700.2f).

---

## 13. Summoning sickness

**CR 302.6, verbatim:** "A creature's activated ability with the tap symbol or the untap symbol in its activation cost can't be activated unless the creature has been under its controller's control continuously since their most recent turn began. A creature can't attack unless it has been under its controller's control continuously since their most recent turn began."

| Summoning sickness **STOPS** | It does **NOT** stop |
|---|---|
| **Attacking** | **Blocking** — a creature played this turn blocks perfectly well |
| Activating an ability with **{T}** in its cost | Activating an ability with no {T} and no {Q} (e.g. "{2}{B}, Sacrifice this creature: ...") |
| Activating an ability with **{Q}** in its cost | Any **triggered** ability, including enters-the-battlefield triggers |
| — | Any **static** ability (anthems, keywords, buffs) |
| — | Being **equipped**, enchanted, or given counters |
| — | Being **sacrificed** or used as a cost |
| — | **Vigilance, flying, reach, deathtouch** — all work immediately |

**Haste (CR 702.10b, 602.5a)** removes both restrictions.

**Two subtleties**

- The clock is "since **your** most recent turn began", not "since it entered". A creature you gain control of during your turn is summoning sick for you. A creature that entered during the opponent's turn (via flash) is *not* summoning sick on your next turn.
- CR 302.6 applies only to **creatures**. A Map token created this turn is an artifact, so its {T} ability is usable immediately — subject only to its own "Activate only as a sorcery".

**LCI worked example — Restless lands.** Release notes: "If one of the lands in this cycle becomes a creature but you haven't controlled it continuously since your most recent turn began, **you won't be able to activate its mana ability or attack with it that turn.**" **Restless Anchorage**, Land, rare: "This land enters tapped. / {T}: Add {W} or {U}. / {1}{W}{U}: Until end of turn, this land becomes a 2/3 white and blue Bird creature with flying. It's still a land. / Whenever this land attacks, create a Map token." Animating a land you played this turn locks out even its **mana ability**, because that ability has {T} in its cost and the land is now a creature.

---

## 14. Mana: the pool and when it empties

| Rule | Statement |
|---|---|
| CR 106.4 | Mana added goes into your mana pool; it can be spent immediately or held as unspent mana. "Each player's mana pool empties at the end of each step and phase" |
| **CR 500.5** | "As a step or phase ends, if there are effects that last until the end of that step or phase, those effects expire. **Then any unspent mana left in a player's mana pool empties.**" Turn-based action, no stack |
| CR 703.4q | Restates it: "As each step or phase ends, any unspent mana left in a player's mana pool empties. See rule 500.5" |
| CR 106.4b | If you pass priority with mana in your pool, you announce what is there |
| CR 118.3a | Paying mana removes it from the pool; excess remains and is announced |
| CR 605.3b | Mana abilities do not use the stack and resolve immediately |
| CR 605.3c | Once you begin activating a mana ability, you cannot activate it again until it resolves |
| CR 605.4a | **Triggered** mana abilities also skip the stack, resolving immediately after the mana ability that triggered them |
| CR 106.5 | An ability that would produce mana of an undefined type produces **no mana** |

**No mana burn.** Losing unspent mana costs nothing but the mana.

**Pool-emptying boundaries.** The pool empties at the end of each of: untap, upkeep, draw, precombat main, beginning of combat, declare attackers, declare blockers, each combat damage step, end of combat, postcombat main, end step, cleanup. Mana floated in your first main phase is gone before attackers are declared.

**Cost determination (CR 601.2f–h)**

1. Compute total cost: base cost, plus additional costs and increases, minus reductions (you choose the order of reductions).
2. The total cost is then **"locked in"**. Effects that would change it afterwards do nothing.
3. You then get a chance to activate mana abilities (CR 601.2g). **Mana abilities must be activated before costs are paid.**
4. Pay. Partial payments are not allowed; unpayable costs cannot be paid.

CR 601.2h's own example: "You cast Altar's Reap, which costs {1}{B} and has an additional cost of sacrificing a creature. You sacrifice Thunderscape Familiar, whose effect makes your black spells cost {1} less to cast. Because a spell's total cost is 'locked in' before payments are actually made, you pay {B}, not {1}{B}."

---

## 15. Illegal actions: paper vs the client

**Paper — CR 733, "Handling Illegal Actions":** an illegal action is reversed entirely, payments are cancelled, no abilities trigger and no effects apply as a result of the undone action; a spell returns to the zone it came from. The player who had priority keeps it and may redo the action legally or do something else. (Note for grepping: CR 729 is "Subgames", not illegal actions.)

**MTG Arena — illegal actions are impossible, not penalised.** The rules engine only offers legal actions. There is no rules-error state, no judge call, and no rewind. You get a refusal instead. First-party strings from Arena's localization database:

| On-screen string | Localization key |
|---|---|
| "Can't Cast" / "You can't cast this spell right now." | `AbilityHanger/PlayWarning/Cast_Prevented_Title` / `Cast_Prevented_Text` |
| "You can't cast this spell because of {preventerCardName}." | `Cast_Prevented_By_Text` |
| "Can't Play" / "You can't play this card because of an effect." | `Play_Prevented_Title` / `Play_Prevented_Text` |
| "Can't Activate" / "You can't activate abilities on this card." | `Activate_Prevented_Title` / `Activated_Prevented_Text` |
| "You can't activate abilities on this card except mana abilities." | `Activated_Ability_Prevented_Text` |
| "Can't Attack or Block" | `Attack_Block_Prevented_Title` |
| "You May Not Play These Cards" / "...This Card" | `DuelScene/Browsers/NoActionsBrowser_Header_Plural` / `_Single` |

**Consequences**

1. **A greyed-out or unresponsive card is information, not a bug.** The client has already decided the action is illegal. Read the refusal instead of retrying.
2. **Budget zero for recovery.** Every committed action is final.
3. **Gameplay warnings are a separate, softer layer.** `Enable Gameplay Warnings` — "Require confirmation for some actions, for example playing a duplicate legendary" — produces confirmable prompts for *legal but probably unintended* plays: "This card would enter the battlefield tapped", "You already have a copy of this legendary in play. Playing this one will require you to choose which copy to keep.", "This card will be sacrificed after being played if you can't pay the cost." These warn about legal actions, not illegal ones.

---

## 16. Arena client: auto-pass, Full Control, stops, timer

All strings below are quoted verbatim from Arena's own in-client localization database. **Mac bindings differ from PC and Arena states them explicitly.**

**Auto-pass.** Arena skips priority passes it judges you have no use for. Full Control tooltip (`DuelScene/ScreenSpace/Prompts/FullControlToolTip`): "`[Shift + Ctrl]` Lock/Unlock Full Control. **While enabled, Full Control stops at all possible times.**" Without it you silently skip windows — most often the window to respond to your own spell or your own trigger.

**Hotkeys (first-party confirmed)**

| Action | Windows | **macOS** | Source key |
|---|---|---|---|
| Pass priority | Space | Space | `Queue_Tip_6` |
| Full Control, **next action only** | Ctrl | **Cmd** | `Queue_Tip_18` |
| Full Control, **lock on/off** | Shift+Ctrl | **Shift+Cmd** | `Queue_Tip_18`, `FullControlToolTip` |
| Pass priority for the rest of the turn | Shift+Enter | **Shift+Return** | `Queue_Tip_142`: "...allows you to pass priority for the rest of the turn, **unless you're prompted to block**" |
| End Turn (press again quickly to cancel) | Enter | **Return** | `Queue_Tip_1` |
| Float all mana | QQ | QQ | `Queue_Tip_192`: "Pressing 'QQ' will tap all your noncreatures that add mana and 'float' it until you use it, or proceed to the next step or phase" |
| Collection overlay during draft | Alt | **Option** | `Queue_Tip_56`, `Queue_Tip_67` |
| Full Control on touch | — | tap + hold your avatar | `Queue_Tip_63` |

Arena's settings also list `Undo`, `Cycle Chat`, `Pass Priority`, `Pass Turn`, `Show Phases`, `Float All` as gameplay shortcuts, and separately list the key labels `Z`, `L`, `Tab`, `Space`, `Enter`, `Shift + Enter`, `Ctrl`, `Shift + Ctrl`. *Unverified: which key maps to Undo, Cycle Chat or Show Phases — the database does not state the mapping. Read Settings > Gameplay > Keyboard Shortcuts in the client to confirm. The bindings are not rebindable.*

**Blocking is never auto-skipped.** Shift+Return passes the rest of the turn *except* the block prompt (`Queue_Tip_142`). Declaring blockers is always an explicit decision.

**Phase stops.** `Queue_Tip_17`: "Click a phase in **either player's** phase bar to set a 'stop' there, letting you take an action the next time the game reaches that phase." Named stops in the client include "Stop on opponent's declare attackers", "Stop on my declare blockers", "Stop on opponent's beginning of combat", "Stop before Combat", "Stop after Combat", "Stop at End of Turn", "Stop on opponent's end step", "Stop on opponent's combat damage". Use a stop when you know in advance which window you want; use Full Control when you want all of them.

**Information leakage runs both ways — Arena says so.**

- `Queue_Tip_19`: "You can **bluff having a spell** to cast by entering Full Control ('CTRL' key, or 'CMD' key on Mac), or clicking a phase on a Phase Bar to set a stop."
- `Queue_Tip_20`: "You can **bluff not having a spell** to cast by quickly passing or clicking End Turn."

Because the client auto-passes when there is nothing to do, a visible pause on the opponent's priority is *weak* evidence they had something available — a stop or Full Control produces the same pause with an empty hand.

**Mana and auto-tap**

- `Auto Tap` — "Automatically taps mana sources and spends mana when paying costs" (`AutoPay_ToolTip`). It mistaps with multi-colour and utility lands.
- To control which lands get tapped: `Queue_Tip_2` — "**To tap specific lands to cast a spell, tap them before starting to cast your spell.**" `Queue_Tip_4` — "As you drag a spell over the battlefield, the lands that will be tapped to cast it become highlighted." Check the highlight before releasing.

**Automation settings that silently decide for you**

| Setting | Tooltip (verbatim) | What you lose |
|---|---|---|
| `Auto Order Triggered Abilities` | "Automatically order triggered abilities rather than manually ordering them." | The CR 603.3b choice of ordering your own simultaneous triggers |
| `Auto Choose Replacement Effects` | "Automatically choose the order for replacement effects rather than manually selecting them." | The CR 616.1 ordering choice |
| `Auto Assign Combat Damage` | "Your creatures automatically assign their combat damage." | The CR 510.1c choice of how to divide damage among multiple blockers |

Turn all three off if the agent intends to make those decisions itself.

**The turn timer (the "fuse")**

| Rule | Source key |
|---|---|
| "If you play through **three of your turns without seeing the timer fuse**, you'll get a **30-second extension** for a future turn." | `Queue_Tip_7` |
| "If your timer fuse runs down, you'll **automatically use one of your 30-second extensions**, if available." | `Queue_Tip_8` |
| "If your timer fuse runs down and you **don't have any time extensions**, you'll **automatically pass through the current turn**." | `Queue_Tip_9` |
| On-screen when an extension burns: "TIMEOUT USED" | `DuelScene/TimeoutUsed` |

The failure mode of thinking too long is not a warning — it is losing the whole turn. Fast turns bank extensions; extensions pay for the one turn where the combat math is genuinely hard.

---

## 17. LCI keywords: stack and timing

**Craft — an activated ability, sorcery speed.** CR 702.167a: "Craft with [materials] [cost]" means "[Cost], Exile this permanent, Exile [materials] from among permanents you control and/or cards in your graveyard: Return this card to the battlefield transformed under its owner's control. **Activate only as a sorcery.**" (Printed reminder text on LCI cards reads "Craft only as a sorcery".) Consequences: it uses the stack and can be responded to; exiling the permanent is a **cost**, so it is already gone before anyone can respond, and countering the ability leaves the card exiled permanently. Materials may be split between permanents and graveyard cards (CR 702.167b).

**Discover — casting during resolution.** CR 701.57a: "Discover N" means "Exile cards from the top of your library until you exile a nonland card with mana value N or less. You may cast that card without paying its mana cost if the resulting spell's mana value is less than or equal to N. If you don't cast it, put that card into your hand. Put the remaining exiled cards on the bottom of your library in a random order."

- The cast happens **during resolution**. Per CR 608.2g no player gets priority at that instant; the discovered spell becomes the topmost object on the stack and the discover effect finishes resolving first. **The opponent can then respond to the discovered spell before it resolves.**
- "When you discover, you **must** exile cards. The only optional part of the ability is whether you cast the exiled card or put it into your hand."
- "If the discovered card has {X} in its mana cost, you **must choose 0** as the value of X."
- "If you can't cast the discovered card (perhaps because there are no legal targets for the spell), you'll put it into your hand."
- "Some spells and abilities that cause you to discover may require targets. **If each target chosen is an illegal target as that spell or ability tries to resolve, it won't resolve and you won't discover.**"
- Cards are exiled **face up** — all players see them.

**Explore — no priority window inside it.** CR 701.44a: reveal the top card of your library; if it is a land card, put it into your hand; otherwise put a +1/+1 counter on the exploring permanent and you may put the revealed card into your graveyard. Release notes: "Once an ability that causes a creature to explore begins to resolve, **no player may take any other actions until it's done**. Notably, opponents can't try to remove the exploring creature after you reveal a nonland card but before it receives a counter." (This is CR 117.2e applied.) If the exploring creature has left the battlefield it still explores, using last known information (CR 701.44c).

**Descend — an ability word, so read the actual ability.** It flags cards that count permanent cards in your graveyard; it has no rules meaning of its own.
- "At the beginning of your end step, if you descended this turn" triggers carry an **intervening "if"** (CR 603.4) — see §7.
- "Tokens are not cards, and while tokens are put into the graveyard before ceasing to exist, that action **doesn't count as a player having descended**."
- Descend N and fathomless descent count permanent cards **currently in** the graveyard, no matter when they arrived.

**Map tokens — sorcery speed.** A colorless artifact with subtype Map: "{1}, {T}, Sacrifice this token: Target creature you control explores. **Activate only as a sorcery.**" So a Map cannot be cracked during combat as a trick. It is an artifact, not a creature, so CR 302.6 does not apply: a Map created this turn can be used this turn (at sorcery speed).

**Finality counters — a replacement effect.** See §8.

**Restless lands — summoning sickness.** See §13.

---

## 18. LCI cards you can hold priority for

Complete list of LCI instants plus every card with **flash**, verified against Scryfall (`e:lci (type:instant or keyword:flash)`, 35 results). This is the timing list; the removal and combat briefs own the evaluation.

| Cost | Card | Type | Rarity | Effect |
|---|---|---|---|---|
| {W} | Acrobatic Leap | Instant | C | +1/+3 and flying; **untap it** |
| {U} | Relic's Roar | Instant | C | Target artifact or creature becomes a base 4/3 Dinosaur artifact creature |
| {U} | Cogwork Wrestler | **Flash** Artifact Creature — Gnome **1/2** | C | ETB: target creature an opponent controls gets -2/-0 |
| {R} | Dreadmaw's Ire | Instant | U | Target **attacking** creature gets +2/+2, trample, and a destroy-an-artifact combat-damage trigger |
| {1}{R} | **Abrade** | Instant | C | 3 damage to target creature, **or** destroy target artifact |
| {1}{R} | Ancestors' Aid | Instant | C | +2/+0 and first strike; create a Treasure |
| {1}{B} | **Bitter Triumph** | Instant | U | Additional cost: discard a card or pay 3 life. Destroy target creature or planeswalker |
| {1}{U} | Brackish Blunder | Instant | C | Bounce target creature; Map token if it was tapped |
| {1}{W} | **Cosmium Blast** | Instant | C | 4 damage to target **attacking or blocking** creature |
| {1}{G} | Disturbed Slumber | Instant | C | A land you control becomes a 4/4 Dinosaur with reach and haste; **it must be blocked this turn if able** |
| {1}{U} | Eaten by Piranhas | **Flash** Aura | U | Enchanted creature loses all abilities and is a base 1/1 black Skeleton |
| {1}{W} | Family Reunion | Instant | C | Your creatures get +1/+1, **or** gain hexproof |
| {1}{B} | Fanatical Offering | Instant | C | Additional cost: sac an artifact or creature. Draw two, create a Map |
| {1}{B} | Fungal Fortitude | **Flash** Aura | C | +2/+0; when enchanted creature dies, return it to the battlefield tapped |
| {1}{W} | **Get Lost** | Instant | **R** | Destroy target creature, enchantment or planeswalker; its controller creates two Maps |
| {1}{U} | Lodestone Needle // Guidestone Compass | **Flash** Artifact (craft DFC) | U | — |
| {1}{U} | Malcolm, Alluring Scoundrel | **Flash** Legendary Creature 2/1 | R | — |
| {1}{W} | Spring-Loaded Sawblades // Bladewheel Chariot | **Flash** Artifact (craft DFC) | U | — |
| {1}{G} | Staggering Size | Instant | C | +3/+3 and trample |
| {1}{R} | Zoyowa's Justice | Instant | U | Shuffle target artifact/creature with mana value 1+ into its owner's library; that player discovers X |
| {2}{B} | Another Chance | Instant | C | You may mill 2; return up to two creature cards from your graveyard to hand |
| {2}{U} | Confounding Riddle | Instant | U | Look at top 4, one to hand and rest to graveyard, **or** counter unless they pay {4} |
| {2}{G} | Huatli's Final Strike | Instant | C | Your creature gets +1/+0 and deals damage equal to its power to target creature an opponent controls |
| {2}{R} | Idol of the Deep King // Sovereign's Macuahuitl | **Flash** Artifact (craft DFC) | C | ETB: 2 damage to any target |
| {2}{G} | In the Presence of Ages | Instant | C | Reveal top 4; take a creature card and/or a land card, rest to graveyard |
| {1}{B}{B} | Join the Dead | Instant | C | -5/-5; **-10/-10 instead with descend 4** |
| {2}{W} | Kutzil's Flanker | **Flash** Creature 3/1 | R | — |
| {2}{G} | Malamet Scythe | **Flash** Equipment | C | ETB: attach to target creature you control; equipped creature gets +2/+2. Equip {4} |
| {2}{W} | Mischievous Pup | **Flash** Creature — Dog **3/1** | U | ETB: return up to one other target permanent you control to hand |
| {2}{U} | Tishana's Tidebinder | **Flash** Creature 3/2 | R | — |
| {2}{U}{U} | Out of Air | Instant | C | Counter target spell; **costs {2} less if it targets a creature spell** |
| {3}{U} | Unlucky Drop | Instant | C | Target artifact or creature's owner puts it on top or bottom of their library |
| {3}{U}{U} | Hurl into History | Instant | U | Counter target artifact or creature spell; discover X |
| {5}{W} | Quicksand Whirlpool | Instant | C | Exile target creature; **costs {3} less if it targets a tapped creature** |
| {6} | Runaway Boulder | **Flash** Artifact | C | ETB: 6 damage to target creature an opponent controls. Cycling {2} |

**Two cost-reduction traps.** **Out of Air** {2}{U}{U} is a **two-mana** counterspell against a creature spell and a four-mana one otherwise. **Quicksand Whirlpool** {5}{W} is a **three-mana exile effect against a tapped (i.e. attacking) creature** — read {5}{W} on the card and think {2}{W} in combat.

**Not flash, despite looking like it:** *Self-Reflection* {4}{U}{U} is a **sorcery** with Flashback {3}{U}. Flashback is permission to cast from the graveyard, not a timing permission — still sorcery speed.

---

## Sources

- **Magic: The Gathering Comprehensive Rules**, effective August 7, 2026. Downloaded from https://magic.wizards.com/en/rules → `https://media.wizards.com/2026/downloads/MagicCompRules 20260819.txt`. The local working copy is byte-identical to the official download (md5 `fb8bffb15798ecff075d383589c2f263`). Sections used: 101, 103, 106, 107, 113, 115, 116, 117, 118, 120, 301–307, 405, 500, 503–514, 601–608, 614, 616, 700–704, 701.44, 701.57, 702, 702.167, 733.
- **Wizards of the Coast, "The Lost Caverns of Ixalan Release Notes"**: https://magic.wizards.com/en/news/feature/the-lost-caverns-of-ixalan-release-notes — craft, discover, explore, descend, Map tokens, finality counters, Restless lands, Daring Discovery.
- **MTG Arena in-client localization database** (first-party), table `Loc`, column `enUS`. Keys cited inline: `DuelScene/ScreenSpace/Prompts/FullControlToolTip`, `DuelScene/SettingsMenu/Gameplay/*`, `MainNav/Settings/Gameplay/*`, `AbilityHanger/PlayWarning/*`, `DuelScene/Browsers/NoActionsBrowser_*`, `DuelScene/PhaseLadder/PhaseStop/*`, `DuelScene/TimeoutUsed`, `Codex/WaysToPlay/Formats/Limited_QuickDraft_A`, `Limited_TraditionalDraft_A`, `Match/QueueTips/Queue_Tip_{1,2,4,6,7,8,9,17,18,19,20,22,26,56,63,67,142,192}`.
- **Scryfall API** (https://api.scryfall.com) — every card name, mana cost, type line, power/toughness, rarity and oracle text in this file. Bulk query: `e:lci (type:instant or keyword:flash)`, unique=cards, 35 results.
- **MTG Wiki, "Magic: The Gathering Arena/Events"**: https://mtg.wiki/page/Magic:_The_Gathering_Arena/Events — Quick Draft entry fee, Bo1, 7 wins / 3 losses, 7 bot drafters.
- **MTG Wiki, "Magic: The Gathering Arena"**: https://mtg.wiki/page/Magic:_The_Gathering_Arena — Bo1 hand smoothing.
- **Draftsim, "MTG Arena Draft Guide"**: https://draftsim.com/mtg-arena-draft-guide/ — Quick Draft event structure, corroborating the above.

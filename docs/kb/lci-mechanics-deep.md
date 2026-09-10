# LCI mechanics, in rules detail

> Use this when: an LCI mechanic is on the board or the stack and the answer changes a block, an attack, or whether to hold mana — descend counts, discover, craft, explore, Maps, Caves.

Companion file: `lci-combat-reference.md` (generated instant-speed / removal / body-size tables for the whole set). This file covers the six mechanics only. Where the two overlap, both were built from the same Scryfall data.

## Quick reference

| # | Fact | Consequence |
|---|---|---|
| 1 | **Descend statics are checked continuously.** At **3** permanent cards in a graveyard, treat every descend-4 body as already on — one creature dying in the combat you are resolving flips it. | See §1 resize table before every block. |
| 2 | **Permanent card = artifact, battle, creature, enchantment, land, planeswalker.** Not instants, not sorceries, **not tokens**. | Count the graveyard, skip instants/sorceries. Sacrificing a Map or Treasure does **not** descend. |
| 3 | Only **16%** of the draftable pool (21% of commons) is instants/sorceries. | ~4 of every 5 cards in a graveyard count. **Descend 4 arrives fast.** Do not assume a full graveyard is a low count. |
| 4 | The **mechanics' own abilities** are all sorcery-speed: craft, Map tokens, Hidden Cave discover, Captivating Cave, Seeker of Sunlight `{G}`, Guidestone Compass, Geode Grotto. | An untapped Map or Hidden Cave is never a combat trick. |
| 5 | **But nine mechanic cards ARE instant-speed and do ruin combat.** | §2. Trumpeting Carnosaur `{4}{R}{R}` is the worst — `{2}{R}`, discard it **from hand**: 3 damage. It never appears on board first. |
| 6 | **Crew has no timing restriction** (CR 702.122a). | Watertight Gondola (4/4, crew 1) and Bladewheel Chariot (5/5, crew 1) can be crewed **after attackers are declared** and ambush-block. |
| 7 | Evasion gained **after** a legal block is declared does not undo the block (CR 509.1b). | Blocking Didact Echo `{4}{U}` on the ground is safe once declared, even if it gains flying. Only its state **at declare-blockers** matters. |
| 8 | **Discover N** = mana value **N or less** (≤), fixed N. **Cascade** = strictly less than the source spell's MV. | Discover 3 finds a 3-drop. |
| 9 | Discover: exiling is **mandatory**, only cast-vs-hand is a choice. X in the discovered card is forced to **0**. Mandatory additional costs still must be paid. Cost reductions never change mana value. | Gargantuan Leech `{7}{B}` is MV 8 forever — discover 3/4/5 can never find it. |
| 10 | A discovered spell goes on the stack during resolution; the opponent **gets priority and can respond**. A discovered creature is summoning sick. | |
| 11 | Craft: whole cost (mana + exile this permanent + exile materials) is paid **on activation**, sorcery speed. Back face is a new object — **summoning sick**, cannot attack that turn. Only **Sunbird Effigy** has haste. | Materials go to **exile**, so crafting can *lower* your descend count. |
| 12 | Explore: land → hand, **no counter, no choice**. Nonland → **+1/+1 counter is mandatory**; the only decision is bin it or leave it on top. | With 17 lands in 40, a land comes up **42.5%** of the time. Do not plan combat on the counter. |
| 13 | Map token cost: **`{1}`, `{T}`, Sacrifice, target a creature YOU control.** No summoning sickness (CR 302.6 is creatures-only). | Use it the turn it is made — but in your main phase. With no creature on board it cannot be activated at all. |
| 14 | **There is no "descend 10" in Magic.** LCI has only descend 4 and descend 8 (CR 207.2c). | The tens are **discover 10**: Hit the Mother Lode `{4}{R}{R}{R}`, Swashbuckler's Whip `{1}`. |
| 15 | In Limited, Geological Appraiser is **`{2}{R}{R}` 3/2**. The `{3}{R}{R}` A- version is Historic/Brawl only. | It will never appear in a draft game. |
| 16 | Quick Draft = **bot draft, Best-of-One, 7 wins or 3 losses.** | No sideboard, no game two, no information carried forward. |

---

## 1. Combat: the descend resize checklist

This is the section to open when declaring blockers. Descend statics change **mid-combat**, including between the first-strike and regular damage steps.

### Before declaring blockers, in order

1. **Count permanent cards in the OPPONENT's graveyard.** Everything except instants and sorceries. Tokens are not there (they cease to exist). That number is their descend count.
2. **At 3, treat every descend-4 body as already on.** One creature dying in this combat flips it before damage.
3. **At 7, treat descend 8 as live.**
4. **Check whether they can raise the count at instant speed** — see §2, the mill abilities. That is the trap the count alone does not show.
5. **Evasion is locked in at declare-blockers.** CR 509.1b: an attacker gaining or losing evasion after a legal block does not affect that block. So a ground block on Didact Echo stands even if it gains flying afterwards — but if it already has flying when you declare, the block is **illegal**.

### Statics — continuously checked, these change mid-combat

| Card | Cost | R | Base | At descend 4 | At descend 8 |
|---|---|---|---|---|---|
| Basking Capybara | `{1}{G}` | C | 1/3 | **4/3** (+3/+0) | — |
| Echo of Dusk | `{1}{B}` | C | 2/2 | **3/3 lifelink** | — |
| Frilled Cave-Wurm | `{3}{U}` | C | 2/5 | **4/5** (+2/+0) | — |
| Didact Echo | `{4}{U}` | C | 3/2 | **3/2 flying** | — |
| Akawalli, the Seething Tower | `{1}{B}{G}` | U | 3/3 | **5/5 trample** | **7/7 trample, max one blocker** |
| Watertight Gondola (craft back of Waterlogged Hulk `{U}`) | — | U | 4/4 Vehicle, vigilance, crew 1 | — | **can't be blocked** |
| The Ancient One | `{U}{B}` | M | 8/8 | — | **can attack/block only at 8+** |
| Souls of the Lost | `{1}{B}` | R | */\*+1 | power = permanent cards in their graveyard, toughness = that +1 | |
| Song of Stupefaction | `{1}{U}` | C | Aura on creature or Vehicle | enchanted permanent gets **−X/−0**, X = permanent cards in your graveyard | |

The four commons in that table are the ones that will actually flip on you: **Basking Capybara 1/3 → 4/3, Echo of Dusk 2/2 → 3/3 lifelink, Frilled Cave-Wurm 2/5 → 4/5, Didact Echo → flying.**

### Triggered descend — two checks, both must pass

Intervening "if" (CR 603.4): the ability **checks the graveyard when it would trigger** — if short, it does not trigger at all — and **checks again on resolution**. Failing either does nothing.

| Card | Cost | R | Body | Trigger |
|---|---|---|---|---|
| Coati Scavenger | `{2}{G}` | U | 3/2 | descend 4 ETB → return a permanent card from graveyard to hand |
| Council of Echoes | `{4}{U}{U}` | U | 4/4 flying | descend 4 ETB → bounce **up to one** target nonland permanent **other than itself** |
| Stinging Cave Crawler | `{2}{B}` | U | 1/3 deathtouch | descend 4 **on attack** → draw 1, lose 1 |
| Malamet Veteran | `{4}{G}` | C | 5/4 trample | descend 4 **on attack** → +1/+1 counter on target creature |
| Starving Revenant | `{2}{B}{B}` | R | 4/4 | descend 8 → drain 1 on each card you draw |
| The Everflowing Well | `{2}{U}` | R | artifact | descend 8 at upkeep → transform into The Myriad Pools |
| Uchbenbak, the Great Mistake | `{3}{U}{B}` | U | 6/4 vigilance menace | descend 8: `{4}{U}{B}` from graveyard, **sorcery only**, returns with a finality counter |

### One-shot

| Card | Cost | R | Effect |
|---|---|---|---|
| Join the Dead | `{1}{B}{B}` | C | **Instant.** −5/−5; **−10/−10** instead at descend 4 |
| Chupacabra Echo | `{2}{B}{B}` | U | 3/2; ETB target creature an opponent controls gets **−X/−X**, X = permanent cards in your graveyard |
| Terror Tide | `{2}{B}{B}` | R | **Sorcery.** **All** creatures get −X/−X. X checked **only once, on resolution** |
| Squirming Emergence | `{1}{B}{G}` | R | **Sorcery.** Reanimate a nonland permanent card with MV ≤ X. The target **counts itself** toward X; rechecked on resolution |
| Wail of the Forgotten | `{U}{B}` | R | **Sorcery.** Choose one; **one or more** at descend 8, checked **as you cast** |
| Molten Collapse | `{B}{R}` | R | **Sorcery.** Choose one; **both** if you descended this turn |

Terror Tide is a sorcery, so it can never blow out a block — but it can wipe the board in their main phase, and it kills their own creatures too.

### "If you descended this turn" — end-step triggers only

Official ruling, verbatim: *"Abilities that begin with 'At the beginning of your end step, if you descended this turn' will trigger only once during your end step, no matter how many times you descended. However, if you haven't descended this turn as your end step begins, the ability won't trigger at all. It's not possible to put a permanent card into your graveyard during the end step in time to have the ability trigger."* Also: *"These cards don't need to have been under your control at the time you descended."*

| Card | Cost | R | Body | Payoff at your end step |
|---|---|---|---|---|
| Ruin-Lurker Bat | `{W}` | U | 1/1 flying lifelink | scry 1 |
| Deep Goblin Skulltaker | `{2}{B}` | C | 2/2 menace | +1/+1 counter on itself |
| Broodrage Mycoid | `{3}{B}` | C | 4/3 | 1/1 black Fungus that **can't block** |
| Child of the Volcano | `{3}{R}` | C | 3/3 trample | +1/+1 counter on itself |
| Enterprising Scallywag | `{1}{R}` | U | 2/2 | a Treasure |
| Canonized in Blood | `{1}{B}` | U | enchantment | +1/+1 counter on target creature you control |
| Zoyowa Lava-Tongue | `{B}{R}` | U | 2/2 deathtouch | each opponent discards or sacrifices, **or takes 3** |
| Stalactite Stalker | `{B}` | R | 1/1 menace | +1/+1 counter on itself |
| Corpses of the Lost | `{2}{B}` | R | enchantment | pay 1 life to return it to hand |
| Brass's Tunnel-Grinder | `{2}{R}` | R | artifact | a bore counter; 3 of them → transform into Tecutlan, a Cave |
| The Mycotyrant | `{1}{B}{G}` | M | \*/\* trample | X Fungus tokens, X = **number of times** you descended this turn |

**Procedure:** if you want an end-step payoff and nothing has died, descend **during your second main phase at the latest** — mill, discard a permanent card, or trade in combat. You cannot do it during the end step.

### Descend gotchas

1. **Tokens never count.** Sacrificing Maps, Treasures, Golems or Fungus tokens does not descend and does not raise the count.
2. **Instants and sorceries in the graveyard are dead weight** for descend — but only 16% of the pool is instants/sorceries, so this rarely saves you. Assume the count is high.
3. **Craft materials go to EXILE, not the graveyard.** Crafting with graveyard cards *lowers* your descend count.
4. **"Descended this turn" and "descend N" are different questions.** CR 700.11: cards that descended *"are not required to still be in that graveyard."* So exiling their graveyard undoes the **count** but not the fact that they descended this turn.
5. **Matzalantli, the Great Door `{3}` counts permanent TYPES, not cards** — *"Activate only if there are four or more permanent types among cards in your graveyard."* Eight creature cards is one type. Different number; do not reuse it. Its back face **The Core** is a Cave with fathomless descent (`{T}`: add X mana) — and that is a **mana ability**, so it does not use the stack and cannot be responded to.
6. **Souls of the Lost `{1}{B}` counts itself only while it is in the graveyard** (its P/T ability works in all zones). On the battlefield its power is exactly the number of permanent cards in the graveyard.

---

## 2. What is instant-speed here, and what is not

### The mechanics' own abilities are all sorcery-speed

| Ability | Rule |
|---|---|
| Craft | CR 702.167a — "Activate only as a sorcery" |
| Map token | CR 111.10s — "Activate only as a sorcery" |
| Hidden Cave discover (all five) | printed |
| Captivating Cave's `{4}` two counters | printed |
| Seeker of Sunlight `{G}` explore | printed |
| Guidestone Compass explore (craft back of Lodestone Needle `{1}{U}`) | printed |
| Geode Grotto haste-pump (back of Dowsing Device) | printed |
| Buried Treasure `{2}` discover 5 | printed |
| Digsite Conservator `{2}` graveyard-exile | printed |
| Uchbenbak recursion | printed |
| Descend / fathomless descent | not an action — a passive count |

CR 307.5: "only as a sorcery" = **you have priority, your main phase, empty stack**.

### But these mechanic cards DO act at instant speed — play around them

| Card | Cost | R | Instant-speed threat |
|---|---|---|---|
| **Trumpeting Carnosaur** | `{4}{R}{R}` | R | **`{2}{R}`, discard it from HAND: 3 damage to a creature.** Needs nothing on board. The most-missed trick in the format. |
| **Braided Net** | `{2}{U}` | R | `{T}`, remove a net counter: **tap another target nonland permanent**, and its activated abilities shut off while tapped. Three uses. Removes a blocker, or taps a creature before it can attack. |
| **Swashbuckler's Whip** | `{1}` | U | Equip `{1}`. Grants **reach**, **`{2}`,`{T}`: tap target artifact or creature**, and `{8}`,`{T}`: discover 10. The tapper is instant-speed. |
| **Stalactite Stalker** | `{B}` | R | `{2}{B}`, sacrifice it: target creature gets **−X/−X**, X = its own power. Grows every turn it descends. |
| **Cavernous Maw** | — (land) | U | `{2}`: becomes a **3/3 Elemental**. No timing restriction. Live only if (other Caves you control + Cave cards in graveyard) ≥ 3. A surprise blocker. |
| **Restless Anchorage** | — (land) | R | `{1}{W}{U}`: becomes a **2/3 flier**. A surprise flying blocker. |
| **Idol of the Deep King** | `{2}{R}` | C | **Flash.** ETB 2 damage to any target. A common. |
| **Spring-Loaded Sawblades** | `{1}{W}` | U | **Flash.** ETB **5 damage to a target TAPPED creature an opponent controls** — punishes attacking, does nothing to a blocker. |
| **Lodestone Needle** | `{1}{U}` | U | **Flash.** ETB tap a creature and put two stun counters on it. |
| **Crew** (CR 702.122a) | — | — | **No timing restriction.** Watertight Gondola and Bladewheel Chariot (5/5) can be crewed after attackers are declared, then block. |

### They can raise their descend count at instant speed

These flip descend-4 and descend-8 statics mid-combat without anything dying:

| Card | Cost | R | Instant-speed mill |
|---|---|---|---|
| Waterlogged Hulk | `{U}` | U | `{T}`: mill a card |
| Throne of the Grim Captain | `{2}` | R | `{T}`: mill two cards |
| The Ancient One | `{U}{B}` | M | `{2}{U}{B}`: draw then discard, and mill the discard's MV |
| Matzalantli, the Great Door | `{3}` | R | `{T}`: draw then discard — a discarded permanent card descends |

Dread Osseosaur (craft back of Visage of Dread `{1}{B}`, 5/4 menace) mills two **on enter or attack**, which resolves before blockers.

**Conclusion:** an untapped Map, Hidden Cave or Captivating Cave threatens nothing during combat. An untapped **Braided Net, Swashbuckler's Whip, Cavernous Maw, Restless Anchorage, or a Vehicle with a creature to crew it** does. So does `{2}{R}` open with an unknown red hand.

---

## 3. Discover

**CR 701.57a, verbatim:** *"Discover N" means "Exile cards from the top of your library until you exile a nonland card with mana value N or less. You may cast that card without paying its mana cost if the resulting spell's mana value is less than or equal to N. If you don't cast it, put that card into your hand. Put the remaining exiled cards on the bottom of your library in a random order."*

### Procedure

| Step | What happens | Optional? |
|---|---|---|
| 1 | Exile the top card **face up** — all players see it | No |
| 2 | Land, or nonland with MV > N? → exile another. Repeat. | No |
| 3 | Stop at the first nonland with **MV ≤ N**. That is the discovered card. | No |
| 4 | Cast it without paying its mana cost, **or** put it into your hand | **Yes — the only choice in the ability** |
| 5 | Every other exiled card goes to the **bottom in random order** | No |

### The cost rules that get misplayed

| Rule (official ruling, verbatim) | Consequence |
|---|---|
| *"A spell's mana value is determined only by its mana cost. Ignore any alternative costs, additional costs, cost increases, or cost reductions."* (also CR 202.3, and CR 601.2f: reductions change **total cost**, not mana cost) | **Gargantuan Leech `{7}{B}` is MV 8 forever.** Discover 3/4/5 skips it and buries it, even when Caves make it cost `{1}`. |
| *"If you cast a spell 'without paying its mana cost', you can't choose to cast it for any alternative costs. You can, however, pay additional costs. If the spell has any mandatory additional costs, you must pay those to cast it."* | Discovering **Fanatical Offering `{1}{B}`** still makes you sacrifice an artifact or creature. Discovering **Souls of the Lost `{1}{B}`** still makes you discard a card or sacrifice a permanent. If you won't pay, take it to hand. |
| *"If the discovered card has {X} in its mana cost, you must choose 0 as the value of X."* (CR 107.3b) | Discovering **Jadelight Spelunker `{X}{G}`** casts it as a **1/1 that explores zero times**. Take it to hand instead. |
| While in the library, X = 0 for the MV check (CR 107.3a: X equals the announced value only on the stack) | Jadelight Spelunker is **MV 1 in the library**, so discover 3 *will* stop on it. |
| *"If you can't cast the discovered card (perhaps because there are no legal targets), you'll put it into your hand."* | A removal spell with no target is not lost. |
| *"When you discover, you must exile cards. The only optional part is whether you cast the exiled card or put it into your hand."* | There is no decline button. |
| *"Some spells and abilities that cause you to discover may require targets. If each target chosen is an illegal target as that spell or ability tries to resolve, it won't resolve and you won't discover."* | See Daring Discovery below. |

### Timing

The free spell is cast **during the resolution** of the discover source (Hit the Mother Lode ruling: *"You won't create any Treasure tokens until you finish discovering"*). It is still on the stack when that source finishes, and **CR 117.3b** gives the active player priority then. So:

- **The opponent can respond to the free spell.** It is not uncounterable and not an instant.
- A discovered creature enters **after** the source resolves → summoning sick, cannot attack that turn.

### Discover vs cascade

| | Discover N (CR 701.57a) | Cascade (CR 702.85a) |
|---|---|---|
| Threshold | mana value **N or less** (≤) | mana value **less than** the cascading spell's MV |
| N comes from | a fixed printed number | the cascading spell's own mana cost |
| Hits MV exactly = N | **Yes** | n/a |

### The 23 LCI discover cards

| Card | Cost | R | Discover |
|---|---|---|---|
| Etali's Favor | `{2}{R}` | C | Aura on a creature you control; ETB **discover 3**; +1/+1 and trample |
| Daring Discovery | `{4}{R}` | C | Up to three **target** creatures can't block; **discover 4** |
| Primordial Gnawer | `{4}{B}` | C | 5/2; **on death, discover 3** |
| Buried Treasure | `{2}` | C | Treasure; `{5}`, exile it from your graveyard: **discover 5**, sorcery only |
| Hidden Cataract / Courtyard / Necropolis / Nursery / Volcano | — | C | Caves, enter tapped, tap for `{U}`/`{W}`/`{B}`/`{G}`/`{R}`; `{4}`+colour, `{T}`, Sac: **discover 4**, sorcery only |
| Walk with the Ancestors | `{4}{G}` | C | Return up to one permanent card from graveyard to hand; **discover 4** |
| Geological Appraiser | `{2}{R}{R}` | U | 3/2; ETB **"if you cast it"**, discover 3 |
| Curator of Sun's Creation | `{3}{R}` | U | 3/3; whenever you discover, discover again for the same value — **only once each turn** |
| Digsite Conservator | `{2}` | U | 2/1; on death **you may pay `{4}`** to discover 4 |
| Zoetic Glyph | `{2}{U}` | U | Aura on an artifact (makes it a 5/4 Golem); **discover 3 when the Aura hits the graveyard from the battlefield** |
| Hurl into History | `{3}{U}{U}` | U | **Instant.** Counter an artifact/creature spell, discover X = that spell's MV |
| Zoyowa's Justice | `{1}{R}` | U | **Instant.** Shuffle target artifact/creature **with MV 1 or greater** into its owner's library; **its controller** discovers X = its MV |
| Caparocti Sunborn | `{2}{R}{W}` | U | 4/4; on attack, may tap two untapped artifacts/creatures → discover 3 |
| Swashbuckler's Whip | `{1}` | U | Equipment, equip `{1}`; grants reach, `{2}`,`{T}` tapper, and `{8}`,`{T}`: **discover 10** |
| Trumpeting Carnosaur | `{4}{R}{R}` | R | 7/6 trample; ETB **discover 5**; `{2}{R}`, discard from hand: 3 damage |
| Hit the Mother Lode | `{4}{R}{R}{R}` | R | **Discover 10**, then Treasures equal to (10 − discovered MV) |
| Brass's Tunnel-Grinder | `{2}{R}` | R | Back face **Tecutlan**: cast a permanent with its mana → discover X = that spell's MV |
| Quintorius Kand | `{3}{R}{W}` | M | −3: discover 4 |
| Chimil, the Inner Sun | `{6}` | M | Discover 5 at each of your end steps |

### Discover gotchas

1. **Geological Appraiser says "if you cast it."** Blinking or reanimating it gives no discover.
2. **Daring Discovery can be cast with zero targets** to just discover 4. But *"if you choose any targets, and all of those targets are illegal by the time it tries to resolve, it won't resolve... You won't discover 4. As long as one target remains legal,"* it all happens.
3. **Hit the Mother Lode's Treasures arrive after discovering**, so they cannot pay an additional cost on the discovered spell.
4. **Curator of Sun's Creation triggers once per turn**, not once per discover.
5. **Discover buries the lands it passes** on the bottom of your library — real thinning, and it shows the opponent your top cards.
6. **Kellan, Daring Traveler `{1}{W}` // Journey On `{G}`** is LCI's only Adventure. Discover sees the card at MV 2 (the front face) and lets you cast **either half whose MV is ≤ N**.

---

## 4. Craft

**CR 702.167a, verbatim:** *Craft represents an activated ability. It is written as "Craft with [materials] [cost]"... It means "[Cost], Exile this permanent, Exile [materials] from among permanents you control and/or cards in your graveyard: Return this card to the battlefield transformed under its owner's control. **Activate only as a sorcery.**"*

**CR 702.167b:** materials named by card type/subtype **without the word "card"** may be taken from **either the battlefield or a graveyard**. So Kaslem's Stonetree's Cave and Waterlogged Hulk's Island can come from the graveyard.

### Cost — all three parts, paid on activation

| Component | Detail |
|---|---|
| Mana | The printed craft cost — a **second** investment on top of casting the front face |
| Exile this permanent | The front face leaves **as you activate**, before the ability resolves |
| Exile [materials] | Freely mixed: *"You don't have to choose all permanents or all cards from your graveyard."* |

### What comes back

- Transformed, under its **owner's** control.
- **CR 400.7:** a new object. So it is **summoning sick** (cannot attack that turn — only **Sunbird Effigy** has haste), it loses counters/Auras/Equipment from the front face, and back-face ETB abilities trigger.
- **Materials stay in exile permanently.**
- **Tokens are legal materials, but:** *"because they aren't cards and won't stay in exile, any abilities that refer to what you 'used to craft' the back faces won't refer to anything."* Paying **Sunbird Standard `{3}`** with Treasures gives a **0/0 Sunbird Effigy that dies immediately**.

### The 19 craft cards

| Front | Cost | R | Craft cost | Materials | Back | Back face |
|---|---|---|---|---|---|---|
| Oteclan Landmark | `{W}` | C | `{2}{W}` | another artifact | Oteclan Levitator | 1/4 flying Golem; on attack, gives an attacking creature flying |
| Inverted Iceberg | `{1}{U}` | C | `{4}{U}{U}` | another artifact | Iceberg Titan | 6/6 Golem; on attack, tap **or untap** target artifact/creature |
| Idol of the Deep King | `{2}{R}` | C | `{2}{R}` | another artifact | Sovereign's Macuahuitl | Equipment +2/+0, auto-attaches on ETB, equip `{2}` |
| Kaslem's Stonetree | `{2}{G}` | C | `{5}{G}` | **a Cave** | Kaslem's Strider | 5/5 Golem, vanilla |
| Tithing Blade | `{1}{B}` | C | `{4}{B}` | a creature | Consuming Sepulcher | artifact; drain 1 each upkeep |
| Waterlogged Hulk | `{U}` | U | `{3}{U}` | **an Island** | Watertight Gondola | 4/4 Vehicle, vigilance, crew 1, **descend 8: unblockable** |
| Clay-Fired Bricks | `{1}{W}` | U | `{5}{W}{W}` | another artifact | Cosmium Kiln | two 1/1 Gnomes on ETB; **creatures you control get +1/+1** |
| Lodestone Needle | `{1}{U}` | U | `{2}{U}` | another artifact | Guidestone Compass | `{1}`,`{T}`: a creature you control explores. **Sorcery only** |
| Saheeli's Lattice | `{1}{R}` | U | `{4}{R}` | one or more **Dinosaurs** | Mastercraft Raptor | \*/4 Dinosaur; power = total power of the exiled cards |
| Spring-Loaded Sawblades | `{1}{W}` | U | `{3}{W}` | another artifact | Bladewheel Chariot | 5/5 Vehicle; crew 1 **or** tap two other untapped artifacts |
| Sunbird Standard | `{3}` | U | `{5}` | one or more other permanents | Sunbird Effigy | \*/\* = **colours** among exiled cards (max 5); **flying, vigilance, haste** |
| Jade Seedstones | `{3}{G}` | U | `{5}{G}{G}` | a creature | Jadeheart Attendant | 7/7 Golem; ETB gain life = MV of the exiled card |
| Visage of Dread | `{1}{B}` | U | `{5}{B}` | **two** creatures | Dread Osseosaur | 5/4 menace; **mills two on enter or attack** |
| Master's Guide-Mural | `{3}{W}{U}` | U | `{4}{W}{W}{U}` | another artifact | Master's Manufactory | `{T}`: a 4/4 Golem (needs an artifact ETB that turn) |
| Braided Net | `{2}{U}` | R | **`{1}{U}`** | another artifact | Braided Quipu | `{3}{U}`,`{T}`: draw per artifact, then goes 3rd from top |
| Dire Flail | `{R}` | R | `{3}{R}{R}` | another artifact | Dire Blunderbuss | Equipment +3/+0, sac-an-artifact fling |
| Throne of the Grim Captain | `{2}` | R | `{4}` | a Dinosaur, a Merfolk, a Pirate **and** a Vampire | The Grim Captain | 7/7 menace trample lifelink hexproof |
| Unstable Glyphbridge | `{3}{W}{W}` | R | `{3}{W}{W}` | another artifact | Sandswirl Wanderglyph | 5/3 flying Golem |
| The Enigma Jewel | `{U}` | M | `{8}{U}` | four or more nonlands with activated abilities | Locus of Enlightenment | copies your activated abilities |

**Braided Net crafts for `{1}{U}` — less than its own casting cost.** Idol of the Deep King and Unstable Glyphbridge craft for exactly their front cost.

### Craft gotchas

1. **You cannot craft during combat or on the opponent's turn.** But see §2 — the front face may still have flash or an instant-speed ability.
2. **The crafted creature cannot attack that turn** (except Sunbird Effigy). Craft after combat, or the turn before you need the body.
3. **Crafting a Vehicle leaves you a Vehicle** — but crew is instant-speed, so it can still block the turn you craft it.
4. **Total investment is front cost + craft cost + a card.** Kaslem's Stonetree is `{2}{G}` plus `{5}{G}` plus a Cave to make a 5/5 vanilla — 9 mana and a land across two turns. Stalled boards only.
5. **"Craft with artifact" needs *another* artifact** — the reminder says "another artifact you control or an artifact card from your graveyard", so it can't pay for itself. "Craft with Cave/Island/creature" has no "another" (the front face isn't one of those types anyway).
6. **Changeling does not shortcut Throne of the Grim Captain:** *"The Dinosaur, Merfolk, Pirate, and Vampire... need to be separate objects. One creature with changeling is not enough."*
7. **Market Gnome `{W}` (0/3) pays you for being material:** it triggers when exiled during a craft activation for 1 life and a card, and *"will go onto the stack above the craft ability... you'll gain 1 life and draw a card before the transformed card returns."*

---

## 5. Explore

**CR 701.44a, verbatim:** *…that permanent's controller reveals the top card of their library. If a land card is revealed this way, that player puts that card into their hand. Otherwise, that player puts a +1/+1 counter on the exploring permanent and may put the revealed card into their graveyard.*

### The two branches

| Revealed | What happens | Your choice |
|---|---|---|
| **Land card** | Goes to **hand**. **No +1/+1 counter.** | **None** |
| **Nonland** | **+1/+1 counter (mandatory)**, then leave it on top **or** bin it | Only top-vs-graveyard |
| **Nothing** (empty library) | The exploring permanent gets a +1/+1 counter | None |

With 17 lands in a 40-card deck, the land branch comes up **42.5%** of the time. **Do not plan combat on the counter arriving.**

### The bin-or-keep decision

| Situation | Do |
|---|---|
| It's a permanent card and you have a descend payoff | **Bin it** — fixes the draw and advances descend |
| It's your best remaining bomb or removal | **Keep on top** — you draw it next turn |
| It's off-colour or uncastable | **Bin it** |
| You will explore **again this turn** and left it on top | You reveal **the same card again** — two counters, one card. Deliberate: keep to guarantee +2/+2, bin to gamble on a land |

### Uninterruptible

*"Once an ability that causes a creature to explore begins to resolve, no player may take any other actions until it's done. Notably, opponents can't try to remove the exploring creature after you reveal a nonland card but before it receives a counter."*

### The 18 explore sources

| Card | Cost | R | Source | Speed |
|---|---|---|---|---|
| Cenote Scout | `{G}` | U | 1/1, ETB explores | on cast |
| Seeker of Sunlight | `{G}` | C | 1/1; `{2}{G}`: explores. **Sorcery only** | sorcery |
| Miner's Guidewing | `{W}` | C | 1/1 flying vigilance; **on death**, a creature you control explores | any |
| Glowcap Lantern | `{G}` | U | Equipment, equip `{2}`; equipped creature explores **when it attacks**, and you may look at your top card any time | attack |
| River Herald Scout | `{1}{U}` | C | 1/2, ETB explores | on cast |
| River Herald Guide | `{2}{G}` | C | 3/1 vigilance, ETB explores | on cast |
| Kinjalli's Dawnrunner | `{2}{W}` | U | 1/1 **double strike**, ETB explores | on cast |
| Merfolk Cave-Diver | `{2}{U}` | U | 2/4; whenever a creature you control explores, **+1/+0 and can't be blocked this turn** | reactive |
| Pathfinding Axejaw | `{3}{G}` | C | 4/3, ETB explores | on cast |
| Over the Edge | `{1}{G}` | C | Sorcery; mode 2 = a creature you control explores **twice** | sorcery |
| Defossilize | `{4}{B}` | U | Sorcery; reanimate a creature, it explores **twice** | sorcery |
| Nicanzil, Current Conductor | `{G}{U}` | U | 2/3; land explored → put a land from hand onto bf tapped; nonland → +1/+1 counter on Nicanzil | reactive |
| Twists and Turns | `{G}` | U | Replacement: **scry 1 first, then explore**; ETB a creature explores; transforms into Mycoid Maze at 7 lands | reactive |
| Subterranean Schooner | `{1}{U}` | R | 3/4 Vehicle, crew 1; on attack, **the creature that crewed it** explores | attack |
| Jadelight Spelunker | `{X}{G}` | R | 1/1, ETB explores **X times** | on cast |
| Amalia Benavides Aguirre | `{W}{B}` | R | 2/2, ward—pay 3 life; explores **whenever you gain life** | reactive |
| Deepfathom Echo | `{2}{G}{U}` | R | 4/4; explores **at the beginning of combat on your turn**, then **may become a copy of another creature you control** until end of turn | begin combat |
| Guidestone Compass | — | U | Craft back of Lodestone Needle `{1}{U}`; `{1}`,`{T}`: explores. **Sorcery only** | sorcery |

### Explore gotchas

1. **A land gives no counter.** Roughly two explores in five just put a land in hand.
2. **The counter is mandatory** when a nonland is revealed. No declining.
3. **A creature that already left the battlefield still explores:** *"you won't put a +1/+1 counter on anything, but you may put the revealed card into your graveyard. Effects that trigger 'whenever a creature explores' trigger as appropriate."* Merfolk Cave-Diver and Nicanzil still trigger.
4. **Twists and Turns stacks:** *"If you control two copies... instead you scry 1, then scry 1 again, then that creature explores."*
5. **Attack-trigger explores resolve before blockers are declared.** Glowcap Lantern, Subterranean Schooner and Sentinel of the Nameless City **do not ambush a blocker** — the opponent sees the final size before blocking. The same is true in reverse for you.

---

## 6. Map tokens

**CR 111.10s, verbatim:** *A Map token is a colorless Map artifact token with "{1}, {T}, Sacrifice this token: Target creature you control explores. Activate only as a sorcery."*

### The four parts of the cost

| Part | Common error |
|---|---|
| `{1}` | Forgetting the Map costs mana at all |
| `{T}` | — |
| Sacrifice the token | A Map is **one use**, not an engine |
| **Target creature you control** | **With no creature on board the Map cannot be activated at all** |

### Timing

- **Sorcery speed** (CR 307.5): your main phase, empty stack.
- **Never a combat trick.** An opponent's untapped Map threatens nothing during combat.
- **No summoning sickness.** CR 302.6 applies only to **creatures**; a Map is a noncreature artifact token, so you may tap and sacrifice it **the turn it is created**.
- Sacrificing a Map **does not descend** — a token is not a card.

### The one strong Map line in this format

Precombat main phase with **Merfolk Cave-Diver `{2}{U}` (2/4)** on board: activate a Map → a creature you control explores → Cave-Diver becomes **3/4 and unblockable this turn**. Must be done **before** you attack; the Map is sorcery-speed and the unblockable lasts only that turn.

### The 9 Map producers

| Card | Cost | R | Maps |
|---|---|---|---|
| Spyglass Siren | `{U}` | U | 1/1 flying; 1 on ETB |
| Brackish Blunder | `{1}{U}` | C | Instant; bounce a creature, **1 Map only if it was tapped** |
| Fanatical Offering | `{1}{B}` | C | Instant; sac an artifact/creature as an additional cost, draw 2, 1 Map |
| Waterwind Scout | `{2}{U}` | C | 2/2 flying; 1 on ETB |
| Cartographer's Companion | `{3}` | C | 2/1 artifact creature; 1 on ETB |
| Sentinel of the Nameless City | `{2}{G}` | R | 3/4 vigilance; 1 on **enter or attack** |
| Get Lost | `{1}{W}` | R | Instant removal — **its controller (the opponent)** gets **two** Maps |
| Restless Anchorage | — | R | WU land, enters tapped; 1 Map whenever it attacks |
| Kellan, Daring Traveler // Journey On | `{1}{W}` // `{G}` | R | Adventure half: **1 + (opponents controlling an artifact)** Maps |

### Map gotchas

1. **Get Lost hands the opponent two Maps.** Still cast it — it is premium removal — but expect two explores, on their main phase only.
2. **A Map with no creature to target is a blank.** After a wipe, your Maps do nothing until you redeploy.
3. **Do not hold Maps "for the right moment in combat."** There is none. Spend them in your main phase.
4. **Restless Anchorage:** *"If this becomes a creature because of an effect other than its own ability, its last ability will still trigger whenever it attacks."* And *"if you haven't controlled it continuously since your most recent turn began, you won't be able to activate its mana ability or attack with it that turn."*

---

## 7. Caves

**CR 205.3i:** Cave is an ordinary land type. It grants nothing by itself — it is only something other cards look at.

### The 18 Cave faces

| Cave | R | Taps for | Notes |
|---|---|---|---|
| Hidden Cataract | C | `{U}` (enters tapped) | `{4}{U}`,`{T}`,Sac: discover 4. **Sorcery only** |
| Hidden Courtyard | C | `{W}` (tapped) | same at `{4}{W}` |
| Hidden Necropolis | C | `{B}` (tapped) | same at `{4}{B}` |
| Hidden Nursery | C | `{G}` (tapped) | same at `{4}{G}` |
| Hidden Volcano | C | `{R}` (tapped) | same at `{4}{R}` |
| Captivating Cave | C | `{C}`; `{1}`,`{T}` for any colour | `{4}`,`{T}`,Sac: two +1/+1 counters on target creature. **Sorcery only** |
| Promising Vein | C | `{C}` | `{1}`,`{T}`,Sac: fetch a basic tapped |
| Cavernous Maw | U | `{C}` | `{2}`: becomes a **3/3 Elemental**, **instant speed**; only if (other Caves + Cave cards in graveyard) ≥ 3 |
| Forgotten Monument | U | `{C}` | **Other** Caves you control gain "`{T}`, pay 1 life: add any colour" |
| Pit of Offerings | U | `{C}`, or the exiled cards' colours | Enters tapped; ETB exile up to three target cards from graveyards — **descend hate** |
| Volatile Fault | U | `{C}` | `{1}`,`{T}`,Sac: destroy a nonbasic land, make a Treasure |
| Echoing Deeps | R | `{C}` | May enter tapped as a copy of a land in a graveyard, still a Cave |
| Sunken Citadel | R | chosen colour (enters tapped) | Second ability adds 2 mana usable only on land activated abilities |
| Mycoid Maze | U | `{G}` | Back of Twists and Turns `{G}`; `{3}{G}`,`{T}`: dig 4 for a creature |
| Geode Grotto | U | `{R}` | Back of Dowsing Device; `{2}{R}`,`{T}`: haste + X/+0. **Sorcery only** |
| Shadows' Lair | U | `{B}` | Back of Grasping Shadows; draw-1-lose-1 off dread counters |
| Tecutlan, the Searing Rift | R | `{R}` | Back of Brass's Tunnel-Grinder `{2}{R}`; permanents cast with its mana discover X |
| The Tomb of Aclazotz | R | `{B}` | Back of Tarrian's Journal; cast a creature from your graveyard with a finality counter |

**Mana-base warning:** of the 13 standalone Caves, **five tap only for `{C}`** — Cavernous Maw, Echoing Deeps, Forgotten Monument, Promising Vein, Volatile Fault. Captivating Cave and Pit of Offerings need extra mana or setup for colour. Only the five Hidden Caves and Sunken Citadel produce colour directly, and the Hidden five all enter tapped. "Just take the Caves" is wrong.

### The 10 Cave payoffs

| Card | Cost | R | How it counts |
|---|---|---|---|
| Kaslem's Stonetree | `{2}{G}` | C | Craft with Cave — battlefield **or graveyard** (CR 702.167b) |
| Compass Gnome | `{2}` | C | 2/1; ETB may tutor a basic **or Cave** to the top |
| Bat Colony | `{2}{W}` | U | **Enchantment.** ETB: a 1/1 flying Bat **per mana from a Cave spent to cast it**; then +1/+1 counter on target creature you control whenever a Cave you control enters |
| Spelunking | `{2}{G}` | U | Enchantment; ETB draw + put a land from hand onto bf, **gain 4 life if it's a Cave**; **lands you control enter untapped** |
| Glimpse the Core | `{1}{G}` | U | Mode 2: return a **Cave card from your graveyard to the battlefield tapped** |
| Calamitous Cave-In | `{3}{R}` | U | X damage to each creature **and each planeswalker**; X = Caves you control **+** Cave cards in your graveyard |
| Scampering Surveyor | `{4}` | U | 3/2; ETB fetch a basic **or Cave** onto the battlefield tapped |
| Sinuous Benthisaur | `{5}{U}` | U | 4/4; ETB look at X, keep 2; same X formula |
| Gargantuan Leech | `{7}{B}` | U | 5/5 lifelink; costs `{1}` less per Cave you control **and** per Cave card in your graveyard |
| Cosmium Confluence | `{4}{G}` | R | Choose three (repeats allowed): tutor a Cave; put three +1/+1 counters on a Cave and make it a **0/0 Elemental with haste** (so a 3/3); destroy an enchantment |

**The recurring formula is "Caves you control **plus** Cave cards in your graveyard."** Sacrificing a Hidden Cave for discover 4 moves it from one side of that sum to the other, so **Calamitous Cave-In, Sinuous Benthisaur, Gargantuan Leech and Cavernous Maw get no worse when you crack your Caves.**

### Cave gotchas

1. **Gargantuan Leech is MV 8 no matter how cheap it gets** (CR 202.3 + CR 601.2f). Discover 3/4/5 will never find it.
2. **Spelunking:** *"you choose the order in which that ability's effect and Spelunking's effect apply. This means you can choose to have the land enter tapped or untapped."* But *"If Spelunking would enter the battlefield at the same time a land you control would enter tapped, that land still enters tapped."*
3. **The five Hidden Caves cost real tempo.** They always enter tapped, and the discover costs 5 mana plus the land itself. That is a turn-8+ play.
4. **Pit of Offerings exiles up to three cards from graveyards on ETB.** Point it at the opponent's graveyard to knock them below a descend threshold.

---

## 8. Quick Draft, and how it differs from Premier

| Fact | Value | Source |
|---|---|---|
| Drafting opponents | **Bots** | **First-party:** Arena's own event module for `QuickDraft_LCI_20260908` is literally named `BotDraft` |
| Run ends at | **3 losses** | **First-party:** local Arena log shows `CurrentWins:1, CurrentLosses:3` → `ClaimPrize` → `Complete` |
| Match structure | **Best-of-one.** No sideboarding, no game two | Draftsim (secondary) |
| Win cap | **7 wins** | Draftsim (secondary) |
| Entry | 5,000 gold or 750 gems | Draftsim (secondary) |
| Bo3 alternative | Traditional Draft, not Quick Draft | Draftsim (secondary) |
| Game opponents | Human players (only the *draft* is botted) | Draftsim (secondary) |

**Bo1 consequences for play:** no sideboard and no second game, so nothing carries forward and there is no reason to play around a card you have not seen this game. Every match is one decision set.

**Mechanically, Quick Draft and Premier Draft are identical.** Same card pool, same rules — everything in this file applies to both. The differences (bot vs human drafting, entry cost, reward curve) are draft-time and economic. Bot drafting changes which cards wheel, which is a pick-order matter, and picks come from the model.

### Arena card-version trap

| Card | Limited version | Arena-rebalanced | Where the rebalanced one is legal |
|---|---|---|---|
| Geological Appraiser | **`{2}{R}{R}`, 3/2** | A-Geological Appraiser, **`{3}{R}{R}`**, 3/2 | **Historic, Brawl, Competitive Brawl only** |

Confirmed from Scryfall legalities: the A- version's only legal formats are `historic`, `brawl`, `competitivebrawl`. **It cannot appear in a draft game.** Never budget 5 mana for a Geological Appraiser in Limited.

### Set scope

`set:lci` returns **292** names: **291 draftable cards** plus the Arena-only `A-Geological Appraiser`. The four LCI Commander legends on Arena (Admiral Brass, Unsinkable; Clavileño, First of the Blessed; Pantlaza, Sun-Favored; Xolatoyac, the Smiling Flood) sit under set code **LCC** and are not main-set cards.

---

## 9. Rules quotations, for grep

```
CR 701.57a  Discover N: Exile cards from the top of your library until you exile a nonland
            card with mana value N or less. You may cast that card without paying its mana
            cost if the resulting spell's mana value is less than or equal to N. If you don't
            cast it, put that card into your hand. Put the remaining exiled cards on the
            bottom of your library in a random order.
CR 701.57b  A player has "discovered" after the process is complete, even if some or all of
            those actions were impossible.
CR 701.57c  If the final card exiled has mana value N or less, it is the "discovered card,"
            regardless of whether it was cast or put into a player's hand.

CR 702.167a Craft with [materials] [cost] means: "[Cost], Exile this permanent, Exile
            [materials] from among permanents you control and/or cards in your graveyard:
            Return this card to the battlefield transformed under its owner's control.
            Activate only as a sorcery."
CR 702.167b A material named by card type/subtype WITHOUT the word "card" means either a
            permanent on the battlefield or a card in a graveyard of that type or subtype.
CR 702.167c "Used to craft" = cards exiled to pay that craft ability's activation cost.

CR 700.11   "Descended this turn" = a permanent card was put into that player's graveyard
            from anywhere this turn. "The number of times descended" = the number of permanent
            cards put into that graveyard from anywhere this turn. In both cases, no permanent
            cards put into the graveyard that turn are required to still be in that graveyard.
CR 207.2c   The ability words include descend 4, descend 8, and fathomless descent.
            Ability words have NO special rules meaning. (There is no "descend 10.")

CR 701.44a  Explore: reveal the top card of your library. If a land card is revealed, put it
            into your hand. Otherwise put a +1/+1 counter on the exploring permanent and you
            MAY put the revealed card into your graveyard.
CR 701.44c  If the permanent has left the battlefield, last known information is used.
CR 701.44d  Multiple simultaneous explores happen one at a time, APNAP order.

CR 111.10s  A Map token is a colorless Map artifact token with "{1}, {T}, Sacrifice this
            token: Target creature you control explores. Activate only as a sorcery."

CR 509.1b   The defending player checks each creature for blocking restrictions. A restriction
            may be created by an evasion ability. IF AN ATTACKING CREATURE GAINS OR LOSES AN
            EVASION ABILITY AFTER A LEGAL BLOCK HAS BEEN DECLARED, IT DOESN'T AFFECT THAT
            BLOCK. Different evasion abilities are cumulative.
CR 509.1a   Blocking creatures must be untapped.
CR 702.122a Crew N: "Tap any number of other untapped creatures you control with total power N
            or greater: This permanent becomes an artifact creature until end of turn."
            (No timing restriction — crew works at instant speed.)
CR 603.4    Intervening "if": the condition is checked when the ability would trigger AND
            again on resolution. Failing either means nothing happens.

CR 205.3i   Cave is a land type.
CR 302.6    Summoning sickness applies to CREATURES only (tap abilities and attacking).
CR 307.5    "Only as a sorcery" = you have priority, your main phase, empty stack.
CR 602.5d   Same, restated for activated abilities.
CR 117.3b   The active player receives priority after a spell or ability resolves.
CR 400.7    An object that changes zones becomes a NEW object with no memory of its past.
CR 107.3a   X in a mana cost equals the announced value only while on the stack (so X = 0
            for a card sitting in the library).
CR 107.3b   Casting without paying its mana cost forces X = 0.
CR 202.3    Mana value = the total mana in the MANA COST.
CR 601.2f   Cost reductions change the TOTAL COST, not the mana cost.
CR 702.85a  Cascade: mana value LESS THAN the cascading spell's. (Contrast discover: N or less.)
```

## Sources

- **Magic: The Gathering Comprehensive Rules**, August 19 2026 text (rules effective August 7 2026) — https://media.wizards.com/2026/downloads/MagicCompRules%2020260819.txt. Downloaded and quoted directly this session for CR 107.3a, 107.3b, 111.10s, 117.3b, 202.3, 205.3i, 207.2c, 302.6, 307.5, 400.7, 509.1a, 509.1b, 601.2f, 602.5d, 603.4, 700.11, 701.44, 701.57, 702.85a, 702.122a, 702.167. Every quotation above was string-matched against this file.
- **Scryfall API** (api.scryfall.com), fetched live this session — all 416 LCI printings / 292 unique names. Every card name, mana cost, rarity, type line, power/toughness and oracle line in this file was diffed against it programmatically (121 explicit cost/PT assertions checked). Also the source for legalities confirming A-Geological Appraiser is Historic/Brawl-only.
- **Official rulings**, via Scryfall's rulings endpoints (these mirror Wizards' own) — quoted for Geological Appraiser, Hit the Mother Lode, Daring Discovery, Curator of Sun's Creation, Jadelight Spelunker, Over the Edge, Twists and Turns, Miner's Guidewing, Merfolk Cave-Diver, Subterranean Schooner, Market Gnome, Throne of the Grim Captain, Sunbird Standard, Kaslem's Stonetree, Waterlogged Hulk, Souls of the Lost, Squirming Emergence, Terror Tide, The Mycotyrant, Matzalantli, Uchbenbak, Basking Capybara, Restless Anchorage, Spelunking.
- **Wizards of the Coast, "The Lost Caverns of Ixalan Release Notes"** (Jess Dunks and Eric Levine, Nov 2023) — https://magic.wizards.com/en/news/feature/the-lost-caverns-of-ixalan-release-notes — General Notes on craft, discover, descend, explore and Map tokens. Every passage used here was independently confirmed against the mirrored rulings above.
- **Local MTG Arena client logs** (`~/Library/Logs/Wizards of the Coast/MTGA/Player*.log`) — first-party evidence for the Quick Draft structure: event `QuickDraft_LCI_20260908`, draft module named `BotDraft`, and a run terminating at `CurrentLosses: 3`.
- **Draftsim, "MTG Arena Quick Draft"** — https://draftsim.com/mtg-arena-quick-draft/ — secondary source, used only for Bo1, the 7-win cap, the entry fee, and that gameplay opponents are human.
- Derived numbers (permanent vs instant/sorcery ratios, Cave mana output counts, the 42.5% explore-land figure) were computed from the Scryfall data in this session; the arithmetic is stated inline so it can be rechecked.

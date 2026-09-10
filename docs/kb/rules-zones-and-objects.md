# Rules: zones, counters, tokens and copies

> Use this when: you are declaring blockers, deciding whether to remove a creature mid-combat, or about to bounce/blink/copy/exile a permanent and need to know what survives the trip.

Scope: LCI (Lost Caverns of Ixalan) Quick Draft on MTG Arena. Every card below is verified against the Scryfall API for `set:lci`; every rule quote is verbatim from the Comprehensive Rules effective August 7, 2026.

---

## Quick reference

| # | Fact | Rule |
|---|---|---|
| 1 | **Killing a blocker after blockers are declared does NOT let the attacker through.** It stays blocked and assigns **zero** damage. | 509.1h, 510.1c |
| 2 | **Tapping an already-declared attacker or blocker does nothing.** It stays in combat and still deals damage. | 506.4b |
| 3 | A permanent that leaves the battlefield and returns is a **NEW OBJECT**: counters, Auras, damage and pumps gone, summoning sickness reset. | 400.7 |
| 4 | A token in any zone other than the battlefield **ceases to exist**. Bouncing/exiling an opposing token is hard removal; bouncing your own destroys it. | 704.5d, 111.8 |
| 5 | **Tokens dying does NOT advance descend.** Only artifact/battle/creature/enchantment/land/planeswalker **cards** count. Instants and sorceries never count. | 110.4a + ruling |
| 6 | Counters, Auras, Equipment and status are **not copied**. Counters already on the *copying* permanent stay and still apply. | 707.2 |
| 7 | A creature with three +1/+1 counters under `Eaten by Piranhas` {1}{U} is a **4/4, not a 1/1** (base-set in layer 7b, counters in 7c). | 613.4b/c |
| 8 | All damage is removed at cleanup. **Counters are permanent; damage and "until end of turn" shrinks are not.** | 514.2 |
| 9 | **Count the opponent's graveyard before every block** — it is a public zone you may examine at any time. Four permanent cards changes four common creatures' size. | 404.2 |
| 10 | Once a triggered ability is on the stack, killing its source does not stop it. **Price dies-triggers into every trade.** | 113.7a |
| 11 | Legend rule is a state-based action. **No responses.** | 704.5j, 704.3 |
| 12 | LCI contains **zero -1/-1 counters** (verified across all 292 cards). The annihilation rule never fires. | — |
| 13 | Map tokens and every explore activation are **"Activate only as a sorcery"** — an untapped Map is never a combat trick. | 111.10s |
| 14 | `Spring-Loaded Sawblades` {1}{W} only hits a **tapped** creature — but `Cosmium Blast` {1}{W} hits **attacking or blocking** creatures for 4. **{1}{W} open IS a threat to your blockers.** | — |

---

## 1. Declaring blockers — run this every time

1. **Count their graveyard.** Permanent cards only. Cross-reference §2. A 1/3 `Basking Capybara` {1}{G} is a **4/3** at four; a 3/2 `Didact Echo` {4}{U} **gains flying** at four.
2. **Count their untapped mana by colour.** Cross-reference §3. Map tokens and Treasures are not tricks by themselves — but Treasures pay for tricks.
3. **Read the displayed P/T, not the card you remember.** Explore creatures carry +1/+1 counters and are bigger than their printed box.
4. **Check every attacker for a dies-trigger** (§8). Trading hands them that value.
5. **Check for deathtouch.** `Stinging Cave Crawler` {2}{B} 1/3 kills whatever it blocks or blocks it. Never block it with your best creature.
6. **Check for double strike.** `Kinjalli's Dawnrunner` {2}{W} 1/1 deals first-strike damage that can kill a creature, push their graveyard past four, and pump another attacker **before** the regular damage step.
7. **Your Fungus tokens cannot block.** Do not count them as blockers.
8. Only now, declare.

### Removing a creature in combat — the timing rule
| Goal | Do this |
|---|---|
| Get your attacker's damage through | Kill the blocker **before the declare blockers step**. After blockers are declared it is too late — 509.1h. |
| Save your own blocked attacker | Kill their blocker any time. Your creature survives and deals no damage. |
| Fog one big attacker | Block it, then **bounce or sacrifice your own blocker**. The attacker stays blocked and deals zero. Fails against trample. |

---

## 2. Descend — the numbers that change a block

Descend counts **permanent cards** in the graveyard: artifact, battle, creature, enchantment, land, planeswalker (110.4a). These are static abilities, so they flip the instant the count changes — including mid-combat, off first-strike damage.

| Card | Cost | Base | At 4 permanent cards | At 8 |
|---|---|---|---|---|
| `Basking Capybara` (C) | {1}{G} | 1/3 | **4/3** | 4/3 |
| `Echo of Dusk` (C) | {1}{B} | 2/2 | **3/3, lifelink** | 3/3 lifelink |
| `Frilled Cave-Wurm` (C) | {3}{U} | 2/5 | **4/5** | 4/5 |
| `Didact Echo` (C) | {4}{U} | 3/2 | **3/2, FLYING** | 3/2 flying |
| `Akawalli, the Seething Tower` (U) | {1}{B}{G} | 3/3 | **5/5 trample** | **7/7 trample, can't be blocked by more than one creature** |
| `Watertight Gondola` (U, craft back face of `Waterlogged Hulk` {U}) | — | 4/4 vigilance Vehicle | 4/4 | **can't be blocked** |
| `The Ancient One` (M) | {U}{B} | 8/8 | cannot attack or block | **can attack and block** |
| `Souls of the Lost` (R) | {1}{B} | */*+1 | power = permanent cards in your graveyard, toughness = that +1 | grows |

**"Your graveyard" means the ability controller's graveyard.** Evaluating their `Basking Capybara`, count **their** yard.

### Two flavours, different counting
| Wording | Counts |
|---|---|
| "if you **descended this turn**" | A permanent card was put into that graveyard **from anywhere this turn**. It does not matter if it is still there. |
| "**descend 4 / descend 8 / fathomless descent**" | Permanent cards **currently** in that graveyard. |

Official ruling (`Broodrage Mycoid`): end-step "if you descended this turn" abilities **trigger only once** per end step, and *"It's not possible to put a permanent card into your graveyard during the end step in time to have the ability trigger."*

Intervening-if clauses check **twice** — on trigger and again on resolution. If the count drops in between, nothing happens (`Basking Capybara` ruling).

### Other descend payoffs at C/U
`Ruin-Lurker Bat` {W} (scry 1) · `Enterprising Scallywag` {1}{R} (Treasure) · `Deep Goblin Skulltaker` {2}{B} 2/2 menace (+1/+1 counter) · `Child of the Volcano` {3}{R} 3/3 trample (+1/+1 counter) · `Broodrage Mycoid` {3}{B} 4/3 (makes a 1/1 Fungus that can't block) · `Canonized in Blood` {1}{B} (+1/+1 counter on target creature) · `Coati Scavenger` {2}{G} 3/2 (return a permanent card from graveyard to **hand**) · `Stinging Cave Crawler` {2}{B} (draw on attack) · `Malamet Veteran` {4}{G} 5/4 trample (+1/+1 counter on attack) · `Council of Echoes` {4}{U}{U} 4/4 flier (bounce) · `Join the Dead` {1}{B}{B} (-10/-10 instead of -5/-5) · `Chupacabra Echo` {2}{B}{B} 3/2 (-X/-X) · `Uchbenbak, the Great Mistake` {3}{U}{B} 6/4 vigilance menace (self-reanimate at descend 8 with a finality counter: *"If this permanent would be put into a graveyard from the battlefield, exile it instead"*, 122.1h).

### Filling your own graveyard
`Waterlogged Hulk` {U} ({T}: mill 1) · `Inverted Iceberg` {1}{U} (ETB mill 1, draw 1) · `Dread Osseosaur` (craft back face of `Visage of Dread` {1}{B}; mill 2 on enter **or attack**) · `Song of Stupefaction` {1}{U} (ETB may mill 2) · `Another Chance` {2}{B} (may mill 2, return up to two creature cards) · `Fanatical Offering` {1}{B} (sacrifice an artifact or creature as a cost — that is a permanent card) · explore (binning a revealed nonland permanent card).

### Graveyard hate
`Digsite Conservator` {2} 2/1 (U): *"Sacrifice this creature: Exile up to four target cards from a single graveyard. Activate only as a sorcery."* **Sorcery speed** — use it proactively on your own turn, never as a response. `Buried Treasure` {2} (C) exiles **itself** from your graveyard for discover 5, which lowers your own count by one.

---

## 3. Open-mana read — every instant-speed C/U play in LCI

Complete list of common and uncommon cards that can be cast or activated during combat. Anything not here (including every Map token, every explore activation, and `Daring Discovery` {4}{R}) is sorcery-speed and cannot interfere.

**Combat-relevant (changes the math):**

| Mana | Card | Effect |
|---|---|---|
| {W} | `Acrobatic Leap` (C) | +1/+3 and flying until EOT; **untap it** |
| {1}{W} | **`Cosmium Blast`** (C) | **4 damage to target attacking OR blocking creature** |
| {1}{W} | `Family Reunion` (C) | Your creatures +1/+1 **or** gain hexproof |
| {1}{W} | `Spring-Loaded Sawblades` (U) | 5 damage to target **TAPPED** creature an opponent controls |
| {2}{W} | `Mischievous Pup` (U) | Flash 3/1 surprise blocker; bounce one of your own permanents |
| {2}{W} | `Quicksand Whirlpool` (C) | **Exile** target creature — costs {3} less if it targets a **tapped** creature ({5}{W} otherwise) |
| {U} | `Cogwork Wrestler` (C) | Flash 1/2 body; target creature an opponent controls gets **-2/-0** |
| {U} | `Relic's Roar` (C) | Target artifact or creature becomes a Dinosaur artifact creature with **base P/T 4/3** |
| {1}{U} | `Brackish Blunder` (C) | Bounce a creature (**destroys tokens**) |
| {1}{U} | `Eaten by Piranhas` (U) | Flash Aura: loses all abilities, becomes base 1/1 black Skeleton (**counters still apply**) |
| {1}{U} | `Lodestone Needle` (U) | Tap up to one artifact/creature + two stun counters (**useless once it is already attacking or blocking**) |
| {3}{U} | `Unlucky Drop` (C) | Owner puts target artifact or creature on top or bottom of their library |
| {1}{B} | `Fungal Fortitude` (C) | Flash Aura: +2/+0; on death returns it tapped under its **owner's** control |
| {1}{B} | **`Bitter Triumph`** (U) | **Destroy target creature or planeswalker** (additional cost: discard a card or pay 3 life) |
| {1}{B}{B} | `Join the Dead` (C) | -5/-5, or **-10/-10** at descend 4 |
| {R} | `Dreadmaw's Ire` (U) | Target **attacking** creature +2/+2 and trample |
| {1}{R} | **`Abrade`** (C) | **3 damage to target creature**, or destroy target artifact |
| {1}{R} | `Ancestors' Aid` (C) | +2/+0 and **first strike**; also a Treasure |
| {1}{R} | `Zoyowa's Justice` (U) | Shuffle target artifact/creature (MV 1+) into its owner's library |
| {2}{R} | `Idol of the Deep King` (C) | Flash artifact: 2 damage to any target |
| {1}{G} | **`Staggering Size`** (C) | **+3/+3 and trample** |
| {1}{G} | `Disturbed Slumber` (C) | A land they control becomes a **4/4 with reach and haste**; it must be blocked this turn if able |
| {2}{G} | `Huatli's Final Strike` (C) | Their creature +1/+0, then it deals damage equal to its power to a creature you control |
| {2}{G} | `Malamet Scythe` (C) | Flash Equipment, auto-attaches: **+2/+2** |
| {6} | `Runaway Boulder` (C) | Flash artifact: **6 damage** to target creature an opponent controls |

**Instant-speed but not combat math:** `Fanatical Offering` {1}{B}, `Another Chance` {2}{B}, `In the Presence of Ages` {2}{G}, `Confounding Riddle` {2}{U} (or counter unless they pay {4}), `Out of Air` {2}{U}{U} ({U}{U} against a creature spell), `Hurl into History` {3}{U}{U}.

**The read that matters:** two open mana of any colour is enough to kill or brick an attacker in white, black, red and green. Blue two-mana plays shrink or neutralise rather than kill.

---

## 4. The master rule — 400.7, new object

> **CR 400.7:** "An object that moves from one zone to another becomes a new object with no memory of, or relation to, its previous existence."

Official confirmation (`Dusk Rose Reliquary` ruling): *"Auras attached to the exiled permanent will be put into their owners' graveyards. Any Equipment will become unattached and remain on the battlefield. Any counters on the exiled permanent will cease to exist. When the card returns to the battlefield, it will be a new object with no connection to the card that was exiled."*

| Thing on the creature | Survives a round trip? | Rule |
|---|---|---|
| +1/+1 counters, stun counters, any counters | **NO — they cease to exist** (not "removed") | 122.2 |
| Auras attached to it | **NO** — Aura goes to its **owner's graveyard** | 704.5m |
| Equipment attached to it | Equipment **stays on the battlefield**, unattached — you keep it | 704.5n |
| Damage marked on it | NO | 400.7, 514.2 |
| "+X/+X until end of turn" pumps | **NO** | 400.7 |
| Tapped status | NO — enters untapped unless the effect says otherwise | 110.5b |
| Attacking / blocking status | NO — removed from combat | 506.4 |
| Summoning sickness | **RESETS** — cannot attack or use {T} this turn | 302.6 |
| Controller | Whoever the returning effect names; otherwise the player told to put it there | 110.2a |

### LCI cards that trigger this
| Card | Cost | Effect | Consequence |
|---|---|---|---|
| `Fungal Fortitude` | {1}{B} Aura, Flash | +2/+0; when enchanted creature dies, return it tapped **under its owner's control** | Returns tapped (**cannot block that turn**), summoning sick, no counters. Put on an opponent's creature it comes back on **their** side. |
| `Dusk Rose Reliquary` | {W} artifact, ward {2} | Exiles an opposing artifact/creature until this leaves (additional cost: sacrifice an artifact or creature) | Strips counters and Auras permanently. Kill the Reliquary and the creature returns naked and summoning sick. **An exiled token never comes back.** |
| `Mischievous Pup` | {2}{W} 3/1, Flash | Return up to one other target permanent **you control** to hand | Re-buys an ETB. **Never target your own token.** |
| `Brackish Blunder` | {1}{U} Instant | Return target creature to owner's hand; Map token if it was tapped | Best on an opposing token (destroyed) or a creature loaded with counters/Auras |
| `Council of Echoes` | {4}{U}{U} 4/4 flier | Descend 4 — bounce a nonland permanent | Same |
| `Helping Hand` | {W} Sorcery | Return a creature card MV ≤ 3 from your graveyard to the battlefield **tapped** | Comes back tapped — cannot block this turn |
| Craft (14 cards at C/U) | varies | Exile this permanent + materials: return it transformed | New object, transformed, summoning sick, no counters |

---

## 5. Craft

> **CR 702.167a:** "[Cost], Exile this permanent, Exile [materials] from among permanents you control and/or cards in your graveyard: Return this card to the battlefield transformed under its owner's control. Activate only as a sorcery."

- Craft exiles the permanent **as part of the cost**, so activating it in response to targeted removal makes the removal fizzle and you keep the transformed permanent. **Sorcery speed only**, so this only works against removal cast on your own turn.
- `Oteclan Landmark` ruling: *"You may exile some of them from among permanents you control and the rest from among cards in your graveyard."* Prefer graveyard cards over battlefield permanents when both are legal.
- `Oteclan Landmark` ruling: *"You may exile tokens you control as part of the materials required. However, because they aren't cards and won't stay in exile, any abilities that refer to what you 'used to craft' the back faces won't refer to anything."* `Mastercraft Raptor` (back of `Saheeli's Lattice` {1}{R}) is a **\*/4** whose power equals the total power of the exiled cards — **crafting it with tokens gives you a 0/4.**
- `Market Gnome` {W} 0/3 (U): *"When this creature is exiled from the battlefield while you're activating a craft ability, you gain 1 life and draw a card."* Its ruling: the trigger *"will go onto the stack above the craft ability"* — you draw **before** the transformed card returns.

---

## 6. Tokens

| Rule | Text | Practical form |
|---|---|---|
| 111.6 | "A token isn't a card" | Never counts for descend, never usefully reaches a graveyard |
| 704.5d | "If a token is in a zone other than the battlefield, it ceases to exist" | Bounce, exile or a graveyard trip **destroys** it permanently |
| 111.7 | "if a token changes zones, applicable triggered abilities will trigger before the token ceases to exist" | A token's own "when this dies" trigger **does** still work |
| 111.8 | "A token that has left the battlefield can't move to another zone or come back onto the battlefield" | No recursion, ever |

**Decisions**
1. **Bouncing or exiling an opposing token is unconditional removal.** `Brackish Blunder` {1}{U} on their 4/4 Golem or 4/3 Vampire Demon is a hard answer at instant speed for two mana.
2. **Never bounce your own token.** It is gone.
3. **A dying token does not advance descend.** Official `Broodrage Mycoid` ruling: *"Tokens are not cards, and while tokens are put into the graveyard before ceasing to exist, that action doesn't count as a player having descended."* Chump-blocking with Gnome tokens fuels nothing; chump-blocking with a real creature card does.
4. `Helping Hand` {W}, `Another Chance` {2}{B}, `Coati Scavenger` {2}{G}, `Squirming Emergence` {1}{B}{G} and `Uchbenbak` {3}{U}{B} can never get a token back.

### Token roster (common/uncommon sources)
| Token | Body | Created by |
|---|---|---|
| **Treasure** — colorless artifact, "{T}, Sacrifice: Add one mana of any color" (111.10a) | — | `Greedy Freebooter` {B} (on death) · `Ancestors' Aid` {1}{R} · `Plundering Pirate` {2}{R} · `Enterprising Scallywag` {1}{R} · `Diamond Pick-Axe` {R} (equipped creature attacks) · `Careening Mine Cart` {3} (on attack) · `Volatile Fault` (land) |
| **Map** — colorless artifact, "{1}, {T}, Sacrifice: Target creature you control explores. **Activate only as a sorcery**" (111.10s) | — | `Spyglass Siren` {U} · `Brackish Blunder` {1}{U} · `Fanatical Offering` {1}{B} · `Cartographer's Companion` {3} · `Waterwind Scout` {2}{U} |
| Gnome | 1/1 colorless artifact creature | `Oltec Cloud Guard` {3}{W} (1) · `Tinker's Tote` {2}{W} (2) · `Envoy of Okinec Ahau` {2}{W} ({4}{W} each) · `Cosmium Kiln` (craft back face of `Clay-Fired Bricks` {1}{W}; 2) |
| Fungus | 1/1 black, **"This token can't block"** | `Synapse Necromage` {2}{B} (2, on death) · `Broodrage Mycoid` {3}{B} (1, end step) |
| Bat | 1/1 black, flying | `Bat Colony` {2}{W} (one per Cave mana spent to cast it) |
| Vampire Demon | **4/3 white-black, flying** | `Canonized in Blood` {1}{B} ({5}{B}{B}, sacrifice) |
| Golem | **4/4 white-blue artifact creature** | `Master's Guide-Mural` {3}{W}{U} (ETB; repeatable on the crafted back face) |
| Dinosaur | 3/3 green | `Nurturing Bristleback` {5}{G}{G} |
| Copy | varies | `Self-Reflection` {4}{U}{U} |

**Combat note:** Fungus tokens literally cannot block. If their only untapped creatures are Fungus tokens, your attack is unblockable by them.

---

## 7. Counters

| Rule | Text | Consequence |
|---|---|---|
| 122.1a | "A +X/+Y counter ... adds X to that object's power and Y to that object's toughness" | Applied in **layer 7c** (613.4c) — after effects that *set* base P/T |
| 122.2 | "Counters on an object are not retained if that object moves from one zone to another. The counters are not 'removed'; they simply cease to exist." | Bounce/blink/exile strips them |
| 707.2 | "...status, counters, and stickers are not copied" | Copies never bring counters along |
| 122.1h | Finality counter: "If this permanent would be put into a graveyard from the battlefield, exile it instead" | `Uchbenbak` returns with one — it can only come back once |

### Verified negative: LCI contains ZERO -1/-1 counters
Grepping the full oracle text of all 292 unique LCI cards for `-1/-1` returns **0 matches**. Rules 122.3 / 704.5q (annihilation) will not fire. LCI's shrink effects are P/T modifiers, not counters:

| Card | Cost | Effect | Wears off at cleanup? |
|---|---|---|---|
| `Cogwork Wrestler` | {U} 1/2, Flash | ETB: target creature an opponent controls gets **-2/-0** | **Yes** (514.2) |
| `Join the Dead` | {1}{B}{B} Instant | -5/-5; **-10/-10** with descend 4 | **Yes** |
| `Chupacabra Echo` | {2}{B}{B} 3/2 | ETB: -X/-X, X = permanent cards in your graveyard | **Yes** |
| `Terror Tide` | {2}{B}{B} Sorcery (R) | **All** creatures get -X/-X, X = permanent cards in your graveyard | **Yes** |
| `Stalactite Stalker` | {B} 1/1 menace (R) | {2}{B}, sacrifice it: target creature gets -X/-X, **X = Stalactite Stalker's own power** (it grows itself with a descend trigger) | **Yes** |
| `Song of Stupefaction` | {1}{U} Aura | Enchanted permanent gets -X/-0, X = permanent cards in your graveyard | **No — continuous** |
| `Dead Weight` | {B} Aura | Enchanted creature gets **-2/-2** | **No — continuous** |

**Why this matters at 30 seconds:** a creature shrunk by a *counter* stays small forever; a creature shrunk by `Cogwork Wrestler` or `Join the Dead` is back to full size next turn. **Never plan two turns ahead off an until-end-of-turn shrink.**

### Explore — LCI's counter engine
> **CR 701.44a:** "that permanent's controller **reveals** the top card of their library. If a land card is revealed this way, that player puts that card into their hand. Otherwise, that player puts a **+1/+1 counter** on the exploring permanent and **may** put the revealed card into their graveyard."

Official rulings (`Deepfathom Echo`):
- *"Once an ability that causes a creature to explore begins to resolve, no player may take any other actions until it's done. Notably, opponents can't try to remove the exploring creature after you reveal a nonland card but before it receives a counter."*
- *"If no card is revealed, most likely because that player's library is empty, the exploring creature receives a +1/+1 counter."*
- *"If a resolving spell or ability instructs a specific creature to explore but that creature has left the battlefield, the creature still explores. If you reveal a nonland card this way, you won't put a +1/+1 counter on anything, but you may put the revealed card into your graveyard."* (LKI — 701.44c.)

**Explore is public** — both players see the reveal. When the opponent explores and declines to bin a nonland card, you know their next draw. **Explore also feeds descend**, since binning a revealed permanent card puts a permanent card in the graveyard.

### Which counter sources can fire mid-combat
| Source | Speed | Can it surprise you after blockers? |
|---|---|---|
| **Map token** | "Activate only as a sorcery" (111.10s) | **NO** |
| `Explorer's Cache` {1}{G} (move a counter) | "Activate only as a sorcery" | **NO** |
| `Seeker of Sunlight` {G}, `Guidestone Compass` (back of `Lodestone Needle` {1}{U}) | "Activate only as a sorcery" | **NO** |
| `Glowcap Lantern` {G} Equipment | "Whenever this creature **attacks**, it explores" | Counter lands **before** the declare blockers step — the size you see already includes it |
| `Malamet Veteran` {4}{G} | Descend 4 — whenever it attacks, +1/+1 counter on target creature | Same — resolves before blockers |
| `Bat Colony` {2}{W} | Whenever a Cave enters, +1/+1 counter | Only on a land drop, i.e. their main phase |

**LCI's counter engines are almost entirely sorcery-speed.** This is a large, reliable edge.

---

## 8. Copy effects

> **CR 707.2:** "The copiable values are the values derived from the text printed on the object (that text being name, mana cost, color indicator, card type, subtype, supertype, rules text, power, toughness, and/or loyalty), as modified by other copy effects, by its face-down status, and by 'as ... enters' and 'as ... is turned face up' abilities that set power and toughness. **Other effects (including type-changing and text-changing effects), status, counters, and stickers are not copied.**"

| Copied | NOT copied |
|---|---|
| Name, mana cost, colour, card types, subtypes, supertypes | +1/+1 counters and every other counter |
| Rules text, therefore all printed abilities | Auras and Equipment attached to it |
| Printed power and toughness | Tapped/untapped and every other status (110.5) |
| "Enters with" / "as this enters" abilities | Damage marked on it |
| — | "Until end of turn" pumps and type-changing effects |

### The two LCI copy cards
**`Self-Reflection` {4}{U}{U} Sorcery (U)** — "Create a token that's a copy of target creature you control." Flashback {3}{U}.
Rulings: *"It doesn't copy whether that creature is tapped or untapped, whether it has any counters on it or any Auras or Equipment attached to it, or any non-copy effects that have changed its types, color, power and toughness."* · *"If the copied creature is a token, the new token that's created copies the original characteristics of that token as stated by the effect that created the token."* (so copying a 4/4 Golem token works) · *"Any 'enters' abilities of the copied creature will trigger when the token enters."*

**Consequence:** copying your explore-loaded `Cenote Scout` {G} with three counters gives you a **1/1**. **Copy the biggest printed body you control, not the biggest creature you control.**

**`Deepfathom Echo` {2}{G}{U} 4/4 (R)** — "At the beginning of combat on your turn, this creature explores. Then you may have it become a copy of another creature you control until end of turn."
Rulings: *"Non-copy effects that have already applied to Deepfathom Echo will continue to apply to it. For example, +1/+1 counters on it will still affect it."* · *"Once Deepfathom Echo becomes a copy of another creature, it no longer has its triggered ability until end of turn."*

**Both directions:** counters are not copied *onto* the new object, but counters already on the *copying* permanent stay and still apply. A `Deepfathom Echo` with three +1/+1 counters copying a 2/2 is a **5/5**.

### Same principle for base-P/T-setting effects
**`Eaten by Piranhas` {1}{U} Aura, Flash (U)** — "Enchanted creature loses all abilities and is a black Skeleton creature with base power and toughness 1/1."
Ruling: *"Effects that modify the creature's power and/or toughness ... will apply to the creature no matter when they started to take effect. The same is true for counters that change its power and/or toughness."*

Base-setting is layer 7b, counters are 7c. **A creature with three +1/+1 counters under `Eaten by Piranhas` is a 4/4, not a 1/1.** It does lose all abilities, including flying, deathtouch and menace.

`Relic's Roar` {U} sets base P/T to 4/3 the same way — counters still add on top.

---

## 9. The legend rule

> **CR 704.5j:** "If two or more legendary permanents with the same name are controlled by the same player, that player chooses one of them, and the rest are put into their owners' graveyards."

| Property | Value |
|---|---|
| Timing | State-based action, checked whenever a player would get priority (704.3) |
| Uses the stack? | **No. Nobody can respond** |
| Who chooses | The controller |
| Where losers go | Their **owners' graveyards** — so they **count for descend** |
| Scope | Per player. You and the opponent may each have one copy of the same legend |

All nine uncommon legendary creatures in LCI are two-colour gold cards:

| Card | Cost | P/T |
|---|---|---|
| `Bartolomé del Presidio` | {W}{B} | 2/1 |
| `Captain Storm, Cosmium Raider` | {U}{R} | 2/2 |
| `Itzquinth, Firstborn of Gishath` | {R}{G} | 2/3 |
| `Nicanzil, Current Conductor` | {G}{U} | 2/3 |
| `Zoyowa Lava-Tongue` | {B}{R} | 2/2 |
| `Akawalli, the Seething Tower` | {1}{B}{G} | 3/3 |
| `Kutzil, Malamet Exemplar` | {1}{G}{W} | 3/3 |
| `Caparocti Sunborn` | {2}{R}{W} | 4/4 |
| `Uchbenbak, the Great Mistake` | {3}{U}{B} | 6/4 |

**Procedures**
1. **Never cast the second copy of a legend you already control** unless the first is about to die anyway. You get one body for two cards.
2. You **cannot** cast a second legend "in response" to removal — creature spells are sorcery-speed, and none of these have flash.
3. Do the reverse deliberately: to cross a descend 4 or descend 8 threshold, casting a redundant legend puts a permanent card in your graveyard immediately, at sorcery speed, with no other cost.
4. `Self-Reflection` copying your own legend creates a token with the same name — supertypes are copiable (707.2), so the legend rule fires immediately and you choose one. **Copying a legend is a trap.**

---

## 10. Last known information, and dies-triggers

> **CR 113.7a:** "Once activated or triggered, an ability exists on the stack independently of its source. Destruction or removal of the source after that time won't affect the ability."

> **CR 608.2h:** "the effect uses the current information of that object if it's in the public zone it was expected to be in; **if it's no longer in that zone ... the effect uses the object's last known information.**"

> **CR 704.8:** "If a state-based action results in a permanent leaving the battlefield at the same time other state-based actions were performed, that permanent's last known information is derived from the game state **before** any of those state-based actions were performed."

**One sentence: killing the creature does not stop its ability.**

### LCI dies-triggers — killing these in combat still gives them the value
| Card | Cost | P/T | On death |
|---|---|---|---|
| `Greedy Freebooter` | {B} | 1/1 | Scry 1 and create a Treasure |
| `Miner's Guidewing` | {W} | 1/1 flying, vigilance | Target creature you control explores |
| `Market Gnome` | {W} | 0/3 | Gain 1 life and draw a card |
| `Synapse Necromage` | {2}{B} | 3/1 | Create **two** 1/1 Fungus tokens that can't block |
| `Digsite Conservator` | {2} | 2/1 | May pay {4}: discover 4 |
| `Primordial Gnawer` | {4}{B} | 5/2 | Discover 3 |
| `Fungal Fortitude` (Aura) | {1}{B} | — | Return the enchanted creature to the battlefield tapped |

**Blocking consequence:** `Synapse Necromage` (3/1) trading with your 3/3 is not a clean trade — they get two more bodies. `Primordial Gnawer` (5/2) is a 5-power attacker you want to block with anything, but blocking it hands them a free discover 3. **Price the death trigger into the trade before you block.**

**Deathtouch and LKI (702.2e):** "If an object is no longer in the zone it's expected to be in as an effect causes it to deal damage, its last known information is used to determine whether it had deathtouch." `Stinging Cave Crawler` {2}{B} 1/3 deathtouch (U) kills whatever it blocks even though it dies — combat damage is simultaneous (510.2) and 704.5h destroys anything dealt damage by a deathtouch source. **Never block a deathtouch creature with a big creature; never attack a big creature into open deathtouch.**

**Where LKI does not save you:** CR 604.7 — "static abilities can't use an object's last known information." A static descend bonus checks the graveyard right now, every moment.

---

## 11. Combat rules that come from this subject

### Killing a blocker after blocks does NOT let the attacker through
> **CR 509.1h:** "A creature remains blocked even if all the creatures blocking it are removed from combat."
> **CR 510.1c:** "A blocked creature assigns its combat damage to the creatures blocking it. **If no creatures are currently blocking it (if, for example, they were destroyed or removed from combat), it assigns no combat damage.**"

- **As defender:** block a huge attacker with a 0/3 and then bounce or sacrifice your own blocker — the attacker deals **zero** damage. `Mischievous Pup` {2}{W} bouncing your own blocker after blocks is a full fog for one attacker, and re-buys the Pup's ETB. **Exception: trample.**
- **As attacker:** killing their blocker with `Idol of the Deep King` {2}{R} or `Abrade` {1}{R} after blockers are declared does **not** push your damage through.

### Removed from combat
> **CR 506.4:** "A permanent is removed from combat if it leaves the battlefield, if its controller or protector changes, if it phases out, if an effect specifically removes it from combat, or if it's an attacking or blocking creature that regenerates, **stops being a creature**, or becomes a battle."
> **CR 506.4b:** "**Tapping or untapping a creature that's already been declared as an attacker or blocker doesn't remove it from combat and doesn't prevent its combat damage.**"

`Lodestone Needle` {1}{U} taps a creature and adds two stun counters. **Tapping an already-declared attacker or blocker does nothing to this combat.** Use it before attackers are declared, where it genuinely stops a creature from attacking or blocking.

### Damage is simultaneous, with no window inside it
> **CR 510.2:** "all combat damage that's been assigned is dealt simultaneously ... **No player has the chance to cast spells or activate abilities between the time combat damage is assigned and the time it's dealt.**"

Trades resolve fully: both creatures die, deathtouch applies, lifelink applies.

### Damage does not carry over
> **CR 514.2:** "all damage marked on permanents is removed and all 'until end of turn' and 'this turn' effects end" during the cleanup step.

A creature you put 2 damage on this turn is at full toughness next turn. **Do not plan a two-turn kill through damage.**

### Lethal damage and deathtouch are state-based actions
- **704.5f:** toughness 0 or less → owner's graveyard; **regeneration can't replace this**.
- **704.5g:** damage marked ≥ toughness → destroyed.
- **704.5h:** dealt any damage by a deathtouch source → destroyed. **One damage is enough.**

---

## 12. The seven zones

> **CR 400.1:** "There are normally seven zones: library, hand, battlefield, graveyard, stack, exile, and command."

| Zone | Scope | Public or hidden | Ordered | Why it matters in LCI |
|---|---|---|---|---|
| Library | Per-player | Hidden (400.2) | Yes | Explore reveals the top card; mill feeds descend |
| Hand | Per-player | Hidden | No | `Deep-Cavern Bat` {1}{B} and `Visage of Dread` {1}{B} look at it |
| Battlefield | Shared | Public | No | Only zone where permanents exist |
| Graveyard | Per-player | **Public** (400.2) | Yes | **Descend counts it. You may examine any graveyard at any time (404.2)** |
| Stack | Shared | Public | Yes | Where triggers wait |
| Exile | Shared | Public | No | Craft costs, `Ray of Ruin` {4}{B}, `Quicksand Whirlpool`, flashback |
| Command | Shared | Public | No | Not used in LCI limited |

**Act on this:**
- The graveyard is a **public zone you may count at any time**. Before every combat, count the opponent's permanent cards there. That is free information, not a read.
- Instants and sorceries in a graveyard are visible but **do not count for descend** (110.4a).
- **CR 400.3:** an object that would go to a library, graveyard or hand other than its owner's goes to its owner's instead. Bounce or steal a card and it ends up with them.

---

## 13. Verified negatives — plausible beliefs that are false here

| Belief | Truth |
|---|---|
| "Watch out for -1/-1 counters annihilating my +1/+1 counters" | **LCI has zero -1/-1 counters.** 704.5q will not come up |
| "Their token died, so their descend count went up" | **No.** Tokens are not cards (`Broodrage Mycoid` ruling) |
| "Their instant in the graveyard counts toward descend 4" | **No.** Permanent cards only (110.4a) |
| "I'll kill the blocker so my attacker gets through" | **No.** It stays blocked and deals no damage (509.1h, 510.1c) |
| "They have an untapped Map token, so they have a trick" | **No.** Map is "Activate only as a sorcery" (111.10s) |
| "I'll tap their attacker with `Lodestone Needle` to stop the damage" | **No.** 506.4b |
| "`Self-Reflection` on my creature with counters gives me a big token" | **No.** Counters are not copied (707.2) |
| "`Eaten by Piranhas` makes it a 1/1, safe to block" | **No.** Counters apply in layer 7c, after base-setting in 7b |
| "My creature comes back from `Fungal Fortitude` ready to block" | **No.** It returns **tapped**, a new object, summoning sick |
| "I put `Fungal Fortitude` on their creature to steal it when it dies" | **No.** It returns under its **owner's** control — theirs |
| "I'll bounce my own token to re-use the ETB" | **No.** The token ceases to exist (704.5d) |
| "Damage on their creature carries to next turn" | **No.** Removed at cleanup (514.2) |
| "Crafting with tokens makes a big `Mastercraft Raptor`" | **No.** Tokens are not cards; "used to craft" finds nothing. You get a 0/4 |
| "I can respond to the legend rule" | **No.** State-based action (704.3, 704.5j) |
| "{1}{W} open is safe when I'm blocking, because Sawblades only hits tapped creatures" | **No.** `Cosmium Blast` {1}{W} deals 4 to an attacking **or blocking** creature |

---

## 14. Event facts

| Fact | Value | Evidence |
|---|---|---|
| Draft opponents | **Bots** | Verified in this machine's log for `QuickDraft_LCI_20260908`: `"CurrentModule":"BotDraft"` (32 occurrences). Corroborated by Draftsim: *"Quick Draft is a way that you can draft a set on MTG Arena with bots only."* |
| Match format | **Best-of-one** | Draftsim: *"Quick Draft is restricted to Best-of-One only games (BO1)."* **Not** independently confirmed from this machine's logs — see below. |
| Run length | 7 wins or 3 losses | Draftsim: players continue *"until you get seven wins or three losses."* |
| Entry fee | 5,000 gold or 750 gems | Draftsim |
| Card pool | **LCI main set** | The drafted deck's Arena ids (87383, 87160, 87301, 87326, 87412) all resolve to `set:lci` on Scryfall |
| Minimum deck size | 40 | Arena Limited match settings observed on this machine (`"minDeckSize": 40`), from HOB Sealed/Premier Draft matches, not from an LCI Quick Draft match |
| Turn timer | 30 s per priority, 4 timeouts, 3 pips | Same source: `"timeoutDurationSec": 30, "maxTimeoutCount": 4, "maxPipCount": 3` |
| Mulligan | London | Same source: `"mulliganType": "MulliganType_London"` |

**Evidence caveat, stated plainly:** the `QuickDraft_LCI_20260908` logs on this machine contain **draft-phase data only** — `BotDraft` and `ClaimPrize` modules, and **zero** game-state messages. No match in that event has been logged. The match-level settings above (Bo1, 40-card minimum, 30-second timer, London mulligan) were read from `Player-prev.log.bak-20260822`, whose Limited events are `PremierDraft_HOB_20260811` and `Sealed_HOB_20260811`. They are Arena's general Limited match settings and are expected to apply, but they are not direct observations of an LCI Quick Draft match.

**What Bo1 changes about play:**
- No sideboarding, no game 2. A card exiled by `Ray of Ruin` {4}{B}, `Quicksand Whirlpool`, or a craft cost is gone for the whole match.
- You never get to learn the opponent's tricks and adjust next game. The open-mana table in §3 is the only read you get.
- The 30-second timer is why this file is tables. Grep, don't read.

---

## Sources

1. **Magic: The Gathering Comprehensive Rules**, effective August 7, 2026 — https://media.wizards.com/2026/downloads/MagicCompRules%2020260819.txt (downloaded and grepped locally; every rule number and quote taken verbatim). Rules used: 110.2a, 110.4a, 110.5b, 111.6, 111.7, 111.8, 111.10a, 111.10s, 113.7a, 115.9b, 122.1a, 122.1h, 122.2, 122.3, 302.6, 400.1, 400.2, 400.3, 400.7, 404.2, 506.4, 506.4b, 509.1h, 510.1c, 510.2, 514.2, 604.7, 608.2h, 613.4b, 613.4c, 701.44a, 701.44c, 702.2e, 702.167a, 704.3, 704.5d, 704.5f, 704.5g, 704.5h, 704.5j, 704.5m, 704.5n, 704.5q, 704.8, 707.2.
2. **Scryfall API card data** — https://api.scryfall.com/cards/search?q=e%3Alci (all 292 unique cards downloaded to JSON and grepped locally). Every card name, mana cost, type line, power/toughness, rarity and oracle text above comes from that dump.
3. **Scryfall rulings endpoint** (official Wizards rulings), quoted for: Broodrage Mycoid, Basking Capybara, Souls of the Lost, Self-Reflection, Deepfathom Echo, Eaten by Piranhas, Dusk Rose Reliquary, Oteclan Landmark, Market Gnome, Saheeli's Lattice.
4. **Scryfall arena_id lookups** — https://api.scryfall.com/cards/arena/{id} — used to confirm the drafted pool maps to `set:lci`.
5. **MTG Arena client logs on this machine** — `/Users/brianward/Library/Logs/Wizards of the Coast/MTGA/` (`Player.log`, `Player-prev.log.draft-20260908`, `Player-prev.log.bak-20260822`). See the evidence caveat in §14 for which log each field came from.
6. **Draftsim, "MTG Arena Quick Draft"** — https://draftsim.com/mtg-arena-quick-draft/ — for best-of-one, 7 wins / 3 losses, entry fee, and bots-only drafting. Secondary source; Wizards' own event page could not be reached.

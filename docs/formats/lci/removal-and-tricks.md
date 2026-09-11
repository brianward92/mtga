# LCI removal and combat tricks

> Use this when: attackers are declared and you must decide blocks, or you are about to attack into open mana. Read "Quick reference", then the one colour section matching their untapped lands.

Every card name, mana cost, power/toughness, rarity and rules text below was verified against Scryfall for the `lci` set on 2026-09-10. Every rule was verified against the Comprehensive Rules effective 7 August 2026. Nothing here is inferred.

## Quick reference

| Their open mana | Worst thing it buys | Card |
|---|---|---|
| **{1}{W}** | 4 damage to an attacking **or blocking** creature | Cosmium Blast {1}{W} (C) |
| **{2}{W}** | Your **tapped** creature is **exiled** | Quicksand Whirlpool {5}{W} (C), costs {3} less vs a tapped target |
| **{1}{W}** | Unconditional **destroy** (rare) | Get Lost {1}{W} (R) |
| **{1}{B}** | Unconditional **destroy** | Bitter Triumph {1}{B} (U) |
| **{1}{B}{B}** | **-5/-5**, or **-10/-10** with 4+ permanents in their yard | Join the Dead {1}{B}{B} (C) |
| **{1}{R}** | 3 damage, **or +2/+0 and first strike** | Abrade {1}{R} (C) / Ancestors' Aid {1}{R} (C) |
| **{2}{R}** | 3 damage from a card **still in their hand** (rare) | Trumpeting Carnosaur {4}{R}{R} (R), `{2}{R}, Discard this card:` |
| **{1}{G}** | **+3/+3 and trample** | Staggering Size {1}{G} (C) |
| **{2}{G}** | Their creature damages yours, **yours deals none back** | Huatli's Final Strike {2}{G} (C) |
| **any blue** | **Blue kills nothing at instant speed at C/U** — bounce, tap or shrink only | — |

1. **Double-blocking: there is no damage assignment order.** CR 510.1c — the attacker divides its damage among your blockers however it chooses, with **no obligation to assign lethal to any of them first**. A big blocker no longer shields a small one. Assume the worst split. Only trample (CR 702.19b) still forces lethal-to-all-blockers before any damage goes to you.
2. **Tapping an attacking creature does nothing.** CR 506.4b: tapping a creature already declared as an attacker or blocker does not remove it from combat and does not prevent its combat damage. Tap effects must be used *before* attackers or *before* blockers.
3. **Crew costs zero mana and is instant speed** (CR 702.122a). Any untapped Vehicle plus one spare creature is an ambush blocker — **but the Vehicle must already be a creature when blockers are declared** (CR 509.1a), so the crew has to happen in the declare-attackers step, not after blocks. Crewing also **taps** the crewing creatures, which then cannot block themselves and become legal targets for Cosmium Blast, Spring-Loaded Sawblades and the discounted Quicksand Whirlpool.
4. **Acrobatic Leap {W}** (C) untaps their creature and gives it +1/+3 and flying. One white mana is a surprise blocker.
5. **Poison Dart Frog {1}{G}** (C) is a deathtouch blocker whenever they hold 2 mana (`{2}: gains deathtouch`) — and it taps for any colour, so it is hidden mana too.
6. **Hunter's Blowgun {1}** (C) grants deathtouch **during its controller's turn** and reach otherwise. It attacks you with deathtouch; it blocks you without.
7. **Count their graveyard before blocking.** Descend 4 makes Basking Capybara a 4/3, Akawalli a 5/5 trampler, and Join the Dead -10/-10.
8. **Default when unsure and not under pressure: do not block.** Quick Draft is best-of-one; the creature is worth more than 2–4 life at a healthy total.

## Format facts

| Fact | Value |
|---|---|
| Match format | **Best-of-one.** No game 2, no sideboard |
| Match opponents | **Human players** |
| Draft opponents | **Bots** |
| Run ends at | **7 wins or 3 losses** |
| Entry | 5,000 gold or 750 gems |
| Active event (local logs) | `QuickDraft_LCI_20260908` |

Play consequences of best-of-one:
- Never play around a card "they will bring in." What is in their deck now is all there ever is.
- A concede loses the whole match, not a game. Never concede a merely bad game.
- Quick Draft opponents drafted against bots, so their pools follow bot pick-orders. This changes which cards are *available*; it changes nothing about how any card works.

## The open mana table

**How to read it:** count their untapped lands **by colour**, then add every Treasure and every mana creature (see Hidden mana). Look up the highest row they can pay for. If your block or attack is still acceptable against that card, make it.

### White
| Open | Worst case | Card |
|---|---|---|
| {W} | Untaps a tapped creature, +1/+3 and flying — a blocker appears | Acrobatic Leap {W} (C) |
| **{1}{W}** | **4 damage** to your attacking or blocking creature | Cosmium Blast {1}{W} (C) |
| {1}{W} | **5 damage** to your **tapped** creature | Spring-Loaded Sawblades {1}{W} (U), flash artifact |
| {1}{W} | Their team gets +1/+1, **or gains hexproof** | Family Reunion {1}{W} (C) |
| **{2}{W}** | Your **tapped** creature is **exiled** | Quicksand Whirlpool {5}{W} (C), {3} less vs tapped |
| {2}{W} | Surprise 3/1 blocker; also rescues a permanent from your removal | Mischievous Pup {2}{W} (U), flash |
| {4}{W} | A 1/1 Gnome blocker appears | Envoy of Okinec Ahau {2}{W} (C), 3/3, ability {4}{W} |
| {5}{W} | Exile an **untapped** creature | Quicksand Whirlpool {5}{W} (C) |

### Blue
| Open | Worst case | Card |
|---|---|---|
| **{U}** | Their creature **or any artifact** becomes a **4/3**; or your big creature is set to base **4/3** | Relic's Roar {U} (C) |
| {U} | Surprise 1/2 blocker **and** your creature gets -2/-0 | Cogwork Wrestler {U} (C), flash |
| **{1}{U}** | Your creature is **bounced** | Brackish Blunder {1}{U} (C) |
| {1}{U} | Your creature **loses all abilities, base 1/1** | Eaten by Piranhas {1}{U} (U), flash Aura |
| {1}{U} | Your creature **tapped with two stun counters** | Lodestone Needle {1}{U} (U), flash artifact |
| {1}{U} | Their 1/4 Nautilus becomes a **4/1** | Hermitic Nautilus {1}{U} (U), `{1}{U}: +3/-3` |
| **{U}{U}** | Your **creature spell is countered** | Out of Air {2}{U}{U} (C), {2} less vs a creature spell |
| {2}{U} | Any spell countered unless you pay {4} | Confounding Riddle {2}{U} (U) |
| **{3}{U}** | Your creature goes to the **top or bottom of your library** | Unlucky Drop {3}{U} (C) |
| {3}{U}{U} | Artifact or creature spell countered, they discover X | Hurl into History {3}{U}{U} (U) |

**Blue has no instant-speed damage or destroy at common/uncommon.** It cannot kill your creature in combat — only bounce it, shrink it, or make a surprise body.

### Black
| Open | Worst case | Card |
|---|---|---|
| {B} | **Nothing.** Black has no one-mana instant at C/U | — |
| **{1}{B}** | Your creature is **destroyed** (they discard a card or pay 3 life) | Bitter Triumph {1}{B} (U) |
| {1}{B} | Their creature gets +2/+0 **and returns tapped when it dies** | Fungal Fortitude {1}{B} (C), flash Aura |
| {1}{B} | They sacrifice a creature in response to your removal, draw 2 | Fanatical Offering {1}{B} (C) |
| **{1}{B}{B}** | Your creature gets **-5/-5**, or **-10/-10** at descend 4 | Join the Dead {1}{B}{B} (C) |
| {B} + a spare body | Their Vito's Inquisitor grows and gains **menace** | Vito's Inquisitor {3}{B} (C), 3/3 |
| free + a spare body | They sacrifice a creature in response to your removal | Bartolomé del Presidio {W}{B} (U), 2/1 |

### Red
| Open | Worst case | Card |
|---|---|---|
| **{R}** | Their **attacking** creature gets +2/+2 and trample | Dreadmaw's Ire {R} (U) — attackers only |
| **{1}{R}** | **3 damage** to your creature, or your artifact destroyed | Abrade {1}{R} (C) |
| {1}{R} | Their creature gets **+2/+0 and first strike** | Ancestors' Aid {1}{R} (C) |
| {1}{R} | Your creature (MV 1+) is **shuffled into your library** | Zoyowa's Justice {1}{R} (U) — **you** then discover X |
| **{2}{R}** | **2 damage** to any target | Idol of the Deep King {2}{R} (C), flash artifact |
| **{2}{R}** | **3 damage** from a card in their **hand** | Trumpeting Carnosaur {4}{R}{R} (R), `{2}{R}, Discard this card:` |
| free (attack trigger) | 2 damage when their equipped creature attacks — kills a blocker **before blocks** | Sovereign's Macuahuitl — see Idol of the Deep King, crafted face |

### Green
| Open | Worst case | Card |
|---|---|---|
| **{2}** generic | Their Poison Dart Frog gains **deathtouch** | Poison Dart Frog {1}{G} (C), 1/1 reach |
| **{1}{G}** | Their creature gets **+3/+3 and trample** | Staggering Size {1}{G} (C) |
| {1}{G} | One of their **lands becomes a 4/4 reach blocker** | Disturbed Slumber {1}{G} (C) |
| **{2}{G}** | Their creature gets +1/+0 and **deals its power to your creature — yours deals none back** | Huatli's Final Strike {2}{G} (C) |
| {2}{G} | Their creature gets **+2/+2**, and the Equipment stays | Malamet Scythe {2}{G} (C), flash, equip {4} |
| {1} + sacrifice | Your artifact or enchantment destroyed mid-combat | Thrashing Brontodon {1}{G}{G} (U), 3/4 |
| {3}{G} | Their Cavern Stomper **can't be blocked by power 2 or less** | Cavern Stomper {4}{G}{G} (C), 7/7 |
| {5}{G}{G} | A land becomes a **7/7 haste** creature | Tendril of the Mycotyrant {1}{G} (U), 2/2 |

### Colourless, available to any deck
| Open | Worst case | Card |
|---|---|---|
| **0 mana** | A Vehicle **becomes a creature and blocks** — all Crew 1 | Careening Mine Cart {3} (U) 3/3; Watertight Gondola (U) 4/4 vigilance; Bladewheel Chariot (U) 5/5 |
| **{2}** | Their Cavernous Maw **land becomes a 3/3** | Cavernous Maw (U) — needs other Caves controlled + Cave cards in graveyard ≥ 3 |
| {2} + {T} | Your creature is **tapped**, before blockers | Swashbuckler's Whip {1} (U), equip {1} |
| {6} | **6 damage** to your creature | Runaway Boulder {6} (C), flash artifact |
| {T} | A 4/4 Golem token blocks, if an artifact entered under their control this turn | Master's Manufactory — crafted face of Master's Guide-Mural {3}{W}{U} (U) |

**Watertight Gondola** and **Bladewheel Chariot** only reach the battlefield by crafting (Waterlogged Hulk {U}, craft {3}{U}; Spring-Loaded Sawblades {1}{W}, craft {3}{W}). **Careening Mine Cart {3}** is the only C/U Vehicle that is simply cast. Once any of them is on the battlefield, crewing is free and instant speed.

### Hidden mana — always add these
- **Treasure tokens** (any colour, one shot) come from: Ancestors' Aid {1}{R}, Plundering Pirate {2}{R}, Greedy Freebooter {B} (on death), Enterprising Scallywag {1}{R} (their end step), Diamond Pick-Axe {R} (equipped creature attacks), Careening Mine Cart {3} (on attack), Volatile Fault (land).
- **Buried Treasure {2}** (C) — `{T}, Sacrifice: Add one mana of any color.`
- **Poison Dart Frog {1}{G}** (C) — `{T}: Add one mana of any color.`
- **Sunbird Standard {3}** (U) — `{T}: Add one mana of any color.`
- **Captivating Cave** (C, land) — `{1}, {T}: Add one mana of any color.`
- **Forgotten Monument** (U, land) — other Caves they control gain `{T}, Pay 1 life: Add one mana of any color.`
- **Pit of Offerings** (U, land) — taps for any colour among the cards it exiled.
- Restricted, **cannot** pay for tricks: Ixalli's Lorekeeper {G} (U, Dinosaurs only), Oaken Siren {1}{U} (C, artifacts only).

## Every common/uncommon instant in LCI — all 22

This is the complete list. Everything else at C/U is main-phase only and cannot ruin a block.

| Card | Cost | R | Effect |
|---|---|---|---|
| Acrobatic Leap | {W} | C | Target creature gets +1/+3 and gains flying until end of turn. Untap it. |
| Cosmium Blast | {1}{W} | C | 4 damage to target **attacking or blocking** creature. |
| Family Reunion | {1}{W} | C | Choose one — creatures you control get +1/+1; or they gain hexproof. |
| Quicksand Whirlpool | {5}{W} | C | Costs {3} less if it targets a **tapped** creature. Exile target creature. |
| Relic's Roar | {U} | C | Target artifact or creature becomes a Dinosaur artifact creature with **base P/T 4/3** until end of turn. |
| Brackish Blunder | {1}{U} | C | Return target creature to owner's hand. If it was tapped, create a Map. |
| Confounding Riddle | {2}{U} | U | Choose one — dig 4; or counter target spell unless its controller pays {4}. |
| Out of Air | {2}{U}{U} | C | Costs {2} less if it targets a **creature spell**. Counter target spell. |
| Unlucky Drop | {3}{U} | C | Target artifact or creature's **owner** puts it on top or bottom of their library. |
| Hurl into History | {3}{U}{U} | U | Counter target artifact or creature spell. Discover X = that spell's mana value. |
| Bitter Triumph | {1}{B} | U | Additional cost: discard a card or pay 3 life. **Destroy target creature or planeswalker.** |
| Join the Dead | {1}{B}{B} | C | Target creature gets -5/-5. **Descend 4** — **-10/-10** instead with 4+ permanent cards in your graveyard. |
| Fanatical Offering | {1}{B} | C | Additional cost: sacrifice an artifact or creature. Draw two cards, create a Map. |
| Another Chance | {2}{B} | C | You may mill two. Return up to two creature cards from your graveyard to hand. |
| Abrade | {1}{R} | C | Choose one — 3 damage to target creature; or destroy target artifact. |
| Ancestors' Aid | {1}{R} | C | Target creature gets **+2/+0 and gains first strike**. Create a Treasure. |
| Dreadmaw's Ire | {R} | U | Target **attacking** creature gets +2/+2, gains trample and an artifact-destroying damage trigger. |
| Zoyowa's Justice | {1}{R} | U | Owner of target artifact or creature with MV 1+ **shuffles it into their library**, then **that player** discovers X. |
| Staggering Size | {1}{G} | C | Target creature gets **+3/+3 and gains trample**. |
| Disturbed Slumber | {1}{G} | C | Target **land you control** becomes a 4/4 Dinosaur with **reach and haste**. Still a land. Must be blocked this turn if able. |
| Huatli's Final Strike | {2}{G} | C | Target creature **you control** gets +1/+0. It deals damage equal to its power to target creature an opponent controls. **Not a fight — no damage back.** |
| In the Presence of Ages | {2}{G} | C | Reveal top four; take a creature and/or a land; rest to graveyard. |

### The nine common/uncommon flash permanents
| Card | Cost | R | Effect on entry |
|---|---|---|---|
| Spring-Loaded Sawblades | {1}{W} | U | Artifact. **5 damage to target tapped creature an opponent controls.** Crafts into Bladewheel Chariot, a 5/5 Vehicle. |
| Mischievous Pup | {2}{W} | U | 3/1 Dog. Return up to one other target permanent you control to hand. |
| Cogwork Wrestler | {U} | C | 1/2 artifact creature. Target creature an opponent controls gets **-2/-0**. |
| Eaten by Piranhas | {1}{U} | U | Aura. Enchanted creature **loses all abilities**, is a black Skeleton with **base P/T 1/1**. |
| Lodestone Needle | {1}{U} | U | Artifact. **Tap up to one target artifact or creature and put two stun counters on it.** |
| Fungal Fortitude | {1}{B} | C | Aura. +2/+0. **When enchanted creature dies, return it to the battlefield tapped under its owner's control.** |
| Idol of the Deep King | {2}{R} | C | Artifact. **2 damage to any target.** Crafts into Sovereign's Macuahuitl, a +2/+0 Equipment. |
| Malamet Scythe | {2}{G} | C | Equipment. Attaches to target creature you control. **+2/+2.** Equip {4}. |
| Runaway Boulder | {6} | C | Artifact. **6 damage to target creature an opponent controls.** Cycling {2}. |

### Instant-speed activated abilities already on the battlefield
| Card | Cost | R | Ability |
|---|---|---|---|
| Poison Dart Frog | {1}{G} | C | 1/1 reach. `{2}: gains deathtouch until end of turn` |
| Hermitic Nautilus | {1}{U} | U | 1/4 vigilance. `{1}{U}: +3/-3` → a 4/1 |
| Cavern Stomper | {4}{G}{G} | C | 7/7. `{3}{G}: can't be blocked by creatures with power 2 or less this turn` |
| Tendril of the Mycotyrant | {1}{G} | U | 2/2. `{5}{G}{G}: seven +1/+1 counters on target noncreature land you control; it becomes a 0/0 Fungus with haste` |
| Envoy of Okinec Ahau | {2}{W} | C | 3/3. `{4}{W}: create a 1/1 colorless Gnome` |
| Thrashing Brontodon | {1}{G}{G} | U | 3/4. `{1}, Sacrifice this creature: destroy target artifact or enchantment` |
| Dauntless Dismantler | {1}{W} | U | 1/4. `{X}{X}{W}, Sacrifice this creature: destroy each artifact with mana value X` |
| Vanguard of the Rose | {1}{W} | U | 3/1. `{1}, Sacrifice another creature or artifact: gains indestructible until end of turn. Tap it.` |
| Vito's Inquisitor | {3}{B} | C | 3/3. `{B}, Sacrifice another creature or artifact: +1/+1 counter, gains menace until end of turn` |
| Bartolomé del Presidio | {W}{B} | U | 2/1. `Sacrifice another creature or artifact: put a +1/+1 counter on it` — **free** |
| Acolyte of Aclazotz | {2}{B} | C | 1/4. `{T}, Sacrifice another creature or artifact: each opponent loses 1 life, you gain 1` |
| Swashbuckler's Whip | {1} | U | Equipment, equip {1}. Grants reach and `{2}, {T}: tap target artifact or creature` |
| Cavernous Maw | land | U | `{2}: becomes a 3/3 Elemental until end of turn` — only if other Caves controlled plus Cave cards in graveyard ≥ 3 |
| Hotfoot Gnome | {2}{R} | C | 3/1 haste. `{T}: another target creature gains haste` — offence only |
| Master's Manufactory | {3}{W}{U} | U | Crafted face. `{T}: create a 4/4 Golem` — only if an artifact entered under their control this turn |

## Rares and mythics that act at instant speed

Only **four** LCI cards above uncommon can be **cast** at instant speed:

| Card | Cost | Effect |
|---|---|---|
| **Get Lost** | {1}{W} | Instant. **Destroy target creature, enchantment, or planeswalker.** Its controller creates two Maps. Two open white mana means Cosmium Blast or this. |
| **Kutzil's Flanker** | {2}{W} | Flash 3/1. ETB choose one: +1/+1 counters equal to creatures that left the battlefield under your control this turn; gain 2 life and scry 2; or exile a graveyard. |
| **Malcolm, Alluring Scoundrel** | {1}{U} | Flash **2/1** flier. A surprise flying blocker for two mana. |
| **Tishana's Tidebinder** | {2}{U} | Flash 3/2. ETB: **counter up to one target activated or triggered ability**; that permanent then loses all abilities while Tidebinder remains. |

But several rares act at instant speed through **abilities**, so "they have no flash cards" is not the same as "nothing can happen":

| Card | Cost | Instant-speed threat |
|---|---|---|
| **Trumpeting Carnosaur** | {4}{R}{R} | `{2}{R}, Discard this card: It deals 3 damage to target creature or planeswalker.` **Three open red mana kills a 3-toughness creature even if this card never gets cast.** |
| **Stalactite Stalker** | {B} | `{2}{B}, Sacrifice this creature: target creature gets -X/-X, X = this creature's power.` |
| **Restless** creature-lands | — | Restless Reef `{2}{U}{B}` → 4/4 **deathtouch** blocker; Restless Anchorage `{1}{W}{U}` → 2/3 flier; Restless Prairie `{2}{G}{W}` → 3/3; Restless Ridgeline `{2}{R}{G}` → 3/4; Restless Vents `{1}{B}{R}` → 2/3 menace. All are lands that block. |
| **Abuelo, Ancestral Echo** | {1}{W}{U} | `{1}{W}{U}: Exile another target creature or artifact you control`, returning it later — blanks your removal. |

Two sorcery-speed uncommons that still wreck your combat plans:
- **Kutzil, Malamet Exemplar** {1}{G}{W} (U, 3/3): *"Your opponents can't cast spells during your turn."* If they control Kutzil, **you cannot cast a single trick while you attack**. If you control Kutzil, they cannot respond to your attacks at all — attack freely.
- **Scytheclaw Raptor** {2}{R} (U, 4/3): *"Whenever a player casts a spell, if it's not their turn, this creature deals 4 damage to them."* Casting a trick on their turn costs you 4 life.

## The blocking procedure

Canonical procedure: [`../../rules/blocking-procedure.md`](../../rules/blocking-procedure.md).

## Combat rules that decide blocks

### 1. There is no damage assignment order
**CR 510.1c:** *"If two or more creatures are blocking it, it assigns its combat damage to those creatures divided as its controller chooses among them."* The CR glossary now carries an entry headed **"Damage Assignment Order (Obsolete)"**, which states that a creature's controller *"no longer needs to assign an order, and simply divides its combat damage as they choose."*

This replaced damage assignment order **effective 8 November 2024** — after LCI was released. (The 30 July 2024 rules use the phrase 20 times; the 8 November 2024 rules use it once, in that obsolete-glossary entry.)

The rules' own example: an attacking 4/3 blocked by a 2/3 and a 1/1 may assign all 4 to either one, or split 1/3, 2/2, or 3/1.

- The attacker's controller picks the split **after** blockers are declared, with **no obligation** to assign lethal to any blocker first.
- A big blocker no longer shields a small one. A 3/3 double-blocked by your 4/4 and your 1/1 can assign 1 to the 1/1 and 2 to the 4/4, killing the 1/1 and losing nothing.
- **Evaluate every double-block against the worst split.** If any split is bad for you, the double-block is bad.
- **Trample is the exception. CR 702.19b:** a trampling attacker must assign lethal to all blockers before any damage reaches you — it may decline, but then it assigns none to you.

### 2. Blockers must be untapped
**CR 509.1a:** *"The defending player chooses which creatures they control, if any, will block. The chosen creatures must be untapped…"*
- Tapping a creature **after** attackers are declared but **before** blockers are declared removes it as a blocker.
- Untapping a creature during the declare-attackers step **makes it available to block** — this is what Acrobatic Leap {W} does.
- Attacking taps the creature (**CR 508.1f**) unless it has vigilance (**CR 702.20b**).

### 3. Tapping an attacking creature does not remove it from combat
**CR 506.4b:** *"Tapping or untapping a creature that's already been declared as an attacker or blocker doesn't remove it from combat and doesn't prevent its combat damage."*
Lodestone Needle {1}{U}, Waylaying Pirates {3}{U}, Swashbuckler's Whip {1} and Thousand Moons Crackshot {1}{W} are **pre-attack or pre-block** tools only.

### 4. First strike granted after blocks still works
**CR 510.4:** the first-strike damage step exists if a creature has first strike *"as the combat damage step begins."* Ancestors' Aid {1}{R} cast after blockers are declared still creates a first-strike step. Their 2/2 blocked by your 3/3 becomes a 4/2 first striker: your 3/3 dies, theirs lives.

### 5. Deathtouch
**CR 702.2b:** a creature with toughness greater than 0 dealt any damage by a deathtouch source is destroyed as a state-based action. **CR 702.2c:** any nonzero combat damage from a deathtouch source counts as lethal for excess-damage purposes — so a deathtouch trampler assigns only 1 per blocker and tramples the rest through.

### 6. Base power/toughness versus counters — the layer trap
**CR 613.4b (layer 7b)** applies effects that *set* base power and toughness. **CR 613.4c (layer 7c)** then applies counters and +N/+N modifiers.
- **Eaten by Piranhas {1}{U}** on a 3/3 with two +1/+1 counters leaves a **3/3**, not a 1/1.
- **Relic's Roar {U}** on a 5/5 with a +1/+1 counter leaves a **5/4**, not a 4/3.
- Marked damage is not removed. **Relic's Roar on your 6/6 with 3 damage marked makes it a 4/3 and it dies immediately** (CR 704.5g).

### 7. Evasion at common/uncommon
- **Flying** (CR 702.9b): blockable only by flying and/or reach.
- **Menace** (CR 702.111b): cannot be blocked except by two or more creatures.
- **Rampaging Ceratops** {4}{R} (U, 5/4): cannot be blocked except by **three or more** creatures.
- **Akawalli, the Seething Tower** {1}{B}{G} (U) at descend 8: cannot be blocked by more than one creature, and is a 7/7 trampler.
- **Cavern Stomper** {4}{G}{G} (C): `{3}{G}` makes it unblockable by power 2 or less, **at instant speed**.
- **Watertight Gondola** (U, 4/4 Vehicle): descend 8 — unblockable with 8+ permanent cards in their graveyard.
- **Merfolk Cave-Diver** {2}{U} (U, 2/4): whenever a creature they control explores, it gets +1/+0 and **can't be blocked this turn** — a 3/4 that walks past you.

### 8. Descend, precisely
Two different things share the word:
- **Descend 4 / Descend 8 / Fathomless descent** count **permanent cards currently in that player's graveyard**. Thresholds flip the moment the count is reached.
- **"Descended this turn"** (**CR 700.11**) means a permanent card was put into that graveyard from anywhere this turn. This is what Enterprising Scallywag, Deep Goblin Skulltaker and Zoyowa Lava-Tongue use.

## Kill and pump thresholds

| Colour | Mana | Kills toughness ≤ | Card | Constraint |
|---|---|---|---|---|
| W | 2 | **4** | Cosmium Blast {1}{W} | **Attacking or blocking** creature only |
| W | 2 | **5** | Spring-Loaded Sawblades {1}{W} (U) | **Tapped** creature only |
| W | **3** | **Any** (exiled) | Quicksand Whirlpool {5}{W} | **Tapped** creature, {2}{W} after the discount |
| W | 6 | **Any** (exiled) | Quicksand Whirlpool {5}{W} | Untapped creature, full cost |
| W | 2 | **Any** (destroyed) | Get Lost {1}{W} (R) | None |
| U | any | **Blue kills nothing at instant speed at C/U** | — | Bounce, tap or shrink only |
| U | 1 | ≤ 3 **if damage is already marked** | Relic's Roar {U} | Sets base P/T 4/3 |
| U | 2 | ≤ 1 **if damage is already marked** | Eaten by Piranhas {1}{U} (U) | Sets base P/T 1/1; counters still apply |
| B | **2** | **Any** (destroyed) | Bitter Triumph {1}{B} (U) | Discard a card or pay 3 life |
| B | **3** | **5**, or **10** at descend 4 | Join the Dead {1}{B}{B} | None |
| R | **2** | **3** | Abrade {1}{R} | None |
| R | 3 | **2** | Idol of the Deep King {2}{R} | Any target |
| R | 3 | **3** | Trumpeting Carnosaur {4}{R}{R} (R) | Discarded from hand |
| R | 2 | **Any** (shuffled away) | Zoyowa's Justice {1}{R} (U) | MV 1+; **you** then discover X |
| G | **3** | **Their creature's power** | Huatli's Final Strike {2}{G} | Your creature deals **no** damage back |
| Any | **6** | **6** | Runaway Boulder {6} | Any deck can play it |

**Pump thresholds — how much bigger their creature can get at instant speed:**

| Colour | Mana | Swing | Card |
|---|---|---|---|
| W | 1 | **+1/+3, flying, untaps** | Acrobatic Leap {W} |
| W | 2 | +1/+1 to their whole team | Family Reunion {1}{W} |
| R | 2 | **+2/+0 and first strike** | Ancestors' Aid {1}{R} |
| R | 1 | +2/+2 and trample, **attackers only** | Dreadmaw's Ire {R} (U) |
| G | 2 | **+3/+3 and trample** | Staggering Size {1}{G} |
| G | 3 | +2/+2, Equipment stays attached | Malamet Scythe {2}{G} |
| B | 2 | +2/+0 **and it returns when it dies** | Fungal Fortitude {1}{B} |
| U | 1 | Sets base P/T to **4/3** | Relic's Roar {U} |
| U | 2 | Their 1/4 becomes a **4/1** | Hermitic Nautilus {1}{U} (U) |

## Rosters to check before blocking

### Deathtouch at common/uncommon
| Card | Cost | Body | Note |
|---|---|---|---|
| Deathcap Marionette | {1}{B} | 1/1 | C |
| Poison Dart Frog | {1}{G} | 1/1 reach | C — `{2}: gains deathtouch`, so it threatens whenever they hold 2 mana |
| Zoyowa Lava-Tongue | {B}{R} | 2/2 | U, legendary |
| Stinging Cave Crawler | {2}{B} | 1/3 | U — an excellent wall |
| Grasping Shadows | {3}{B} | Enchantment | U — a creature that **attacks alone** gains deathtouch and lifelink |
| Hunter's Blowgun | {1} | Equipment, +1/+1 | C — **deathtouch during its controller's turn, reach otherwise.** Attacking you: deathtouch. Blocking you: no deathtouch. |

### First strike and double strike at common/uncommon
- **Kinjalli's Dawnrunner** {2}{W} (U) 1/1 **double strike**, explores on entry — usually a 2/2 double striker.
- **Ancestors' Aid** {1}{R} (C) grants first strike at instant speed.

### Reach — your answers to fliers
Poison Dart Frog {1}{G} (1/1), Mineshaft Spider {3}{G} (3/4), Colossadactyl {2}{G}{G} (U, 4/5 reach trample), Panicked Altisaur {4}{R} (4/5), Swashbuckler's Whip {1} (grants reach), Hunter's Blowgun {1} (reach on defence), and the 4/4 land from Disturbed Slumber {1}{G}.

### Menace and multi-block requirements
Deep Goblin Skulltaker {2}{B} (C, 2/2), Dinotomaton {3}{R} (C, 4/3 — its entry also grants menace to another creature), Dread Osseosaur (U, 5/4, crafted face of Visage of Dread {1}{B}), Uchbenbak, the Great Mistake {3}{U}{B} (U, 6/4 vigilance menace), Vito's Inquisitor {3}{B} (C, gains menace on activation), **Rampaging Ceratops {4}{R} (U, 5/4 — needs three blockers)**, Akawalli at descend 8.

### Creatures that change size mid-combat
Count permanent cards in their graveyard first.

| Card | Cost | Base | At descend 4 | At descend 8 |
|---|---|---|---|---|
| Basking Capybara (C) | {1}{G} | 1/3 | **4/3** | — |
| Echo of Dusk (C) | {1}{B} | 2/2 | **3/3 lifelink** | — |
| Frilled Cave-Wurm (C) | {3}{U} | 2/5 | **4/5** | — |
| Didact Echo (C) | {4}{U} | 3/2 | gains **flying** | — |
| Akawalli, the Seething Tower (U) | {1}{B}{G} | 3/3 | **5/5 trample** | **7/7 trample, max one blocker** |
| Watertight Gondola (U) | — | 4/4 vigilance | — | **unblockable** |
| Join the Dead (C) | {1}{B}{B} | -5/-5 | **-10/-10** | — |

Other mid-combat size changes:
- **Malamet Veteran** {4}{G} (C, 5/4 trample) — **at descend 4 only**, puts a +1/+1 counter on target creature when it attacks.
- **Glowcap Lantern** {G} (U) — equipped creature explores when it attacks, which may add a +1/+1 counter before you block.
- **Brazen Blademaster** {2}{R} (C, 2/3) — +2/+1 on attack while they control two or more artifacts.
- **Burning Sun Cavalry** {1}{R} (C, 2/2) — +1/+1 whenever it attacks **or blocks** while they control a Dinosaur.
- **Belligerent Yearling** {1}{R} (U, 3/2 trample) — its base power can become another entering Dinosaur's power.

### Ward — creatures your removal bounces off
Marauding Brinefang {5}{U}{U} (C, 6/7, **ward {3}**), Hoverstone Pilgrim {5} (U, 2/5 flier, ward {2}), Dusk Rose Reliquary {W} (U, artifact, ward {2}). **CR 702.21a:** ward counters the spell or ability unless its controller pays the cost.

## Sorcery-speed removal — cannot interfere with a block

These decide what dies on **their** main phase. Do not hold back mana or creatures because of them.

| Card | Cost | R | Effect |
|---|---|---|---|
| Dead Weight | {B} | C | Aura: -2/-2. |
| Petrify | {1}{W} | C | Aura on artifact or creature: **can't attack or block, activated abilities can't be activated**. |
| Dusk Rose Reliquary | {W} | U | Artifact. Additional cost: sacrifice an artifact or creature. Ward {2}. Exiles target artifact or creature an opponent controls while it remains. |
| Tithing Blade | {1}{B} | C | Artifact. **Each opponent sacrifices a creature of their choice** — dodges hexproof and ward. |
| Malicious Eclipse | {1}{B}{B} | U | All creatures get -2/-2; opponents' creatures that would die are exiled instead. |
| Ray of Ruin | {4}{B} | C | Exile target creature, Vehicle, or nonbasic land. Scry 1. |
| Chupacabra Echo | {2}{B}{B} | U | 3/2. Target creature gets **-X/-X**, X = permanent cards in your graveyard. |
| Abyssal Gorestalker | {4}{B}{B} | U | 6/6. **Each player sacrifices two creatures.** |
| Song of Stupefaction | {1}{U} | C | Aura on a creature or Vehicle: **-X/-0**, X = permanent cards in your graveyard. |
| Zoetic Glyph | {2}{U} | U | Aura on an **artifact**: it becomes a **5/4 Golem**. |
| Triumphant Chomp | {R} | U | Damage equal to **2, or your best Dinosaur's power, whichever is greater**. |
| Rumbling Rockslide | {3}{R} | C | Damage equal to **the number of lands you control**. |
| Tectonic Hazard | {R} | C | 1 damage to **each opponent and each creature they control** — one-sided sweeper for X/1s. |
| Calamitous Cave-In | {3}{R} | U | X damage to **each creature and planeswalker**, X = Caves controlled + Cave cards in graveyard. |
| Daring Discovery | {4}{R} | C | **Up to three target creatures can't block this turn.** Discover 4. |
| Malamet Battle Glyph | {G} | U | **Fight** (+1/+1 counter first if yours entered this turn). |
| Waylaying Pirates | {3}{U} | C | 3/3. If you control an artifact: **tap target artifact or creature and put a stun counter on it**. |
| Thousand Moons Crackshot | {1}{W} | C | 2/2. **When it attacks**, you may pay {2}{W} to **tap target creature** — resolves in the declare-attackers step, so it strips a blocker. |

## Traps and exact interactions

| Trap | The truth |
|---|---|
| "Cosmium Blast is just a removal spell" | It targets **only an attacking or blocking creature** — dead outside combat, but always live *inside* it. Two open white mana in combat is 4 damage. |
| "Quicksand Whirlpool costs 6" | It costs **{2}{W}** whenever it targets a tapped creature, and attacking taps creatures. Three open white mana exiles your attacker. |
| "Huatli's Final Strike is a fight spell" | It is not. Their creature deals damage to yours; **yours deals none back**. |
| "Malamet Battle Glyph / Triumphant Chomp can save their blocker" | Both are **sorceries**. Neither can be cast during combat. |
| "Tapping their attacker fizzles the attack" | It does not (CR 506.4b). Tap effects must be used **before** attackers or **before** blockers. |
| "Eaten by Piranhas makes it a 1/1" | It sets **base** P/T (layer 7b). Counters still apply after (layer 7c). A 3/3 with two counters stays a 3/3. |
| "Relic's Roar only pumps" | It sets base P/T 4/3 on **any artifact or creature**, including yours. On your damaged big creature it kills it outright; on their Treasure or Map token it makes a surprise 4/3 blocker. |
| "Fungal Fortitude is just +2/+0" | It has **flash** and returns the creature to the battlefield tapped when it dies. Killing that creature in combat hands it back. |
| "A Vehicle can't ambush me" | Crew costs **no mana** and is instant speed. Careening Mine Cart 3/3, Watertight Gondola 4/4 vigilance, Bladewheel Chariot 5/5 — all Crew 1. |
| "Their lands are safe to attack past" | Disturbed Slumber {1}{G} makes a 4/4 reach blocker; Cavernous Maw {2} makes a 3/3; Tendril of the Mycotyrant {5}{G}{G} makes a 7/7; the rare Restless lands animate for three mana. |
| "Three lands means three mana" | Add every Treasure, plus Buried Treasure, Poison Dart Frog, Sunbird Standard, Captivating Cave, Forgotten Monument and Pit of Offerings. |
| "Craft could flip a monster mid-combat" | Craft is **sorcery-speed only** (CR 702.167a: *"Activate only as a sorcery"*). No crafted permanent appears during combat. |
| "They have no rare tricks, they tapped out for a creature" | **Trumpeting Carnosaur** {4}{R}{R} kills a 3-toughness creature from **hand** for {2}{R} by discarding itself. |
| "Family Reunion's hexproof saves them from my block" | Hexproof only stops **targeting**. It does nothing against blocking, damage, or edicts (Tithing Blade, Abyssal Gorestalker). |
| "I can trick them while I attack" | Not against **Kutzil, Malamet Exemplar** {1}{G}{W}: *"Your opponents can't cast spells during your turn."* |
| "Casting a trick on their turn is free" | Not against **Scytheclaw Raptor** {2}{R} (U, 4/3): 4 damage to you per spell you cast on their turn. |
| Stun counters | **CR 122.1d:** a permanent with a stun counter removes one instead of untapping. Lodestone Needle's two counters cost them two untap steps. |
| Sac outlets that blank your targeted removal | **Bartolomé del Presidio** {W}{B} (free), **Vito's Inquisitor** {3}{B} (`{B}`), **Vanguard of the Rose** {1}{W} (`{1}`), **Acolyte of Aclazotz** {2}{B} (`{T}`), **Fanatical Offering** {1}{B}, **Thrashing Brontodon** {1}{G}{G} (`{1}`). |
| Free instant-speed rescue | **Mischievous Pup** {2}{W} (U, flash 3/1) bounces one of their own permanents in response to your removal and leaves a 3/1 blocker. |

## Sources

- **Scryfall API**, `https://api.scryfall.com/cards/search?q=e%3Alci+unique%3Acards`, retrieved 2026-09-10 — all 292 LCI cards (113 common, 93 uncommon, 64 rare, 22 mythic). Every name, mana cost, power/toughness, rarity and oracle text above is taken verbatim from this data.
- **Scryfall `/cards/collection`** live spot-check of 16 load-bearing cards, zero `not_found`; plus `q=!"Abrade" e:lci` to pin set-specific rarity (Abrade is common **in LCI**; the default printing returned by a set-less lookup is uncommon).
- **Comprehensive Rules, effective 7 August 2026**, `https://media.wizards.com/2026/downloads/MagicCompRules 20260819.txt` — rules quoted: 122.1d, 506.4/506.4b, 508.1f, 509.1a, 510.1c, 510.4, 613.4b–c, 700.11, 702.2b–c, 702.9b, 702.19b, 702.20b, 702.21a, 702.111b, 702.122a, 702.167a, 704.5g, and the glossary entry "Damage Assignment Order (Obsolete)".
- **Comprehensive Rules, 30 July 2024 and 8 November 2024** — used to date the removal of damage assignment order. The July 2024 document uses the phrase 20 times; the November 2024 document uses it once, in the new obsolete-glossary entry.
- **Wizards of the Coast, MTG Arena formats page**, `https://magic.wizards.com/en/news/mtg-arena/mtg-arena-formats` — Quick Draft: draft against bots, then play live players until seven wins or three losses.
- **Draftsim**, `https://draftsim.com/mtg-arena-quick-draft/` and `https://draftsim.com/mtg-arena-draft-guide/` — "Quick Draft is restricted to Best-of-One only games (BO1)"; "drafting with bots only"; "Ranked Best-of-One matches (BO1) with players"; 5,000 gold or 750 gems; seven wins or three losses.
- **Local MTG Arena client logs**, `/Users/brianward/Library/Logs/Wizards of the Coast/MTGA` — active event `QuickDraft_LCI_20260908`; `CurrentLosses` reaches 3.

### Explicitly unverified
- **Pack structure.** No claim is made about cards per pack or picks per pack. The local tracker state reads `picksPerPack = 14`, `totalPicks = 42`, `isBotDraft = False`, with set, format and event name all null — stale defaults that do not describe this event.
- **17Lands win rates.** No card-quality or win-rate figure appears in this file. None was obtainable at usable sample size.
- **Turn timer and time-bank values.** Not verified, and not relied on.

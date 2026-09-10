# LCI commons, colour by colour

> Use this when: you are declaring blockers or deciding an attack in an LCI Quick Draft match and need to know what the opponent's open mana can actually do, or what a common on the board really is.

Companion file: `lci-combat-reference.md` covers the **whole** draft pool (all rarities), auto-generated. This file covers the **108 non-basic commons** only, with evaluation data. Commons are 77.6% of every card seen in an LCI pack, so this is most of what you will face.

---

## Quick reference

1. **Quick Draft is BEST-OF-ONE.** 7 wins or 3 losses ends the run. No sideboard, no second game. Take the reliable line, not the high-ceiling one.
2. **Craft and Map tokens are sorcery-speed only.** Their Inverted Iceberg cannot become a 6/6 mid-combat. A Map on their board cannot pump a blocker. Ever.
3. **Only 22 of 108 commons can be CAST at instant speed** (17 instants + 5 flash). If their open mana cannot pay for a row in the table below, block on raw stats. But also check the **activated abilities** list — those work at instant speed from the battlefield.
4. **2 open + R** → Abrade {1}{R}, 3 damage. Toughness ≤ 3 is not safe.
5. **2 open + W** → Cosmium Blast {1}{W}, 4 damage, **only to an attacking or blocking creature**. If you neither attack nor block, it is a dead card.
6. **3 open + W** → Quicksand Whirlpool exiles your **TAPPED** creature for {2}{W}. Attacking into 3 open white mana can lose the creature permanently. **Vigilance dodges it.**
7. **3 open + BB** → Join the Dead {1}{B}{B}, −5/−5, or **−10/−10** with 4+ permanent cards in their graveyard.
8. **2 open + G** → Staggering Size {1}{G}, +3/+3 and trample. Wins nearly any common-on-common combat.
9. **Count permanent cards in the graveyard before blocking.** Instants and sorceries do **not** count. At 4+: Echo of Dusk is 3/3 lifelink, Basking Capybara is 4/3, **Didact Echo gains flying**.
10. **Deathcap Marionette {1}{B} 1/1 is the only common with printed deathtouch.** Poison Dart Frog {1}{G} 1/1 has reach and gains deathtouch for **{2}** — never attack into an untapped Frog with 2 other mana up.
11. **Hunter's Blowgun {1} gives deathtouch only on ITS CONTROLLER'S turn; otherwise reach.** When *you* attack, their Blowgun creature blocks with reach, **not** deathtouch. Do not decline a good attack out of misplaced fear.
12. **Menace at common:** Deep Goblin Skulltaker {2}{B} 2/2 and Dinotomaton {3}{R} 4/3 — and Dinotomaton **grants** menace to another creature on ETB.
13. **A creature stays blocked even if you kill the blocker** (CR 509.1h). Chump-blocking a non-trampler stops all its damage.
14. **Tapping a creature after blockers are declared does nothing** (CR 506.4b). Waylaying Pirates and Thousand Moons Crackshot must tap a blocker *before* the declare-blockers step.
15. **Green traps:** Cavern Stomper {4}{G}{G} (50.9%) and Huatli's Final Strike {2}{G} (51.0%) are the two worst measured commons, and both are taken inside the first three picks.
16. **Colour depth at common: BLACK > White > Blue > Red >> GREEN.** Green has zero measured commons above baseline and no removal.

---

## Format facts

Quoted from the MTG Wiki's *Magic: The Gathering Arena/Events* page (retrieved 2026-09-10 via the MediaWiki API).

| Property | Quick Draft | Premier Draft | Traditional Draft |
|---|---|---|---|
| Match length | **Best-of-one** | Best-of-one | **Best-of-three** with sideboarding |
| Run ends | 7 wins or **3 losses** | 7 wins or 3 losses | 5 wins or 2 losses |
| Entry | 5,000 gold / 750 gems | 10,000 gold / 1,500 gems | 10,000 gold / 1,500 gems |
| Who drafts | **7 robot drafters**, picks influenced by *MTGO* data | Human drafters | Human drafters |
| Packs | 3 packs of 14 cards, 14 picks each | same | same |
| Deck | Minimum 40 cards | same | same |
| Availability | Rotates through previous formats **every fortnight** | Latest format, plus a rotating queue | Latest set always |

Exact wiki wording for Quick Draft: *"Entry fee: 5,000 gold or 750 gems. Best-of-one matches; run ends after seven wins or three losses."* and *"players draft with seven robot drafters whose picks are influenced by MTGO data"* and *"Deck construction and drafting times aren't limited."*

**Consequences that change play decisions:**

1. **Best-of-one means no sideboarding and no second game.** There is no "I'll get them next game." Never take a speculative line that loses to one card on the assumption of a rematch.
2. **Three losses ends the run.** Prefer the low-variance line when two lines are close.
3. **Drafting and deckbuilding are untimed; match turns are on a timer.** Deliberate during the draft. In combat, use the procedure at the end of this file rather than re-deriving from scratch.
4. **The draft is against bots, so pack signals are unreliable.** Bots do not cut colours the way humans do. A late premium card usually means a bot mispriced it, not that a colour is open.

**Opponents:** the wiki confirms only that the *drafters* are bots. Two first-party Wizards sources settle who the *matches* are against, and both say humans: the MTG Arena formats page — *"Draft cards against bots with no time limits. Build a 40-card deck to play against **live players** until reaching either seven wins or three losses"* — and Arena's own in-client Codex (`Codex/WaysToPlay/Formats/Limited_QuickDraft_A`): *"while you'll still play against other **human opponents**, you'll be drafted with 7 other AI opponents."* Play accordingly: do not soften any combat decision on the assumption of a weak opponent.

---

## COMBAT 1 — what open mana means

### Sorcery-speed guarantees

These cannot surprise you during combat, ever:

1. **Craft is "Craft only as a sorcery."** All 5 craft commons: Oteclan Landmark {W}, Inverted Iceberg {1}{U}, Tithing Blade {1}{B}, Idol of the Deep King {2}{R}, Kaslem's Stonetree {2}{G}.
2. **Map tokens are "Activate only as a sorcery."** A Map is never a combat trick.
3. **Equip is "Equip only as a sorcery."** An Equipment already on the battlefield cannot move mid-combat. (Malamet Scythe {2}{G} and Sovereign's Macuahuitl attach themselves on ETB — that is the ETB trigger, not equip.)
4. **Explore at common is ETB-triggered**, except Seeker of Sunlight {G}, which is sorcery-only.

### Instants and flash cards, by colour and cost

Read the opponent's untapped lands and colours, then read only the relevant rows.

| Open | White | Blue | Black | Red | Green | Colourless |
|---|---|---|---|---|---|---|
| **1** | Acrobatic Leap {W} (+1/+3, flying, untap) | Relic's Roar {U} (sets **base** 4/3 — shrinks a big attacker or animates an artifact as a blocker); **Cogwork Wrestler {U}** (flash 1/2, ETB −2/−0) | — | — | — | — |
| **2** | **Cosmium Blast {1}{W} (4 dmg, attacking/blocking only)**; Family Reunion {1}{W} (+1/+1 team, or hexproof team) | Brackish Blunder {1}{U} (bounce); **Out of Air {U}{U} vs a creature spell** | Fanatical Offering {1}{B} (sac in response, draw 2); **Fungal Fortitude {1}{B}** (flash, +2/+0, creature returns **tapped** when it dies) | **Abrade {1}{R} (3 dmg)**; Ancestors' Aid {1}{R} (+2/+0 and **first strike**) | Staggering Size {1}{G} (+3/+3 **trample**); Disturbed Slumber {1}{G} (a **land** becomes a 4/4 reach blocker) | — |
| **3** | **Quicksand Whirlpool {2}{W} — EXILE, if your creature is TAPPED** | — | **Join the Dead {1}{B}{B} (−5/−5, or −10/−10 at descend 4)**; Another Chance {2}{B} | Idol of the Deep King {2}{R} (flash, 2 dmg to any target) | Huatli's Final Strike {2}{G}; Malamet Scythe {2}{G} (flash, auto-attaches, +2/+2); In the Presence of Ages {2}{G} | — |
| **4** | — | Unlucky Drop {3}{U} (creature **or artifact** to top/bottom of library); Out of Air {2}{U}{U} at full price | — | — | — | — |
| **6** | Quicksand Whirlpool {5}{W} at full price (any creature) | — | — | — | — | Runaway Boulder {6} (flash, **6 dmg** to a creature an opponent controls) |

### Instant-speed ACTIVATED abilities — the gap the count above misses

The "22 of 108" figure counts cards **cast from hand**. These abilities work at instant speed from the battlefield and are the ones that actually ruin blocks:

| Card | Ability | Combat effect |
|---|---|---|
| **Poison Dart Frog {1}{G} 1/1** | **{2}: gains deathtouch** | A 1/1 with reach eats any attacker. The Frog itself taps for one of that {2}, but tapping it means it cannot block. |
| **Vito's Inquisitor {3}{B} 3/3** | **{B}, sac another creature or artifact: +1/+1 counter, gains menace** | Repeatable instant-speed pump mid-combat if they have fodder. |
| Cavern Stomper {4}{G}{G} 7/7 | {3}{G}: can't be blocked by creatures with **power** 2 or less | Used before blockers, not after. |
| Envoy of Okinec Ahau {2}{W} 3/3 | {4}{W}: create a 1/1 Gnome | A surprise blocker **only if made before blockers are declared**. |
| Acolyte of Aclazotz {2}{B} 1/4 | **{T}**, sac another creature or artifact: drain 1 | Saves a creature from removal by sacrificing it. Requires tapping, so a used Acolyte cannot block. |
| Panicked Altisaur {4}{R} 4/5 | **{T}**: 2 damage to each opponent (no lifegain) | Changes racing math. Tapping it means it cannot block. |
| Tinker's Tote {2}{W} | {W}, sac: gain 3 life | Changes racing math at instant speed. |
| Deconstruction Hammer {W} | grants "{3}, **{T}**, sac: destroy target artifact or enchantment" | Taps the equipped creature, so it cannot then block. |

### Toughness thresholds — memorise these

Every row is instant speed. **All of these require the opponent to have the listed mana open.**

| If they have… | Do not rely on surviving with toughness… | Card |
|---|---|---|
| 2 open, **R** | ≤ 3 | Abrade {1}{R} |
| 2 open, **W**, and your creature is **attacking or blocking** | ≤ 4 | Cosmium Blast {1}{W} |
| 3 open, **BB** | ≤ 5 (≤ 10 at descend 4) | Join the Dead {1}{B}{B} |
| 3 open, **W**, and your creature is **TAPPED** | any — it is **exiled** | Quicksand Whirlpool {2}{W} |
| 3 open, **R** | ≤ 2 | Idol of the Deep King {2}{R} |
| 6 open, any colour | ≤ 6 | Runaway Boulder {6} |

**Sorcery speed — these cannot be cast during combat**, but they decide whether it is worth committing another creature to the board: Dead Weight {B} (−2/−2 aura), Petrify {1}{W} (aura), Song of Stupefaction {1}{U} (aura), Rumbling Rockslide {3}{R} (damage = their land count), Ray of Ruin {4}{B} (exile), Tectonic Hazard {R} (1 damage to each of their creatures), Over the Edge {1}{G} (artifact/enchantment only).

### The two rules that decide close blocks

- **The Quicksand Whirlpool rule.** Exiling a creature costs {5}{W}, but only **{2}{W} if the target is tapped**. Attacking taps your creature (CR 508.1f). So attacking into 3 open mana including white risks losing that creature permanently, at instant speed, with no way to save it. **Vigilance creatures do not tap to attack (CR 702.20b) and dodge the discount entirely:** Miner's Guidewing {W}, Oaken Siren {1}{U}, River Herald Guide {2}{G}. Thousand Moons Infantry {2}{W} does *not* dodge it — it untaps during each other player's untap step, so it is still tapped during your own turn after attacking.
- **The Cosmium Blast rule, in your favour.** It can *only* target an attacking or blocking creature. If you neither attack nor block, it is dead in their hand. Conversely, chump-blocking with a creature you were saving hands them a legal target.

---

## COMBAT 2 — counting the graveyard, evasion, and the procedure

### Descend

Before every block, count **permanent cards** in the relevant graveyard. Per CR 110.4a a permanent card is an artifact, battle, creature, enchantment, land or planeswalker card — **instants and sorceries do not count** (CR 110.4). LCI mills heavily, so descend 4 is met often and early. The count is always of **the card's own controller's** graveyard.

| Card | Colour | Base | At descend 4 |
|---|---|---|---|
| Echo of Dusk {1}{B} | B | 2/2 | **3/3 with lifelink** |
| Basking Capybara {1}{G} | G | 1/3 | **4/3** (+3/+0) |
| Frilled Cave-Wurm {3}{U} | U | 2/5 | **4/5** (+2/+0) |
| Didact Echo {4}{U} | U | 3/2 | **3/2 with FLYING** — it can suddenly block your flier |
| Malamet Veteran {4}{G} | G | 5/4 trample | attack trigger turns on (+1/+1 counter on target creature) |
| Join the Dead {1}{B}{B} | B | −5/−5 | **−10/−10** |
| Song of Stupefaction {1}{U} | U | −X/−0 | Fathomless descent: X = permanent cards in **the Aura's controller's** graveyard. **No threshold — it scales every turn.** |

**"Descended this turn"** is a narrower, different check: a permanent card hit the graveyard from anywhere this turn. It powers end-step triggers on Deep Goblin Skulltaker {2}{B} (+1/+1 counter), Broodrage Mycoid {3}{B} (a 1/1 that can't block) and Child of the Volcano {3}{R} (+1/+1 counter). These resolve at end step, so they never change a combat in progress — but the creature you declined to kill is bigger next turn.

### Evasion roster at common — the complete list

| Keyword | Commons that have it |
|---|---|
| **Flying** (7 printed) | Miner's Guidewing {W} 1/1 (also vigilance), Oaken Siren {1}{U} 1/2 (also vigilance), Waterwind Scout {2}{U} 2/2, Screaming Phantom {2}{B} 2/2, Oltec Cloud Guard {3}{W} 3/2, Soaring Sandwing {4}{W}{W} 3/5, Oteclan Levitator 1/4 (crafted); plus **Didact Echo {4}{U} 3/2 at descend 4** |
| **Reach** — your only ground answers to the above | Poison Dart Frog {1}{G} 1/1, Mineshaft Spider {3}{G} 3/4, Panicked Altisaur {4}{R} 4/5; Hunter's Blowgun {1} grants it |
| **Menace** (needs two blockers, CR 702.111b) | Deep Goblin Skulltaker {2}{B} 2/2, Dinotomaton {3}{R} 4/3 — Dinotomaton also **grants** menace to another creature on ETB; Vito's Inquisitor {3}{B} grants itself menace at instant speed |
| **Deathtouch** | **Deathcap Marionette {1}{B} 1/1 only.** Plus Poison Dart Frog {1}{G} for {2}, and Hunter's Blowgun {1} on its controller's turn |
| **Trample** | Child of the Volcano {3}{R} 3/3, Malamet Veteran {4}{G} 5/4, Seismic Monstrosaur {4}{R}{R} 6/5; granted by Staggering Size {1}{G}, Etali's Favor {2}{R}, Malamet Brawler {1}{G} |
| **Vigilance** (dodges the Quicksand Whirlpool discount) | Miner's Guidewing {W}, Oaken Siren {1}{U}, River Herald Guide {2}{G} |
| **First strike** | **None printed at common.** Granted only by Ancestors' Aid {1}{R} |
| **Ward** | Marauding Brinefang {5}{U}{U} 6/7, ward {3} |
| **Defender** | Shipwreck Sentry {1}{U} 3/3 — it keeps defender, but *can attack as though it didn't have it* on any turn an artifact entered under its controller's control |
| **Haste** | Hotfoot Gnome {2}{R} 3/1 (and grants it); Goblin Tomb Raider {R} while its controller has an artifact |

### Three asymmetries that are easy to get backwards

1. **Hunter's Blowgun {1} grants deathtouch only during its controller's turn; otherwise reach.** When *you* attack, their Blowgun-equipped blocker has reach, not deathtouch — blocking or being blocked by it is safe from deathtouch. When *they* attack, it does have deathtouch.
2. **Fungal Fortitude {1}{B} returns the creature TAPPED**, under its **owner's** control. If you kill an enchanted creature it comes back, but it cannot block that turn.
3. **Relic's Roar {U} sets *base* power and toughness to 4/3.** +1/+1 counters and other pumps still apply on top, so a countered-up attacker does not necessarily shrink to exactly 4/3.

### Combat rules that decide close calls

- **A creature remains blocked even if every blocker is removed from combat** (CR 509.1h). Chump-blocking a non-trampler stops *all* its damage, even if you then kill or bounce the chump blocker.
- **Trample is the exception**: if a trampler is blocked and no blockers remain when damage is assigned, all its damage hits you (CR 702.19d).
- **Tapping or untapping a creature already declared as an attacker or blocker does not remove it from combat and does not prevent its damage** (CR 506.4b). Waylaying Pirates {3}{U} and Thousand Moons Crackshot {1}{W} only stop a blocker if they tap it **before** blockers are declared.
- **Blockers must be untapped** (CR 509.1a).
- **Deathtouch: any nonzero combat damage counts as lethal for damage assignment** (CR 702.2c), so a 1/1 deathtoucher blocking a 6/6 lets the attacker assign only 1 and send 5 elsewhere if it has trample.

### Declare-blockers procedure — run this in order, every time

1. Read their untapped lands: **how much mana, and which colours?**
2. Look up only those colours at that cost in the instant-speed table. If they cannot pay for anything, block on raw stats.
3. Scan their board for the **instant-speed activated abilities** listed above (Poison Dart Frog, Vito's Inquisitor, Acolyte of Aclazotz, Envoy of Okinec Ahau).
4. Count permanent cards in **both** graveyards; re-read any descend creature's real size.
5. Check for **menace** (needs two blockers) and for Dinotomaton having granted it.
6. Compute the race: if you block nothing, what is your life total, and who wins first?
7. Assign blocks. Remember craft, Map tokens and equip cannot interfere.

---

## How to read the numbers

**Card data provenance.** Every name, mana cost, type line, power/toughness and rules text below was pulled from the Scryfall API on 2026-09-10 (`set:lci rarity:common`, 113 unique cards → **108** after removing the 5 basics, which Scryfall marks common). LCI is exactly symmetric at common: **19 per colour, 6 colourless, 7 Caves.**

**The 17lands caveat — read before trusting any percentage.** The public `card_ratings/data` endpoint currently serves a badly reduced LCI sample:

| Problem | Evidence (verified 2026-09-10) |
|---|---|
| Date filters are ignored | A 2-day window and a 3.7-year window return **byte-identical** JSON (same SHA-256, 72,056 games) |
| Sample is small | ~72k games total; 500–1,950 games per measured common |
| Baseline is inflated | Game-weighted win rate across all cards is **59.3%**, not the ~55% a full dataset shows |
| Win rates suppressed below a threshold | Only **44/108** commons have a GP WR; only **4/108** have a GIH WR |

**Therefore:** treat percentages as *relative* signal against the **59.0% measured-common baseline**, never as absolute card quality, and never quote them as "the 17lands number for LCI." Differences under ~4 points are noise at these sample sizes (n≈550 gives a standard error of ~2.1%).

**Metrics.** **GP WR** = win rate of decks that played the card; confounded by deck quality, which is what makes it a usable *colour-strength* signal. **ALSA** = average last seen at; lower = taken earlier. ALSA measures **bot** preference in Quick Draft, which is why the QD-vs-Premier gap is informative.

**Legend.** ★★ premium, take early · ★ strong playable · *(blank)* playable/filler · ⚠ **trap** (taken early, loses games) · ✖ near-unplayable. A trap costs you a pick; a ✖ card costs you nothing because nobody is tempted.

---

## White commons (19) — 11 creatures

| Mark | Card | Cost | Type | P/T | What it does |
|---|---|---|---|---|---|
| ★★ | Miner's Guidewing | {W} | Creature — Bird | 1/1 | Flying **and** vigilance for one mana; on death, target creature you control explores. Attacks and blocks the same turn. **62.5% (n=875)**, best in colour. |
| ★★ | Oltec Cloud Guard | {3}{W} | Creature — Human Soldier | 3/2 | 3/2 flier plus a 1/1 Gnome token. 61.8% (n=633), ALSA 2.76. |
| ★★ | Petrify | {1}{W} | Enchantment — Aura | — | Enchant **artifact or creature**; it can't attack or block and its **activated** abilities can't be activated. Triggered and static abilities still work and the permanent stays on board. Sorcery speed. 60.0% (n=563), ALSA 2.79. |
| ★ | Tinker's Tote | {2}{W} | Artifact | — | Two 1/1 Gnome tokens on ETB; {W} + sac for 3 life at instant speed. 62.4% (n=585). |
| ★ | Quicksand Whirlpool | {5}{W} | Instant | — | **Exile** target creature; costs {3} less targeting a **tapped** creature, so **{2}{W} against an attacker**. 59.1% (n=748) — at baseline by the data, but the instant-speed exile is why 3 open white mana is frightening. |
| ★ | Attentive Sunscribe | {1}{W} | Artifact Creature — Gnome | 2/2 | 2/2 artifact that scries 1 whenever it **becomes tapped**. 60.8% (n=564). |
| ★ | Ironpaw Aspirant | {1}{W} | Creature — Cat Warrior | 1/2 | ETB puts a +1/+1 counter on target creature. 60.2% (n=633). |
| | Oltec Archaeologists | {4}{W} | Creature — Human Artificer Scout | 4/4 | ETB: return an artifact card from your graveyard, **or** scry 3. |
| | Soaring Sandwing | {4}{W}{W} | Creature — Dinosaur | 3/5 | 3/5 flier, ETB gain 3 life, or **Plainscycling {2}** early. |
| | Adaptive Gemguard | {3}{W} | Artifact Creature — Gnome | 3/3 | Tap two untapped artifacts and/or creatures you control for a +1/+1 counter. **Sorcery speed only.** |
| | Envoy of Okinec Ahau | {2}{W} | Creature — Cat Advisor | 3/3 | 3/3 for three; {4}{W} makes a 1/1 Gnome at **instant** speed. |
| | Deconstruction Hammer | {W} | Artifact — Equipment | — | +1/+1, equip {1}; grants "{3}, **{T}**, sac: destroy target artifact or enchantment." Tapping means it can't block. 59.2% (n=640). |
| | Oteclan Landmark // Oteclan Levitator | {W} | Artifact // Artifact Creature — Golem | — // **1/4** | ETB scry 2; **crafts with artifact {2}{W}** into a 1/4 flier that grants flying to an attacking creature. The back side is small — do not overrate it. |
| | Thousand Moons Infantry | {2}{W} | Creature — Human Soldier | 2/4 | Untaps during **each other player's** untap step, so it attacks and is still untapped to block on their turn. Does **not** dodge Quicksand Whirlpool on your turn. |
| | Thousand Moons Crackshot | {1}{W} | Creature — Human Soldier | 2/2 | Attack trigger: pay {2}{W} to tap target creature. Only removes a blocker if used before blockers are declared. |
| ⚠ | Cosmium Blast | {1}{W} | Instant | — | 4 damage, but **only to an attacking or blocking creature**. Dead against a passive board, cannot answer a resolved permanent. **57.5% (n=722)** — below baseline despite reading as premium removal. |
| ⚠ | Glorifier of Suffering | {2}{W} | Creature — Vampire Soldier | 3/2 | ETB: you may sacrifice another creature or artifact to put **one** +1/+1 counter on **each of up to two** target creatures. **55.4% (n=625)** — the fodder cost is real. |
| ✖ | Family Reunion | {1}{W} | Instant | — | Team +1/+1, or team hexproof. ALSA 9.82. |
| ✖ | Acrobatic Leap | {W} | Instant | — | +1/+3, flying, and untap it. ALSA 9.86. |

**Summary:** best one-mana creature in the set, two clean answers (Petrify, Quicksand Whirlpool), a token/artifact sub-theme. **8 of its 10 measured commons beat baseline** — second-deepest colour.

---

## Blue commons (19) — 10 creatures

| Mark | Card | Cost | Type | P/T | What it does |
|---|---|---|---|---|---|
| ★★ | Inverted Iceberg // Iceberg Titan | {1}{U} | Artifact // Artifact Creature — Golem | — // **6/6** | ETB mill 1 then draw 1 — replaces itself and counts as an artifact. **Crafts with artifact {4}{U}{U}** into a 6/6 that taps or untaps target artifact or creature on attack. Best blue common: **60.3% GP (n=1,382), 59.6% GIH (n=564)**. |
| ★★ | Waterwind Scout | {2}{U} | Creature — Merfolk Scout | 2/2 | 2/2 flier **plus** a Map token. Earliest-taken blue common (ALSA 2.65), 60.7% (n=963). |
| ★ | Cogwork Wrestler | {U} | Artifact Creature — Gnome | 1/2 | **The only flash creature at common.** ETB gives a creature an opponent controls −2/−0. The set's premier ambush blocker. 59.0% GP (n=955); 62.3% GIH in Premier (n=507). |
| ★ | Unlucky Drop | {3}{U} | Instant | — | Target artifact **or** creature's owner puts it on top or bottom of their library — **their** choice. Instant-speed answer to anything, including a crafted 6/6. 61.2% (n=804). |
| ★ | Oaken Siren | {1}{U} | Artifact Creature — Siren Pirate | 1/2 | Flying **and** vigilance; taps for {U} spendable only on artifact spells/abilities. Blocks fliers, accelerates craft. 58.5% (n=1,315). |
| ★ | Waylaying Pirates | {3}{U} | Creature — Human Pirate | 3/3 | ETB, **if you control an artifact**: tap an opposing artifact or creature and put a **stun counter** on it (it won't untap next untap step). 58.9% (n=850). |
| ★ | Brackish Blunder | {1}{U} | Instant | — | Bounce a creature; if it was **tapped**, also make a Map. 58.0% (n=1,000). |
| | Orazca Puzzle-Door | {U} | Artifact | — | {1}, {T}, sac: take one of the top two, bin the other. Craft fodder, descend fuel, selection. 59.8% (n=610). |
| | River Herald Scout | {1}{U} | Creature — Merfolk Scout | 1/2 | ETB explores — a land in hand, or a 2/3 body. 57.1% (n=604). |
| | Didact Echo | {4}{U} | Creature — Spirit Cleric | 3/2 | ETB draw a card; **has flying at descend 4**. Check their graveyard before assuming it can't block your flier. |
| | Sage of Days | {2}{U} | Creature — Human Wizard | 3/2 | ETB: look at top three, keep one on top, bin two. Descend fuel. |
| | Marauding Brinefang | {5}{U}{U} | Creature — Dinosaur | 6/7 | 6/7 with **ward {3}**, or **Islandcycling {2}**. Mostly cycled. |
| | Out of Air | {2}{U}{U} | Instant | — | Counter target spell; costs {2} less targeting a **creature spell**, so **{U}{U}** most of the time. Holding up a counter is weak in a Bo1 race. |
| | Frilled Cave-Wurm | {3}{U} | Creature — Salamander Wurm | 2/5 | 2/5 wall; **4/5 at descend 4**. |
| | Pirate Hat | {1}{U} | Artifact — Equipment | — | +1/+1 and loot on attack; equip Pirate {1}, equip {2} otherwise. Narrow. |
| | Shipwreck Sentry | {1}{U} | Creature — Human Pirate | 3/3 | 3/3 for two with **defender**; it can attack as though it didn't have defender on turns an artifact entered under its controller's control. **57.3% (n=633)** — the condition is harder to meet every turn than it looks. |
| | Ancestral Reminiscence | {3}{U} | Sorcery | — | Draw three, then discard one. Sorcery speed, too slow for most Limited decks. ALSA 8.43. |
| ✖ | Song of Stupefaction | {1}{U} | Enchantment — Aura | — | ETB may mill 2; **fathomless descent** −X/−0 where X = permanent cards in the Aura controller's graveyard. No threshold, it scales. Doesn't kill, does nothing to toughness. ALSA 9.95. |
| ✖ | Relic's Roar | {U} | Instant | — | Target artifact or creature becomes a Dinosaur artifact creature with **base** P/T 4/3 until end of turn. Animates an artifact as a surprise blocker, or shrinks a bigger attacker. ALSA 10.02 — least-wanted blue card. |

**Summary:** the deepest artifact/craft support and the set's only flash creature. Middling depth — **4 of 10 measured commons beat baseline.**

---

## Black commons (19) — 11 creatures — the deepest colour

| Mark | Card | Cost | Type | P/T | What it does |
|---|---|---|---|---|---|
| ★★ | Dead Weight | {B} | Enchantment — Aura | — | −2/−2 permanently for **one mana**. Kills most one- and two-drops and shrinks anything else forever. **66.4% (n=539) — the highest of any LCI common.** Sorcery speed. |
| ★★ | Tithing Blade // Consuming Sepulcher | {1}{B} | Artifact // Artifact | — // — | Two-mana **edict** (each opponent sacrifices a creature of *their* choice) on an artifact body; **crafts with creature {4}{B}** into a permanent that drains 1 each upkeep. **61.7% GP on n=1,947 and 63.6% GIH on n=909 — the largest common samples in the set.** Weak against a wide board. |
| ★★ | Join the Dead | {1}{B}{B} | Instant | — | −5/−5 at instant speed; **−10/−10 at descend 4**. Kills essentially every common in the format. ALSA 2.56, 61.3% (n=630). |
| ★ | Fanatical Offering | {1}{B} | Instant | — | **Additional cost: sacrifice an artifact or creature.** Draw **two** and make a Map. Instant speed, so it saves a creature from removal and turns chump blockers into cards. 61.8% (n=720). |
| ★ | Deathcap Marionette | {1}{B} | Creature — Fungus | 1/1 | **The only common with printed deathtouch.** ETB may mill 2. Trades with anything. 61.7% (n=958). |
| ★ | Skullcap Snail | {1}{B} | Creature — Fungus Snail | 1/1 | ETB: target opponent exiles a card from their hand — **they choose**. The body is irrelevant; the card is not. 61.1% (n=560). |
| ★ | Rampaging Spiketail | {4}{B}{B} | Creature — Dinosaur | 5/6 | ETB gives target creature you control +2/+0 and **indestructible** — a combat blowout. Or **Swampcycling {2}** early. 60.9% (n=800). |
| | Echo of Dusk | {1}{B} | Creature — Vampire Spirit | 2/2 | **3/3 with lifelink at descend 4**. Aggressive two-drop that ages well. 60.3% (n=889). |
| | Greedy Freebooter | {B} | Creature — Human Pirate | 1/1 | Dies into scry 1 and a Treasure. Fodder that fixes mana and counts as an artifact. 59.0% (n=539). |
| | Mephitic Draught | {1}{B} | Artifact | — | Draws a card and loses 1 life on ETB **and again** when it hits the graveyard from the battlefield. Artifact count plus two cards. 58.8% despite **ALSA 9.50** — badly underdrafted. |
| | Another Chance | {2}{B} | Instant | — | May mill 2, then return **up to two** creature cards from your graveyard to hand. 57.7% (n=589). |
| | Ray of Ruin | {4}{B} | Sorcery | — | **Exile** target creature, Vehicle or nonbasic land, plus scry 1. Unconditional but sorcery speed. ALSA 4.72. |
| | Screaming Phantom | {2}{B} | Creature — Spirit | 2/2 | 2/2 flier that mills on attack. Evasive clock and descend enabler. |
| | Broodrage Mycoid | {3}{B} | Creature — Fungus | 4/3 | End step you descended: a 1/1 that **can't block**. |
| | Primordial Gnawer | {4}{B} | Creature — Insect Horror | 5/2 | **Discovers 3** when it dies — attacks profitably or trades into a free spell. |
| | Deep Goblin Skulltaker | {2}{B} | Creature — Goblin Warrior | 2/2 | **Menace**; grows at end step on turns you descended. |
| | Acolyte of Aclazotz | {2}{B} | Creature — Vampire Cleric | 1/4 | 1/4 wall; **{T}**, sac another creature or artifact: drain 1. Tapping means it can't block that turn. |
| | Vito's Inquisitor | {3}{B} | Creature — Vampire Knight | 3/3 | **{B}**, sac another creature or artifact: +1/+1 counter and menace, at **instant speed**. Only good with real fodder. |
| | Fungal Fortitude | {1}{B} | Enchantment — Aura | — | **Flash** +2/+0; when the enchanted creature dies it returns to the battlefield **tapped** under its **owner's** control. Wins the combat *and* blanks their removal, but it can't block afterwards. ALSA 8.68 — very underdrafted. |

**Summary:** the deepest commons in the set — **mean 61.0% GP WR, 8 of 11 measured commons above baseline**, including the best common (Dead Weight) and the best-sampled one (Tithing Blade). Removal at one, two and three mana, plus the only common deathtouch body. Yet black has the **latest** average pick position of any colour in Quick Draft (mean ALSA 6.79). **That divergence is the most exploitable fact in this document.**

---

## Red commons (19) — 11 creatures

| Mark | Card | Cost | Type | P/T | What it does |
|---|---|---|---|---|---|
| ★★ | Abrade | {1}{R} | Instant | — | 3 damage to a creature, **or** destroy an artifact. **The earliest-taken common in the set: ALSA 2.07 in Quick Draft, 2.89 in Premier.** In a format this artifact-dense the second mode is never dead. |
| ★★ | Goblin Tomb Raider | {R} | Creature — Goblin Pirate | 1/2 | **A 2/2 with haste for one mana while you control an artifact.** **62.7% (n=593)** — best in colour. |
| ★ | Etali's Favor | {2}{R} | Enchantment — Aura | — | Enchant creature you control. **ETB discover 3**, so it replaces itself with a free spell — not card disadvantage like a normal aura. Then +1/+1 and trample. 60.0% (n=1,536), 59.3% GIH (n=616). |
| ★ | Plundering Pirate | {2}{R} | Creature — Orc Pirate | 3/2 | 3/2 plus a Treasure: body, fixing, artifact count and craft fodder in one card. ALSA 2.98. |
| ★ | Sunshot Militia | {1}{R} | Creature — Human Soldier | 1/3 | 1/3 blocker that converts a stalled board into reach: tap two untapped artifacts and/or creatures you control to deal 1 damage to each opponent (no lifegain). **Sorcery speed only.** 60.8% (n=602). |
| ★ | Idol of the Deep King // Sovereign's Macuahuitl | {2}{R} | Artifact // Artifact — Equipment | — // — | **Flash** artifact, ETB 2 damage to any target; **crafts with artifact {2}{R}** into a +2/+0 Equipment that attaches itself free. Two cards in one slot. ALSA 3.62. |
| | Dinotomaton | {3}{R} | Artifact Creature — Dinosaur Gnome | 4/3 | 4/3 **menace** artifact creature that also **grants** menace to a creature on ETB. ALSA 3.96. |
| | Rumbling Rockslide | {3}{R} | Sorcery | — | Damage to target creature equal to **the number of lands you control** — 4+ from turn four, scaling to kill anything. Sorcery speed is the only real cost. ALSA 3.36. |
| | Volatile Wanderglyph | {1}{R} | Artifact Creature — Golem | 2/2 | Loots whenever it **becomes tapped**. Body, artifact count, graveyard filling. 58.8% (n=677). |
| | Sunfire Torch | {R} | Artifact — Equipment | — | +1/+0, equip {1}; grants "on attack, you may sacrifice it to deal 2 damage to any target." Cheap artifact that converts into reach or removal. |
| | Seismic Monstrosaur | {4}{R}{R} | Creature — Dinosaur | 6/5 | 6/5 **trample**; also **{2}{R}, sac a land: draw a card**, or **Mountaincycling {2}**. Flexible top end. |
| | Brazen Blademaster | {2}{R} | Creature — Orc Pirate | 2/3 | **Attacks as a 4/4** (+2/+1) while you control two or more artifacts. Genuinely good in the artifact deck. |
| | Hotfoot Gnome | {2}{R} | Artifact Creature — Gnome | 3/1 | 3/1 haste artifact; **{T}** grants haste to another creature. Fragile — dies to a 1/1 block. |
| | Burning Sun Cavalry | {1}{R} | Creature — Human Knight | 2/2 | +1/+1 whenever it **attacks or blocks** while you control a Dinosaur, so a 3/3 on both offence and defence. |
| | Child of the Volcano | {3}{R} | Creature — Elemental | 3/3 | 3/3 trample that grows at end step on turns you descended. |
| ⚠ | Panicked Altisaur | {4}{R} | Creature — Dinosaur | 4/5 | 4/5 **reach**; **{T}**: 2 damage to each opponent (no lifegain). Taken at ALSA 4.50 but **55.2% (n=518)** — it does nothing the turn it lands, and tapping it means it can't block. |
| ⚠ | Ancestors' Aid | {1}{R} | Instant | — | +2/+0 and **first strike**, plus a Treasure. The first strike genuinely changes trades, but **55.7% (n=519)** — it still spends a card to win one combat. |
| ✖ | Tectonic Hazard | {R} | Sorcery | — | 1 damage to each opponent **and each creature they control** — a one-sided micro-sweeper. Least-played red common; 1 toughness is rare here. |
| ✖ | Daring Discovery | {4}{R} | Sorcery | — | Up to three creatures can't block, then discover 4. ALSA 9.77 — dead whenever you are behind. |

**Summary:** red commons are taken **earliest** of any colour (mean ALSA 5.42) on the strength of Abrade and a good aggressive curve, but only **3 of 6 measured commons beat baseline**. Best single removal spell, best one-drop, thin middle.

---

## Green commons (19) — 11 creatures — the weakest colour, and where the traps live

| Mark | Card | Cost | Type | P/T | What it does |
|---|---|---|---|---|---|
| ★ | Poison Dart Frog | {1}{G} | Creature — Frog | 1/1 | The most important small creature in the format defensively: **reach**, **{T}: add one mana of any colour**, and **{2}: gains deathtouch until end of turn**. Fixes your mana and eats any attacker. ALSA 2.85. |
| ★ | Nurturing Bristleback | {5}{G}{G} | Creature — Dinosaur | 5/5 | 5/5 plus a 3/3 Dinosaur token — 8 power across two bodies — or **Forestcycling {2}**. ALSA 4.69. |
| | Mineshaft Spider | {3}{G} | Creature — Spider | 3/4 | 3/4 **reach**, ETB may mill 2. Green's best defensive body and its answer to the format's fliers. |
| | Armored Kincaller | {2}{G} | Creature — Dinosaur | 3/3 | 3/3 for three; gain 3 life if you reveal a Dinosaur from hand or control another. ALSA 4.11. |
| | Malamet Veteran | {4}{G} | Creature — Cat Warrior | 5/4 | 5/4 **trample**; at descend 4, attack trigger puts a +1/+1 counter on target creature. |
| | Staggering Size | {1}{G} | Instant | — | +3/+3 and **trample** for two — the green combat trick; wins nearly any common-on-common combat. **ALSA 8.25 in Quick Draft vs 6.84 in Premier: the bots underrate it, so it wheels.** |
| | Over the Edge | {1}{G} | Sorcery | — | Modal: destroy an artifact or enchantment, **or** have a creature you control explore twice. Real flexibility in an artifact format. |
| | In the Presence of Ages | {2}{G} | Instant | — | Reveal top four, take a creature and/or a land, bin the rest. Selection plus heavy descend fuel. |
| | Malamet Scythe | {2}{G} | Artifact — Equipment | — | **Flash**, attaches itself on ETB, +2/+2, equip {4} thereafter. A combat trick that stays on the board. Underdrafted at ALSA 9.22. |
| | Kaslem's Stonetree // Kaslem's Strider | {2}{G} | Artifact // Artifact Creature — Golem | — // **5/5** | ETB: look at top six, put a land onto the battlefield tapped. **Crafts with Cave {5}{G}** into a vanilla 5/5. Requires you to actually have Caves. |
| | Basking Capybara | {1}{G} | Creature — Capybara | 1/3 | 1/3 that becomes **4/3 at descend 4**. Only playable in a committed self-mill build. |
| | Malamet Brawler | {1}{G} | Creature — Cat Warrior | 2/2 | On attack, grants trample to target attacking creature. Filler. |
| | Seeker of Sunlight | {G} | Creature — Merfolk Scout | 1/1 | Repeatable {2}{G} explore, **sorcery speed only**. A mana sink on a bad body. |
| ⚠ | Pathfinding Axejaw | {3}{G} | Creature — Dinosaur | 4/3 | ETB explores. Taken **third on average (ALSA 3.09)** but only **54.5% (n=519)**. A 4/3 for four trades down against this format's removal. |
| ⚠ | River Herald Guide | {2}{G} | Creature — Merfolk Scout | 3/1 | 3/1 **vigilance** that explores on ETB. **54.5% (n=549)** — a 3/1 dies to every damage-based interaction in the set, including a 1/1 block. |
| ⚠⚠ | **Huatli's Final Strike** | {2}{G} | Instant | — | **TRAP.** Your creature gets +1/+0 and deals damage equal to its power to a creature they control. It is **not a fight — their creature deals no damage back** — which is why it reads like removal. Taken **third on average (ALSA 3.05)** but **51.0% (n=524)**. It needs a big creature already in play, so it is dead exactly when you are losing, and killing your creature in response makes it a two-for-one for them. |
| ⚠⚠ | **Cavern Stomper** | {4}{G}{G} | Creature — Dinosaur | **7/7** | **TRAP.** ETB scry 2; **{3}{G}: can't be blocked by creatures with power 2 or less this turn.** **50.9% (n=672) — the worst measured common in the set.** Six mana, and Petrify {1}{W}, Unlucky Drop {3}{U}, Ray of Ruin {4}{B} and Quicksand Whirlpool all answer it for less mana. Big power is not the same as winning. |
| ✖ | Walk with the Ancestors | {4}{G} | Sorcery | — | Return a permanent card from your graveyard to hand, then discover 4. ALSA 9.34. |
| ✖ | Disturbed Slumber | {1}{G} | Instant | — | A land you control becomes a 4/4 with reach and haste that **must be blocked if able**. **ALSA 10.13 — the least-wanted common in the set.** Risks losing a land to any removal. |

**Summary:** the weakest colour at common by a clear margin. **All four measured green commons are below the 59.0% baseline (mean 52.7%)**, and green holds both genuine traps. Real defensive tools (Poison Dart Frog, Mineshaft Spider) and fine large bodies, but no removal and no evasion. Caveat: only 4 of 19 green commons cleared the sample threshold, so the mean is thin — but it agrees with green's pick position (mean ALSA 6.66).

---

## Colourless commons (6) and the Caves (7)

These 13 go in any deck, so the agent will see them in every game regardless of colours.

### Colourless (6)

| Mark | Card | Cost | Type | P/T | Note |
|---|---|---|---|---|---|
| ★ | Cartographer's Companion | {3} | Artifact Creature — Gnome | 2/1 | 2/1 plus a Map token, castable in **any** deck. **61.2% (n=593)** — better than most coloured commons. |
| | Compass Gnome | {2} | Artifact Creature — Gnome | 2/1 | ETB: search for a basic land **or Cave** and put it on top of your library. Fixing plus artifact count. |
| | Runaway Boulder | {6} | Artifact | — | **Flash**; ETB deals **6 damage** to target creature an opponent controls. **Cycling {2}** means it is never dead. |
| | Buried Treasure | {2} | Artifact — Treasure | — | {T}, sac: one mana of any colour. Later, **{5} exile from your graveyard: discover 5**, sorcery speed. Converts a dead draw into a threat. |
| | Hunter's Blowgun | {1} | Artifact — Equipment | — | +1/+1, and **deathtouch during its controller's turn, reach otherwise**. Equip {2}. See the asymmetry note in Combat 2. |
| ✖ | Disruptor Wanderglyph | {4} | Artifact Creature — Golem | 3/4 | 3/4 with a marginal graveyard-exile attack trigger. ALSA 9.22. |

### The Caves (7)

All commons. There is no dedicated Cave slot — they are seen at **0.86×** the rate of an average common, consistent with ordinary commons competing with spells.

| Mark | Card | Note |
|---|---|---|
| ★ | Captivating Cave | Enters **untapped**; {T} for {C}, or {1},{T} for any colour; {4},{T},sac puts two +1/+1 counters on a creature (sorcery speed). Best Cave — fixing at no tempo cost plus a late mana sink. ALSA 4.28. |
| | Promising Vein | Enters **untapped**, {T} for {C}; {1},{T},sac fetches a basic **tapped**. Free fixing that costs nothing on turn one. |
| | **Hidden Cataract** {U} · **Hidden Courtyard** {W} · **Hidden Necropolis** {B} · **Hidden Nursery** {G} · **Hidden Volcano** {R} | The five-card cycle: **enters tapped**, taps for the colour shown, and {4}+that colour,{T},sac **discovers 4** (sorcery speed). Free late value on a land slot, but the tapped land is a real cost in an aggressive deck — count how many you can afford. Hidden Volcano is the worst measured (53.8%, n=506); Hidden Cataract the best (58.1%, n=618). |

**Craft note:** **Kaslem's Stonetree {2}{G}** is the only common that needs a Cave specifically, and **Compass Gnome {2}** is the only common that finds one.

---

## Premium commons and traps, consolidated

### Premium — worth building toward

| Card | Cost | Colour | Evidence |
|---|---|---|---|
| Dead Weight | {B} | B | **66.4% (n=539)** — highest of any LCI common |
| Tithing Blade | {1}{B} | B | 63.6% GIH (n=909), 61.7% GP (n=1,947) — largest common samples in the set |
| Abrade | {1}{R} | R | **ALSA 2.07** — earliest-taken common in the format |
| Goblin Tomb Raider | {R} | R | 62.7% (n=593) |
| Miner's Guidewing | {W} | W | 62.5% (n=875) |
| Tinker's Tote | {2}{W} | W | 62.4% (n=585) |
| Oltec Cloud Guard | {3}{W} | W | 61.8% (n=633), ALSA 2.76 |
| Fanatical Offering | {1}{B} | B | 61.8% (n=720) |
| Deathcap Marionette | {1}{B} | B | 61.7% (n=958) — only common deathtouch creature |
| Join the Dead | {1}{B}{B} | B | 61.3% (n=630), ALSA 2.56 |
| Cartographer's Companion | {3} | colourless | 61.2% (n=593) — and it goes in every deck |
| Unlucky Drop | {3}{U} | U | 61.2% (n=804) |
| Skullcap Snail | {1}{B} | B | 61.1% (n=560) |
| Waterwind Scout | {2}{U} | U | 60.7% (n=963), ALSA 2.65 |
| Inverted Iceberg | {1}{U} | U | 60.3% GP (n=1,382) — best blue common |
| Petrify | {1}{W} | W | 60.0% (n=563), ALSA 2.79 |
| Quicksand Whirlpool | {5}{W} | W | 59.1% (n=748) — at baseline by data; taken on the strength of instant-speed exile for {2}{W} |
| Poison Dart Frog | {1}{G} | G | ALSA 2.85; fixes mana, has reach, gains deathtouch |

### Traps — highly picked, statistically losing

| Card | Cost | Colour | ALSA | GP WR | Why it fails |
|---|---|---|---|---|---|
| **Cavern Stomper** | {4}{G}{G} | G | 5.47 | **50.9%** (n=672) | 7/7 for six; four commons answer it for less mana |
| **Huatli's Final Strike** | {2}{G} | G | **3.05** | **51.0%** (n=524) | Needs a big creature already in play, so it is dead exactly when you are behind |
| Hidden Volcano | — | Cave | 5.26 | 53.8% (n=506) | Enters tapped; the discover costs 5+ and is rarely reached |
| Pathfinding Axejaw | {3}{G} | G | **3.09** | 54.5% (n=519) | 4/3 for four trades down against this format's removal |
| River Herald Guide | {2}{G} | G | 4.72 | 54.5% (n=549) | 3/1 dies to everything, including a 1/1 block |
| Panicked Altisaur | {4}{R} | R | 4.50 | 55.2% (n=518) | Five mana, no board impact on arrival |
| Glorifier of Suffering | {2}{W} | W | 6.30 | 55.4% (n=625) | The sacrifice cost on the ETB is real |
| Ancestors' Aid | {1}{R} | R | 8.12 | 55.7% (n=519) | Still spends a card to win one combat |
| Cosmium Blast | {1}{W} | W | 5.28 | 57.5% (n=722) | Reads as premium removal; only hits **attacking or blocking** creatures |

**The two clearest traps are both green and both taken inside the first three picks.** If the picking model offers either as an early pick, be suspicious.

**Weak but harmless** — terrible pick positions, so they never tempt you: Disturbed Slumber (ALSA 10.13, worst in set), Relic's Roar (10.02), Song of Stupefaction (9.95), Acrobatic Leap (9.86), Family Reunion (9.82), Daring Discovery (9.77), Walk with the Ancestors (9.34), Hunter's Blowgun (9.31), Disruptor Wanderglyph (9.22), Tectonic Hazard (9.73).

---

## Colour depth at common

LCI is exactly symmetric on paper — **19 commons in every colour** — so depth is entirely about quality.

| Colour | Commons | Creatures | Mean GP WR | n measured | Above 59.0% baseline | Mean ALSA (QD) | Commons taken by pick 5 |
|---|---|---|---|---|---|---|---|
| **1. Black** | 19 | 11 | **61.0%** | 11 | **8 / 11** | 6.79 *(latest)* | 3 |
| **2. White** | 19 | 11 | 60.0% | 10 | **8 / 10** | 5.91 | 9 |
| **3. Blue** | 19 | 10 | 59.1% | 10 | 4 / 10 | 6.73 | 6 |
| **4. Red** | 19 | 11 | 58.9% | 6 | 3 / 6 | **5.42** *(earliest)* | 10 |
| **5. Green** | 19 | 11 | **52.7%** | 4 | **0 / 4** | 6.66 | 6 |

Creature counts are **front faces you can actually cast**. Three craft cards flip into creatures — Oteclan Levitator (W) 1/4, Iceberg Titan (U) 6/6, Kaslem's Strider (G) 5/5 — but they are artifacts when cast, not creatures.

- **Black had the deepest commons:** best mean win rate, most commons above baseline, the single best common, the best-sampled common, removal at one/two/three mana, and the only deathtouch body.
- **Green was clearly the weakest:** every measured green common is below baseline, and it holds both genuine traps. Green has **no common removal** — its closest thing, Huatli's Final Strike, is the trap.
- **White is the safest colour**, with two clean answers and the best one-drop.
- **Red is taken earliest but is not the deepest** — Abrade and Goblin Tomb Raider are excellent; the middle of the colour is thin.

### The exploitable divergence

Black has the **best win rates and the latest average pick position**. That is the signature of an underdrafted colour, and in Quick Draft the drafters setting that pick position are bots.

| Card | Cost | QD ALSA (bots) | Premier ALSA (humans) | Gap |
|---|---|---|---|---|
| **Tithing Blade** | {1}{B} | 6.26 | 4.23 | **+2.02** — wheels in Quick Draft |
| Mephitic Draught | {1}{B} | 9.50 | 7.67 | +1.83 |
| Deconstruction Hammer | {W} | 7.91 | 6.44 | +1.47 |
| Staggering Size | {1}{G} | 8.25 | 6.84 | +1.41 |
| Etali's Favor | {2}{R} | 5.37 | 4.02 | +1.35 |

Cards the **bots overrate** relative to humans (take them later than the bots do — they will not wheel): Ray of Ruin (−1.87), Rumbling Rockslide (−1.66), Idol of the Deep King (−1.62), Dead Weight (−1.54), Unlucky Drop (−1.48).

---

## Quick Draft vs Premier Draft

| Dimension | Quick Draft | Premier Draft | Consequence |
|---|---|---|---|
| Who you draft against | **7 bots**, picks influenced by *MTGO* data | 7 humans | Signals are much weaker. "This colour is open" reads are unreliable. |
| Match format | **Best-of-one** | Best-of-one | Identical — no sideboarding either way. |
| Run structure | 7 wins / 3 losses | 7 wins / 3 losses | Identical. |
| Entry | 5,000 gold / 750 gems | 10,000 gold / 1,500 gems | Quick Draft is the cheap queue. |
| Pick-order distortion | Bots systematically misprice cards | Human consensus | Black commons and Tithing Blade specifically come later. |
| Format availability | Rotates through past formats **every fortnight** | Latest format plus a rotating queue | LCI Quick Draft appears on a rotation, not continuously. |

**Deck construction:** minimum 40 cards; 17 lands is the standard. The five Hidden Caves enter tapped — count them against an aggressive curve. Drafting and deckbuilding are **untimed**, so all deliberation belongs there rather than in-match.

---

## Unverified — do not rely on these

- ~~Who the matches are against~~ — **now verified.** Wizards' MTG Arena formats page ("play against live players") and Arena's in-client Codex (`Codex/WaysToPlay/Formats/Limited_QuickDraft_A`, "you'll still play against other human opponents") both say humans. See Format facts above.
- ~~Arena Bo1 opening-hand smoothing~~ — **now verified as first-party**, from Arena's own tip `Queue_Tip_22`: *"In best-of-one matches, your starting hand is selected from two random hands, leaning towards the one with the more average land-spell mix."* Still unverified: whether smoothing is reapplied after a mulligan. Do not factor it into a mulligan decision; see `limited-fundamentals.md` §1 and §11.
- **Absolute 17lands percentages.** The endpoint is degraded (see caveat table). Ordering is directional; the numbers are not comparable to published 2023-24 figures, which could not be retrieved for cross-check.
- **Cards with no win-rate data.** 64 of 108 commons fall below the sample threshold. Their ★/⚠ marks reflect pick position plus card-text evaluation, not measured performance. Marks backed by data carry their sample size inline.
- **Pack composition.** "Commons are 77.6% of cards seen" and "no dedicated Cave slot" are inferred from 17lands `seen_count`, not from an official Arena collation statement.
- **Whether LCI Quick Draft is currently in rotation.** The wiki states Quick Draft alternates formats every fortnight; confirm availability in the client.

---

## Sources

- **Scryfall API** — all card names, mana costs, type lines, power/toughness, oracle text and keywords, retrieved 2026-09-10: `https://api.scryfall.com/cards/search?q=set%3Alci+rarity%3Acommon&unique=cards` (113 unique cards; 108 after removing the 5 basics). Keyword rosters taken from Scryfall's structured `keywords` field, not text matching.
- **Comprehensive Rules.** Every rule cited here was re-checked against the **current** text, effective August 7, 2026 (`https://media.wizards.com/2026/downloads/MagicCompRules%2020260819.txt`), which is the version the rest of this knowledge base uses. *(An earlier pass of this file quoted the June 7, 2024 document — a version that predates the 8 November 2024 deletion of damage assignment order. Nothing cited below changed between the two, but do not re-derive combat rules from the 2024 text.)* Rules used: CR 110.4/110.4a (permanent card), 506.4b (tapping after declaration), 508.1f (attacking taps), 509.1a (blockers untapped), 509.1h (remains blocked), 702.2c (deathtouch assignment), 702.19b/d (trample), 702.20b (vigilance), 702.111b (menace).
- **17lands card ratings, LCI Quick Draft**: `https://www.17lands.com/card_ratings/data?expansion=LCI&format=QuickDraft` — 108 commons; 44 with GP WR, 4 with GIH WR; 72,056 total games.
- **17lands card ratings, LCI Premier Draft**: `https://www.17lands.com/card_ratings/data?expansion=LCI&format=PremierDraft` — 71,238 total games; used only for the bot-vs-human ALSA comparison.
- **Degraded-endpoint evidence**: requests with `start_date=2023-11-14&end_date=2023-11-16` and `start_date=2023-01-01&end_date=2026-09-10` returned byte-identical JSON (SHA-256 `d33c292b96622e2c…`), proving the date filters are ignored.
- **MTG Wiki, *Magic: The Gathering Arena/Events***, retrieved 2026-09-10 via `https://mtg.fandom.com/api.php?action=parse&page=Magic:%20The%20Gathering%20Arena/Events&prop=wikitext` — entry fees, best-of-one, 7 wins / 3 losses, seven robot drafters, untimed drafting, 3×14 packs, 40-card minimum, fortnightly rotation; Traditional Draft best-of-three / 5 wins / 2 losses.
- **Not used:** the MTG Wiki *Booster Draft* page's "Quick Draft" section describes **tabletop** quick draft, not the Arena event, and was deliberately excluded from all Arena claims.

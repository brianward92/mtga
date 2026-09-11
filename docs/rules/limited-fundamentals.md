# Limited fundamentals

> Use this when: you are in a game and have to decide whether to block, whether to attack, whether to trade, or whether you are winning the race. Combat sections first; grep `PROCEDURE` for the step lists.

LCI applications live in [`../formats/lci/rules-anchors.md`](../formats/lci/rules-anchors.md), with generated card tables in [`../formats/lci/combat-reference.md`](../formats/lci/combat-reference.md).

---

## Quick reference

- **Quick Draft is Best-of-One.** No game 2, no sideboarding. Never trade this game's equity for information. Never concede — play to 0 life.
- **Damage assignment order no longer exists.** It was deleted from the rules effective 2024-11-08. Every LCI-era article (LCI shipped Nov 2023) describes the old rule. When two or more of your creatures block one attacker, **the attacker divides its damage freely at the damage step, with full information, with no lethal-first requirement** (CR 510.1c). Assume the worst split for you.
- **Block test.** Their creature dies iff `your power >= their toughness`. Your creature dies iff `their power >= your toughness`. **FREE** (theirs dies, yours lives) and **WALL** (nobody dies) are always correct. Take them.
- **Survival first.** Sum every attacker's power. If that total `>= your life`, block enough to live and ignore card economy entirely.
- **A chump block on a trampler absorbs only your blocker's toughness**, not the attacker's power (CR 702.19b). Against a non-trampler it absorbs everything.
- **A blocked creature deals no damage to you even if a trick kills your blocker** (CR 509.1h + 510.1c). Only trample leaks through (702.19d). Blocking into a possible trick is less bad than it feels.
- **After blockers are declared the attacker acts first** (CR 509.2). As the defender you get the last word.
- **Tapped creatures cannot block** (509.1a) and untap only in their controller's untap step (502.3). Anything you attack with cannot block next turn. Count the crackback first.
- **Race formula.** On your turn you win iff `ceil(their_life / your_clock) <= ceil(your_life / their_clock)`. On their turn you need strictly `<`.
- **On the play, be the beatdown.** Play-side wins 64.9% of LCI games ending by turn 6 and 47.8% of games reaching turns 11–12. On the draw, trade, block, and get past turn 9.
- **Half of LCI Quick Draft games are over by turn 9** (each player has had ~9 turns); 90% by turn 12. A card you cannot cast by turn 8 usually will not matter.
- **Ahead:** trade, simplify, close their one out. **Behind:** refuse trades, keep the board complicated, name your out and play as if you will draw it.
- **Damage wears off at end of turn** (CR 514.2). A 4/4 that took 3 is a fresh 4/4 next turn.
- **Mulligan rule:** keep any functional hand with 2–5 lands. In this data a kept seven wins 57.2% and a hand mulliganed to six wins 42.0%.

---

## 2. The rules change every LCI-era article predates

LCI released November 2023. The combat rules changed November 2024. Every LCI set review, primer and combat guide describes the old rule.

**Old rule (in force through CR 2024-08-02), rule 509.2:** "the active player announces that creature's damage assignment order… an attacking creature can't assign combat damage to a creature that's blocking it unless each creature ahead of that blocking creature in its order is assigned lethal damage."

**Current rule, CR 510.1c:** "If two or more creatures are blocking it, it assigns its combat damage to those creatures divided as its controller chooses among them."

The CR's own example: an attacking **Elvish Regrower (4/3)** blocked by **Vampire Spawn (2/3)** and **Helpful Hunter (1/1)** — "Elvish Regrower's controller can assign all 4 damage to the Hunter, 1 damage to the Spawn and 3 damage to the Hunter, 2 damage to each creature, 3 damage to the Spawn and 1 damage to the Hunter, or all 4 damage to the Spawn."

Verified by diffing the official rules files:

| CR version | Rule 509.2 |
|---|---|
| 2024-08-02 | "…the active player announces that creature's damage assignment order…" (phrase appears 19 times in the file) |
| **2024-11-08** | **"Second, the active player gets priority."** (phrase appears 0 times) |
| 2026-08-07 (current) | "Second, the active player gets priority." (0 times) |

**Two consequences, both against the defender:**

1. The attacker picks the split **at the combat damage step, after every trick has resolved** — not at declare-blockers before them. You cannot bait a locked-in order and blow it up.
2. **There is no overkill tax.** The attacker can destroy any subset of your blockers whose combined toughness is `<= the attacker's power`.

There is also no priority window between assignment and damage (CR 510.2), so nothing can be done once the split is chosen.

**Rule that follows: gang blocking is worse than it looks.** Only gang block when you accept losing whichever creature they pick, or when the attacker's power is below your smallest blocker's toughness so nothing of yours dies.

---

## 3. Combat rules reference

All from the Comprehensive Rules effective **August 7, 2026**.

| Question | Rule | Answer |
|---|---|---|
| Can a tapped creature block? | 509.1a | **No.** Blockers "must be untapped." A creature that attacked last turn is still tapped on the opponent's turn; it untaps only in *your* untap step (502.3). |
| Does attacking tap my creature? | 508.1f | Yes. "Attacking simply causes creatures to become tapped." Exception: vigilance (702.20b). |
| How many attackers can one blocker block? | 509.1a | **One**, unless an effect says otherwise. |
| My blocker dies to a trick — does the attacker still hit me? | 509.1h + 510.1c | **No.** "A creature remains blocked even if all the creatures blocking it are removed from combat," and a blocked creature with no blockers left "assigns no combat damage." |
| …unless it has trample | 702.19d | Then its damage hits you "as though all blocking creatures have been assigned lethal damage." |
| Attacker with two or more blockers — who picks the split? | 510.1c | The **attacker**, freely, at the damage step. No order, no lethal-first. |
| My blocker is blocking one attacker — where does its damage go? | 510.1d | All of it to that attacker. |
| Trample: must lethal go to blockers first? | 702.19b | **Yes**, before any damage reaches the player, and "lethal" counts damage already marked on the blocker this turn. |
| Chump blocking a trampler | 702.19b | Absorbs only the blocker's **toughness**. A 1/1 in front of a 5/5 trampler stops 1; you take 4. |
| Deathtouch + trample | 702.2c + 702.19b | 1 damage per blocker counts as lethal, so nearly everything tramples over. A 5/5 deathtouch trampler blocked by two 4/4s assigns 1 and 1 and hits you for 3. |
| Deathtouch generally | 702.2b, 704.5h | **Any** nonzero damage from a deathtouch source destroys the creature. |
| Menace | 702.111b | Cannot be blocked except by **two or more** creatures — which hands the attacker a free choice of which of the two dies (510.1c). |
| First strike / double strike | 510.4, 702.7b | Creates **two** combat damage steps. A non-first-striker killed in the first step deals **no** damage back. |
| Does damage carry to next turn? | 514.2 | **No.** All marked damage is removed in the cleanup step. |
| Does damage marked earlier this turn count toward lethal? | 704.5g | **Yes.** Total marked damage `>=` toughness destroys it. |
| Who acts first after blockers are declared? | 509.2 | The **active player** (the attacker). The defender therefore gets the last word. |
| Does tapping a blocker after blocks stop its damage? | 506.4b | **No.** Tapping a declared attacker or blocker "doesn't prevent its combat damage." |
| Can anything happen between damage assignment and damage? | 510.2 | **No.** "No player has the chance to cast spells or activate abilities between the time combat damage is assigned and the time it's dealt." |
| Player at 0 life | 704.5a | Loses as a state-based action. |

---

## 4. PROCEDURE: declaring blockers

Canonical procedure: [`blocking-procedure.md`](blocking-procedure.md).

## 5. PROCEDURE: declaring attackers

1. **Establish your role** (Section 7). The beatdown attacks with nearly everything; the control player attacks only with what is free.
2. **For each creature, ask what happens if they block with their best untapped blocker.** Use the same four outcomes from the attacker's side.
3. **Attack with anything that is:**
   - **Free** — no profitable block exists (evasion, or bigger than everything they have untapped).
   - **A trade you want** — see Section 8.
   - **A semi-bluff** — you would prefer no block, but a block is acceptable. Attacking a creature into an identical creature is a semi-bluff: "We traded creatures of equal power that would've traded sooner or later anyway."
   - **Backed by a trick** — the strongest attacks. Tricks are far better on offense than defence, because on defence the opponent has all their mana open.
4. **Count the crackback before committing.** Everything you attack with is tapped (508.1f) and cannot block on their turn (509.1a, 502.3). Sum their untapped power plus plausible haste and burn, and confirm you survive.
5. **Force a destined trade sooner rather than later.** "If you do it sooner rather than later you leave fewer chances for things to go wrong" — otherwise they draw the pump spell, remove your blocker, or add a bigger creature.
6. **If you are not planning to block with a creature, attack with it.** Early damage is free option value on a race you may be forced into later.

**Timing your own trick (CR 509.2):** as the attacker you must act first after blocks, so expect a response. If you are confident the defender will act, wait — you get another priority window after they do. If you fear instant-speed removal on the creature you intend to pump, do not pump into open mana at all: you lose both cards.

---

## 6. Racing arithmetic

Both players attack every turn with a fixed clock and nothing else changes. `Lyou`/`Lopp` are life totals, `Cyou`/`Copp` are damage per turn.

- Turns for you to kill them: `Ty = ceil(Lopp / Cyou)`
- Turns for them to kill you: `To = ceil(Lyou / Copp)`

> **Your turn (you attack next): you win the race iff `Ty <= To`.**
> **Their turn (they attack next): you win the race iff `Ty < To`.**

Verified exhaustively against a turn-by-turn simulation over 80,000 combinations of life totals 1–25 and clocks 1–8: **0 mismatches.**

### Turns you survive = `ceil(life / incoming damage per turn)`

| your life | clock 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 10 |
|---|---|---|---|---|---|---|---|---|---|
| **2** | 2 | 1 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| **3** | 3 | 2 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| **4** | 4 | 2 | 2 | 1 | 1 | 1 | 1 | 1 | 1 |
| **5** | 5 | 3 | 2 | 2 | 1 | 1 | 1 | 1 | 1 |
| **6** | 6 | 3 | 2 | 2 | 2 | 1 | 1 | 1 | 1 |
| **8** | 8 | 4 | 3 | 2 | 2 | 2 | 2 | 1 | 1 |
| **10** | 10 | 5 | 4 | 3 | 2 | 2 | 2 | 2 | 1 |
| **12** | 12 | 6 | 4 | 3 | 3 | 2 | 2 | 2 | 2 |
| **14** | 14 | 7 | 5 | 4 | 3 | 3 | 2 | 2 | 2 |
| **16** | 16 | 8 | 6 | 4 | 4 | 3 | 3 | 2 | 2 |
| **18** | 18 | 9 | 6 | 5 | 4 | 3 | 3 | 3 | 2 |
| **20** | 20 | 10 | 7 | 5 | 4 | 4 | 3 | 3 | 2 |

**Does declining this block cost me a turn?** Taking `X` damage costs a full turn only if `ceil((L - X) / C) < ceil(L / C)`. Life is not a smooth resource — it matters only at the boundaries, which sit at life `C, 2C, 3C…`.

- At **10** life against a **5** clock you survive 2 turns. Decline a block and take 2 → 8 life, still 2 turns. **The 2 damage was free.**
- At **11** life against a **5** clock you survive 3 turns; take 2 → 9 life, 2 turns. **That 2 damage cost a full turn.**

**Chump-blocking discipline.** "There's often little point to chump blocking early because you might still be able to get some value from your creature, and because your opponent's most threatening attackers aren't even in the picture yet." But do not wait too long: you can drop low enough to die to an evasive creature or a burn spell, they can remove your chump blocker, or a trick can ruin the plan. Use the table above to find the last turn on which the chump still buys a turn, and chump then.

**Trample breaks chump math** (702.19b): a chump on a trampler absorbs only your blocker's toughness, minus any damage already marked on it this turn.

---

## 8. Trading creatures

A creature-for-creature trade is card-neutral. The question is never "is this 1-for-1?" but "does simplifying the board help me or them?"

**Master rule: trades favour whoever wins the long game. Seek them as the control player; refuse them as the beatdown.**

| Take the trade when | Refuse the trade when |
|---|---|
| You are the control player / have inevitability | You are the beatdown and need the clock |
| You are on the draw and want turn 9+ | You are on the play and want to end it by turn 8 |
| You are **ahead** — simplify to lock it in | You are **behind** — keep the board complicated |
| Their creature costs more or does more | Your creature has a pending job |
| Their creature is one you cannot otherwise answer | The trade is destined and you can force it on better terms later |
| The life saved crosses a race boundary (Section 6) | You are at high life and the damage is irrelevant |

**Why ahead ⇒ trade:** "A simple game is a controlled game and a predictable game. In such a case, your advantages are more likely to remain advantages."

**Why behind ⇒ refuse:** "When I'm losing, I might be willing to take some extra damage in order to maintain a complicated board state where unexpected things can happen. When you have zero creatures facing down two creatures, there's no room for interpretation — you're losing. When you have two creatures against four creatures, however, you might have some space to maneuver."

---

## 10. Ahead and behind

"Most people play their worst when games aren't close. They either lose hope or they give up completely when things look bad. They get overconfident and careless when everything seems to be going their way."

**WHEN BEHIND — play to your outs.**

1. **Name the out.** Identify the specific card or event you need, then play as if you are definitely going to get it. If you play normally and miss, you lose; if you play to the out and miss, you lose anyway; if you play normally and hit, you are probably still losing. Only "play to the out and hit" wins. **Playing to your outs is free.**
2. **Complicate the board.** Take extra damage to keep more permanents in play.
3. **Opponent mistakes are outs.** Make the attack that only works if they block a particular way.
4. **Never concede.** "Don't concede a game of Magic until you're at 0 life." In Bo1 there is nothing to save. Even facing lethal, make them declare the attack.

**WHEN AHEAD — close the door.**

1. **Enumerate how you lose.** What are they hoping to draw? Protect against exactly that. "When you're winning, you have resources to spare, so you can sometimes afford to make otherwise-unfavorable trades and blocks if it means closing a door."
2. **Simplify.** Trade at every opportunity.
3. **Protect the relevant resource.** If they can only win with burn or an evasive creature, protect your life total even at material cost. If they can only win with a sweeper, hold creatures back.
4. **Cast the winning card immediately.** Never slow-roll.

**The trap: playing safe versus playing scared.** Playing around a card is correct when you can afford the tempo; it becomes playing scared when it hands the opponent extra draw steps. "There's tremendous danger in giving your opponent extra draw steps, even when you think you've planned for all eventualities."

> **Decision rule: play around a card only if doing so does not extend the game.** If holding back adds turns to the clock, count the extra draws you are gifting.

---

## 11. Mulligans and land drops

> **Two to Five Lands Strategy: "Keep your hand if you have between two and five lands. Mulligan if you have zero, one, six, or seven lands."**

What a mulligan actually costs, from 823,614 LCI Premier Draft games:

| Mulligans | Games | Win rate |
|---|---|---|
| 0 (kept 7) | 729,238 | **57.2%** |
| 1 (to 6) | 90,082 | **42.0%** |
| 2 (to 5) | 4,169 | 25.9% |

A mulligan to six is worth about **15 points of win rate** in this data. (These are realised win rates of hands that were mulliganed, not a clean causal estimate — but they are the decision-relevant numbers: this is what your game looks like after taking the mulligan. Absolute levels are inflated by the 17Lands population, whose overall win rate here is 55.3%.) **Keep any seven you judge better than that.** In Limited, keep most functional hands.

**Deviations, from Reid Duke's Limited mulligan article:**
- **Mulligan a two-lander** whose spells you cannot cast off those two lands, or that does nothing before turn 4.
- **Mulligan a slow hand with an aggressive deck** — you will lose the late game you were not built for. Raise your standards further against a very fast opponent.
- **Keep a one-lander only** if you are on the draw, have more than one card costing one or two mana, and can do something special with it. Otherwise mulligan: from a 17-land deck holding one land, you hit land two **48.5%** on the first draw step and **74.2%** across the first two.
- **Keep a six-lander only** if your mana is bad and this hand has all your colours, or the single spell reliably trades for two or more of their cards.
- **Keep looser if your deck is weak** (you need the variance); **keep tighter if your deck is strong**.
- **If the opponent mulliganed, keep tighter on risky hands and looser on slow-but-safe hands.** "Your opponent can't have their best draw, so you don't need perfection in order to win — just something functional."

*Note: that article predates the London mulligan. Under CR 103.5 a mulligan to six is a selected six of seven, which makes mulliganing slightly better than the article assumes; the two-to-five rule itself still holds.*

### Hypergeometric reference, 40-card deck, no scry or card draw

Opening seven, land count:

| Lands in deck | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | keepable 2–5 |
|---|---|---|---|---|---|---|---|---|---|
| 16 | 1.9% | 11.6% | 27.4% | 31.9% | 19.8% | 6.5% | 1.0% | 0.1% | 85.5% |
| **17** | 1.3% | 9.2% | 24.5% | 32.3% | 22.6% | 8.4% | 1.5% | 0.1% | **87.8%** |
| 18 | 0.9% | 7.2% | 21.6% | 32.0% | 25.3% | 10.6% | 2.2% | 0.2% | 89.5% |

Probability of having your Nth land on turn N:

| Lands | seat | T3 | T4 | T5 | T6 |
|---|---|---|---|---|---|
| 16 | play | 80.0% | 64.0% | 46.7% | 30.9% |
| **17** | **play** | **84.5%** | **70.7%** | **54.6%** | **38.8%** |
| 18 | play | 88.2% | 76.7% | 62.3% | 47.1% |
| 16 | draw | 86.9% | 73.9% | 58.0% | 41.5% |
| **17** | **draw** | **90.4%** | **79.9%** | **65.9%** | **50.4%** |
| 18 | draw | 93.1% | 84.9% | 73.2% | 59.2% |

**Even with 17 lands you hit your fifth land drop on time only 54.6% of the time on the play.** That, plus the fact that half of games end by turn 9, is the real argument for a low curve: a six-drop is a card you cast on time in a minority of the games it appears in.

---

## 12. How Limited games get thrown away

Pre-loss checklist. Most losses from ahead come from this list rather than from bad luck.

| # | Failure | Fix |
|---|---|---|
| 1 | **Not blocking.** Taking damage that adds up while creatures sit idle. | A creature earns value only on turns it attacks or blocks. Take every FREE and WALL block. |
| 2 | **Gang blocking under the old rules.** Assuming the attacker must overkill the first blocker. | CR 510.1c: they split freely at damage time with full information. Assume the worst split. |
| 3 | **Chump blocking a trampler as if it stops everything.** | It absorbs only the blocker's toughness (702.19b). |
| 4 | **Playing scared.** Holding back for turns to dodge one card, gifting draw steps. | Play around a card only if it does not extend the game. |
| 5 | **Pumping into open mana.** Losing creature and trick to one removal spell. | Prefer tricks on offense, when they are tapped out. |
| 6 | **Miscounting the race.** | Run `ceil(their life / your clock)` vs `ceil(your life / their clock)` before every combat. |
| 7 | **Chumping too early, or one turn too late.** | Use the survival table; find the last turn the chump still buys a turn. |
| 8 | **Refusing a trade when ahead.** | Ahead ⇒ trade. Behind ⇒ complicate. |
| 9 | **Trading while you are the beatdown.** | Assign the role first, then decide the trade. |
| 10 | **Wasting early mana waiting for a perfect line.** | In the early stage, using all your mana beats a marginally better play next turn. |
| 11 | **Treating a damaged creature as still weakened next turn.** | Marked damage clears at cleanup (514.2). |
| 12 | **Forgetting attackers cannot block.** Alpha strike, then die to the crackback. | Count their untapped power before declaring attackers. |
| 13 | **Conceding early.** | Play to 0. In Bo1 there is nothing to save. |
| 14 | **Autopilot on small decisions** — which land to play, which creature to pump. | "You never know which of your decisions is going to matter. Therefore, you have to behave as though each and every one of them is important." |
| 15 | **Holding a lethal card to be safe.** | Cast the winning card immediately. |

**Two-question pre-combat ritual, every turn:**
1. Am I the beatdown or the control player right now?
2. If the game goes five more turns, who wins? If them, force the action. If me, simplify and defend.

---

## Sources

- **Magic: The Gathering Comprehensive Rules, effective August 7, 2026** — https://media.wizards.com/2026/downloads/MagicCompRules%2020260819.txt — downloaded and grepped directly. Source for 103.5, 103.8a, 502.3, 506.4b, 508.1f, 509.1a, 509.1h, 509.2, 510.1c, 510.1d, 510.2, 510.4, 514.2, 702.2b, 702.2c, 702.7b, 702.19b, 702.19d, 702.20b, 702.111b, 704.5a, 704.5g, 704.5h. Every rule quoted here was read from this file.
- **CR 2024-08-02** (https://media.wizards.com/2024/downloads/MagicCompRules%2020240802.txt) vs **CR 2024-11-08** (https://media.wizards.com/2024/downloads/MagicCompRules%2020241108.txt) — downloaded and diffed to date the removal of damage assignment order: the phrase appears 19 times in the first file and 0 times in the second.
- **Scryfall API** — https://api.scryfall.com/cards/named?exact=<name>&set=lci and https://api.scryfall.com/cards/search?q=set:lci — every card name, mana cost, power/toughness and oracle text in this file was fetched live.
- **17Lands play/draw dataset** — https://www.17lands.com/data/play_draw — LCI Quick Draft n=377,449; Premier Draft n=1,103,311; Traditional Draft n=100,680; Sealed n=57,152. Source of the play-side win rates and the Quick Draft game-length histogram.
- **17Lands public game data, LCI Premier Draft** — https://17lands-public.s3.amazonaws.com/analysis_data/game_data/game_data_public.LCI.PremierDraft.csv.gz — 823,614 game records downloaded and analysed locally for play/draw by game length, mulligan win rates, and the `num_turns` semantics check. (17Lands publishes no Quick Draft equivalent; that URL returns 403.)
- **Mike Flores, "Who's The Beatdown?"** — https://articles.starcitygames.com/articles/whos-the-beatdown/ — "Misassignment of Role = Game Loss."
- **Reid Duke, Level One (Wizards of the Coast)** — archived article text, verified by grep for every quoted sentence:
  - *Attacking and Blocking* (2015-04-13) — blocking bias, semi-bluffs, trade sooner, tricks on defence, trick count.
  - *Damage Racing* (2015-05-04) — chump-block timing, ending the game quickly.
  - *Role Assignment* (2015-01-05) — do not race a faster deck, roles are fluid, mirroring on the draw.
  - *Inevitability* (2014-12-08) — the 30-cards-and-100-mana test.
  - *Playing Ahead, Playing Behind* (2015-03-30) — ahead/behind, simplify vs complicate, never concede.
  - *Tempo & Card Advantage: A Delicate Balance* (2014-11-17) — no exchange rate; early/late stage.
  - *Tempo* (2014-09-22) — wasted mana as a red flag.
  - *When to Cast Your Spells* (2015-08-31) — wait until the last possible moment.
  - *Playing Safe and Playing Scared* (2015-08-24) — extra draw steps.
  - *Mulligans Part II: Limited* (2015-06-15) — the Two to Five Lands Strategy and its deviations.
  - *Play or Draw* (2015-03-16) — always choose to play first.
  - *Going Through the Motions* (2015-05-11) — every decision matters.
- **Draftsim, MTG Arena Quick Draft guide** — https://draftsim.com/mtg-arena-quick-draft/ — Bo1 confirmation, bot draft, 7 wins / 3 losses, entry costs.
- **Draftsim, MTG Arena Bo1 hand smoothing** — https://draftsim.com/mtg-arena-bo1-hand-smoothing/ — two candidate hands, land-ratio selection, Bo1 only.
- **Computed locally, not taken from a secondary source:** all hypergeometric opening-hand and land-drop probabilities for 40-card decks at 16/17/18 lands; the block outcome grid; the survival table; and the race formula, verified against an exhaustive turn-by-turn simulation of 80,000 combinations with zero mismatches.

### Marked unverified

- Whether Arena's opening-hand smoothing is skipped after a mulligan. The smoothing itself is first-party (Arena tip `Queue_Tip_22`, quoted in §1) and applies "in best-of-one matches" to "your starting hand"; no source establishes what happens after a mulligan. Do not factor it into mulligan decisions.
- ~~Whether match opponents in Quick Draft are always human~~ — **resolved, they are.** Wizards' MTG Arena formats page: Quick Draft is "Draft cards against bots… to play against **live players**". Arena's own Codex says the same. §1 is updated.
- Whether LCI is currently in Arena's Quick Draft rotation. Quick Draft cycles through sets; check the client.

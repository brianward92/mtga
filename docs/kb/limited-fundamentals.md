# Limited fundamentals

> Use this when: you are in a game and have to decide whether to block, whether to attack, whether to trade, or whether you are winning the race. Combat sections first; grep `PROCEDURE` for the step lists.

Companion files: `lci-combat-reference.md` (every LCI instant-speed card by colour, removal, open-mana threats), `lci-playbook.md` (LCI archetypes and card-level play).

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

## 1. Format facts

| Property | Quick Draft | Premier Draft |
|---|---|---|
| Draft opponents | Bots, sequential | 8 humans |
| Match format | **Best-of-one** | Best-of-one |
| Run ends at | 7 wins or 3 losses | 7 wins or 3 losses |
| Entry | 5,000 gold / 750 gems | 10,000 gold / 1,500 gems |
| Deck | Minimum 40 cards | Minimum 40 cards |

Source: Draftsim's Quick Draft guide, which states "Quick Draft is restricted to Best-of-One only games (BO1)". Corroborated structurally by 17Lands' event taxonomy, which gives every best-of-three event a separate label (`TradDraft`, `TradSealed`, `*_Bo3`) and lists no Bo3 variant of `QuickDraft`.

**What Bo1 changes in play:**

1. There is no game 2 and no sideboarding. Never take a line that spends equity to gather information.
2. Never concede early "to save time for the next game" — there is no next game.
3. Mulligans use the London rule (CR 103.5): draw a full seven, then put N cards on the bottom. A mulligan to six is a *selected* six out of seven — bottom the worst card, not a random one.
4. Arena applies opening-hand smoothing in Bo1 formats only: it looks at two candidate opening hands and keeps the one whose land-to-spell ratio is closer to the deck's overall ratio. Practical effect: extreme opening sevens (0–1 land, 6–7 lands) are rarer than raw hypergeometric math predicts. (Draftsim; secondary source.)

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

Run all seven steps in order. Do not shortcut.

**Step 1 — Survival check, before anything else.**
- Sum the power of every attacker. Call it `T`.
- If `T < your life`, you cannot die this combat; blocking is a value decision. Go to Step 2.
- If `T >= your life`, you **must** block enough. Required absorption `A = T - life + 1`.
  - Blocking a non-trampler of power `P` absorbs `P` — all of it.
  - Blocking a trampler of power `P` absorbs only `min(P, your blocker's toughness)`.
- Add their reach from hand: count untapped lands and available colours, add the largest pump those colours can produce.
- At this step card economy is irrelevant. Chump as much as needed.

**Step 2 — Take every free block.** With your blocker `Pb/Tb` against attacker `Pa/Ta`:
- `Pb >= Ta` and `Pa < Tb` → **FREE BLOCK**: theirs dies, yours lives. Always take it.
- `Pb < Ta` and `Pa < Tb` → **WALL BLOCK**: nobody dies, damage absorbed for free. Always take it.

**Step 3 — Decide trades.** `Pb >= Ta` and `Pa >= Tb` → both die.
- **Take it** if: you are not the beatdown; their creature is better than yours; you are on the draw or behind on board and want a long game; the life saved crosses a race boundary (Section 6).
- **Refuse it** if: you are the beatdown and need that creature attacking; your creature has a pending job (trigger, evasion, alpha strike); you are at a life total where the damage is irrelevant.

**Step 4 — Chump blocks.** Only when Step 1 forces it, or the creature has no remaining job. Do not chump early to protect life you do not need — check the survival table in Section 6 first. A creature left alive can chump a *bigger* threat later.

**Step 5 — Gang blocks (two or more on one attacker).**
- You kill it only if `sum of your blockers' powers >= attacker's toughness`.
- **The attacker picks the split at damage time with full information** (CR 510.1c). Assume they destroy the most valuable subset of your blockers whose combined toughness is `<= their power`.
- Only gang block if (a) you accept losing whichever creature they choose, or (b) `attacker power < your smallest blocker's toughness`, so nothing of yours dies.
- **Never gang block a deathtouch attacker.** One damage each kills every blocker.
- A menace attacker forces a gang block; treat it as (a) and pick two creatures you can afford to lose one of.

**Step 6 — Trick check.**
- Count their untapped lands and available colours; assume the biggest pump or removal in those colours (Section 9 and `lci-combat-reference.md`) and re-run Steps 2–5.
- A block that degrades FREE → TRADE is usually still fine. A block that degrades to "my creature dies and theirs lives" is the one to reconsider.
- **Consolation:** even if a trick kills your blocker, the attacker is still blocked and deals **no** damage to you (509.1h, 510.1c). You still absorbed the whole attack. Only trample leaks.
- You get the last word — the attacker must act first after blocks (509.2).

**Step 7 — Flip-the-answer checklist.** Re-check the block if the attacker has first strike or double strike (your creature can die before dealing damage), deathtouch (any block loses your creature), trample (chumps leak), menace (needs two blockers), or if a lord or pump effect is already on their board.

### Single-block outcome grid

Rows are your blocker, columns their attacker.

| your blocker | 2/1 | 2/2 | 3/2 | 3/3 | 4/2 | 4/4 | 5/5 | 6/6 |
|---|---|---|---|---|---|---|---|---|
| **1/1** | TRADE | CHUMP | CHUMP | CHUMP | CHUMP | CHUMP | CHUMP | CHUMP |
| **2/2** | TRADE | TRADE | TRADE | CHUMP | TRADE | CHUMP | CHUMP | CHUMP |
| **2/3** | FREE | FREE | TRADE | CHUMP | TRADE | CHUMP | CHUMP | CHUMP |
| **3/3** | FREE | FREE | TRADE | TRADE | TRADE | CHUMP | CHUMP | CHUMP |
| **0/4** | WALL | WALL | WALL | WALL | CHUMP | CHUMP | CHUMP | CHUMP |
| **1/4** | FREE | WALL | WALL | WALL | CHUMP | CHUMP | CHUMP | CHUMP |
| **3/5** | FREE | FREE | FREE | FREE | FREE | WALL | CHUMP | CHUMP |
| **4/4** | FREE | FREE | FREE | FREE | TRADE | TRADE | CHUMP | CHUMP |
| **5/5** | FREE | FREE | FREE | FREE | FREE | FREE | TRADE | CHUMP |

**Default bias: block more than feels comfortable.** A creature produces value only on turns it attacks or blocks — "If you neither attack nor block with Wetland Sambar, then you've wasted a turn's worth of its value." And "people bluff less often than you'd expect and people block less often than you'd expect." (Reid Duke, *Attacking and Blocking*.) A 0/5 that never blocks was a blank card.

---

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

## 7. Roles, and the play/draw data that decides them

Mike Flores, *Who's The Beatdown?* (1999): **"Misassignment of Role = Game Loss."** Reid Duke's restatement: "Do not try to race against an opponent who can output damage faster than you. Do not try to outlast an opponent with a stronger late game."

**The core test is inevitability.** "If you were to let both players draw 30 cards and spot them 100 free mana every turn for the rest of the game, who would win?" **The player without inevitability must be the beatdown.**

| Signal | You are the BEATDOWN | You are the CONTROL |
|---|---|---|
| Seat | On the play | On the draw |
| Curve | Lower than theirs | Higher than theirs |
| Board right now | Ahead on creatures | Behind on creatures |
| Removal in hand | Fewer | More |
| Bombs / card advantage engines | They have them | You have them |
| Evasion | You have it | They have it |
| Life totals | You are lower | You are higher |
| Land drops | You missed one | They missed one |

### The seat is a hard signal, not a feeling

LCI Premier Draft public game data, 823,614 games. Play-side win rate is bias-corrected as `(win rate on play + (1 - win rate on draw)) / 2`, which removes the skill bias of the 17Lands user population (their raw win rate in this data is 55.34%, not 50%).

| Game length | Play-side win rate | games |
|---|---|---|
| ends by turn 6 | **64.9%** | 137,133 |
| turns 7–8 | 54.4% | 255,996 |
| turns 9–10 | 49.2% | 217,392 |
| turns 11–12 | **47.8%** | 122,714 |
| turns 13+ | 48.9% | 90,379 |

**Read it as a role assignment rule.** On the play your equity is concentrated in short games: be the beatdown by default and try to end it by turn 8. On the draw your equity is in long games: trade, block, stabilise, and push the game past turn 9, where the extra card makes you the favourite.

*Caveat: causation runs partly the other way — games are short partly because someone got run over. The direction of the effect is solid; treat the exact percentages as indicative.*

### Overall play advantage

| Format | Play-side win rate | games |
|---|---|---|
| **LCI Quick Draft** | **53.0%** | 377,449 |
| LCI Premier Draft | 53.2% | 1,103,311 |
| LCI Traditional (Bo3) Draft | 53.3% | 100,680 |
| LCI Sealed | 52.8% | 57,152 |

In the raw LCI Premier Draft records: 58.6% win rate on the play vs 52.1% on the draw — a 6.5 point gap in user win rate.

### By seat

| | On the play | On the draw |
|---|---|---|
| Role default | Beatdown | Control |
| Target game length | End by turn 8 | Reach turn 10+ |
| Trades | Refuse trades that blunt your clock | Take almost every trade |
| Blocking | Block less; keep attacking | Block more; stabilise |
| Land drops | You are a card behind: 84.5% to hit turn 3 with 17 lands | 90.4% to hit turn 3 |

"Mirroring your opponent's actions when you're on the draw will often be a losing battle" — to break serve you must trade resources and slow the game down.

**Roles are fluid.** "Your deck might be aggressive, but if your opponent has a fast start you simply have to play defense." Re-run the checklist whenever the board materially changes. The classic failure is a deck built to attack that keeps attacking into a board it can no longer beat: "You have to be willing to cast your Stormbreath Dragon and not attack, as strange as it may feel."

**Turning the corner.** Stop defending and start killing as soon as your defence is stable enough, not when it is perfect. "There's a ton of value in being able to end the game quickly," because you leave much less room for things to go wrong.

### How long the game lasts

LCI Quick Draft, 377,449 games. A "turn" here is a full turn cycle — each player has had that many turns. (Verified: in the raw records, a player on the play has drawn about `num_turns - 1` cards and a player on the draw about `num_turns`, which is only possible if the field counts each player's own turns.)

| Turn | share ending | cumulative |
|---|---|---|
| ≤5 | — | 6.8% |
| 6 | 10.2% | 17.0% |
| 7 | 15.4% | 32.3% |
| **8** | **16.4%** | **48.8%** |
| 9 | 14.6% | 63.4% |
| 10 | 11.7% | 75.1% |
| 11 | 8.6% | 83.7% |
| 12 | 5.9% | 89.6% |
| 14 | 2.5% | 96.0% |

Median: turn 9. **Half of all games are over by turn 9 and 90% by turn 12.** A card you cannot cast by turn 8 will not matter in most games.

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

## 9. Tempo, card advantage, and when to cast a trick

There is no exchange rate. "It's impossible to say that 'this much tempo is a fair trade for this much card advantage.'" What you can do is identify which resource is currently binding.

| | Early stage | Late stage |
|---|---|---|
| Bottleneck | **Mana** — many spells, few lands | **Cards** — much mana, empty hands |
| Scarce resource | Tempo | Cards, life total |
| Right play | Develop the board; spend all your mana every turn | Squeeze maximum value from each card, even slowly |
| Card draw spells | Hold them | Cast them |
| In LCI Quick Draft | roughly turns 1–5 | roughly turns 6+ |

Operational rules:

1. **In the early stage, spending all your mana every turn is close to the whole game.** If the choice is a perfect play next turn or a good play now, take the good play now. "If you find yourself very often ending the turn without using all of your mana, this should be a red flag."
2. Deploy creatures and removal first; save card draw for the late stage.
3. An early tempo lead converts into life total and does not evaporate when the board stabilises.
4. Play your land before your spells. When two plays are both available, make the one that gives you more information or more options later.

### Holding a trick versus deploying

**Default: "All things equal, it's best to wait until the last possible moment to cast your spells."** Two situations override it and say cast now: you gain a real tempo advantage by deploying on curve, or you fear a specific response and **all their lands are tapped** right now — take that window even if it means casting an instant at sorcery speed.

| Situation | Play |
|---|---|
| You are attacking, they have open mana and might have a trick | Wait. If they act you get another window; if you commit first they answer with full information. |
| You are attacking, they are tapped out | Cast at your last opportunity — after blockers, before damage. |
| You are blocking and want to use a trick | Bad spot by default: "You shouldn't plan to use combat tricks when you block, because your opponent will have all of his or her mana open." |
| You hold damage-based removal and they have a pump spell | Cast it on your own turn, on your terms. |
| You hold unconditional removal and they can grant hexproof | Cast it while they are tapped out. |

**Do not overload on tricks.** "If you draw an awkward hand with too many combat tricks, you'll be forced to use them in imperfect situations, playing into your opponent's hands." Reid Duke cautions against more than two or three combat tricks in a Limited deck.

**Worst outcome to avoid:** pumping a creature into open mana and having it removed in response — a two-for-one plus a wasted turn.

### LCI anchors: what open mana can mean

All Scryfall-verified, all LCI, common unless marked. The full list is in `lci-combat-reference.md`; these are the ones that change combat math most.

| Card | Cost | Effect |
|---|---|---|
| Acrobatic Leap | {W} | +1/+3, gains flying, untap it (an untapped blocker, or a blocker that blocks twice) |
| Relic's Roar | {U} | Target artifact or creature becomes a Dinosaur artifact creature with **base P/T 4/3** — can shrink a big attacker as well as grow a small one |
| Cogwork Wrestler | {U} | 1/2 artifact creature with **flash**; on ETB, a creature an opponent controls gets −2/−0 (a surprise blocker *and* a shrink) |
| Dreadmaw's Ire (uncommon) | {R} | Target attacking creature gets +2/+2 and gains trample |
| Abrade | {1}{R} | 3 damage to target creature |
| Ancestors' Aid | {1}{R} | +2/+0 and first strike; create a Treasure |
| Cosmium Blast | {1}{W} | 4 damage to target attacking or blocking creature |
| Family Reunion | {1}{W} | Your creatures get +1/+1, **or** your creatures gain hexproof |
| Brackish Blunder | {1}{U} | Return target creature to owner's hand |
| Staggering Size | {1}{G} | +3/+3 and trample — wins the combat *and* leaks damage past a chump |
| Fungal Fortitude | {1}{B} | **Flash** Aura: +2/+0, and the creature returns to the battlefield tapped when it dies |
| Bitter Triumph (uncommon) | {1}{B} | Destroy target creature or planeswalker (discard a card or pay 3 life) |
| Join the Dead | {1}{B}{B} | −5/−5; **−10/−10 instead with descend 4** (four or more permanent cards in their graveyard) |
| Huatli's Final Strike | {2}{G} | Their creature takes damage equal to your creature's power (+1/+0 first) — a removal spell that does not need combat |

Two open green mana is the single biggest swing: Staggering Size {1}{G} makes any blocked creature three points bigger *and* a trampler.

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

- Whether Arena's opening-hand smoothing is skipped after a mulligan. The sources establish that it is Bo1-only and applies to the opening hand; they do not establish what happens after a mulligan. Do not factor it into mulligan decisions.
- Whether match opponents in Quick Draft are always human. Draftsim confirms the draft is against bots and the format is Bo1, but no source reachable here states the match-opponent policy. The Bo1 format itself is well corroborated.
- Whether LCI is currently in Arena's Quick Draft rotation. Quick Draft cycles through sets; check the client.

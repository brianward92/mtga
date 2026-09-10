# LCI combat reference

> Use this when: deciding whether to attack or block, or working out what the opponent's open mana threatens.

**Generated from `lci-cards.json` by `scripts/build_kb_combat.py`. Do not edit by hand.** Every number here is computed from the card pool, so it cannot drift from reality the way a written list does. Regenerate after any card file rebuild.

Draftable pool: **291 cards**, of which **159 are creatures**.

## Who has what

Counts of draftable cards carrying each combat-relevant keyword, split by colour. This is the answer to "can anything in their colours block my flier" and "how likely is that blocker to have deathtouch".

| Keyword        | All | W | U | B | R | G | C |
|----------------|-----|---|---|---|---|---|---|
| Flying         | 25  | 8 | 7 | 5 | 1 | 0 | 2 |
| Reach          | 4   | 0 | 0 | 0 | 1 | 3 | 0 |
| Menace         | 6   | 0 | 0 | 3 | 1 | 0 | 1 |
| Trample        | 14  | 0 | 0 | 0 | 6 | 5 | 1 |
| Deathtouch     | 4   | 0 | 0 | 3 | 0 | 0 | 0 |
| First strike   | 2   | 0 | 0 | 0 | 2 | 0 | 0 |
| Double strike  | 1   | 1 | 0 | 0 | 0 | 0 | 0 |
| Lifelink       | 5   | 1 | 0 | 3 | 0 | 0 | 1 |
| Vigilance      | 10  | 2 | 3 | 0 | 0 | 2 | 1 |
| Ward           | 9   | 1 | 2 | 0 | 0 | 1 | 2 |
| Hexproof       | 1   | 0 | 0 | 0 | 0 | 0 | 1 |
| Indestructible | 1   | 0 | 0 | 0 | 1 | 0 | 0 |
| Defender       | 1   | 0 | 1 | 0 | 0 | 0 | 0 |
| Flash          | 12  | 3 | 5 | 1 | 1 | 1 | 1 |

## What a creature costs

The bodies actually in the format at each mana value. Use it to judge whether a trade is fair and what is likely to be on the other side of an unknown blocker.

| MV | Count | Most common bodies                    |
|----|-------|---------------------------------------|
| 1  | 14    | 1/1 x9, 1/2 x3, 0/3 x1, None/None x1  |
| 2  | 43    | 2/2 x14, 2/1 x5, 1/1 x4, None/None x4 |
| 3  | 41    | 3/3 x6, 3/2 x5, 3/1 x5, 2/2 x4        |
| 4  | 28    | 4/4 x6, 3/3 x5, 4/3 x4, 3/2 x4        |
| 5  | 16    | 5/4 x3, 4/4 x2, 5/5 x1, 3/2 x1        |
| 6  | 10    | 6/6 x3, 4/4 x2, 7/7 x1, 5/6 x1        |
| 7  | 3     | 6/7 x1, 5/5 x1, 0/0 x1                |
| 8  | 4     | 6/6 x1, 5/5 x1, 12/12 x1, 7/6 x1      |

## What open mana threatens

Instant-speed only, because a sorcery cannot ruin a block and treating one as a threat is how you talk yourself out of a good attack. Read the row for the opponent's untapped mana.

| Mana | Instants | Can kill | Can pump | Colours |
|------|----------|----------|----------|---------|
| 1    | 4        | 1        | 2        | RUW     |
| 2    | 16       | 4        | 4        | BGRUW   |
| 3    | 10       | 1        | 3        | BGRUW   |
| 4    | 2        | 0        | 0        | U       |
| 5    | 1        | 0        | 0        | U       |
| 6    | 2        | 2        | 0        | CW      |

## Every instant-speed card, by colour

The full list, since "how many" is only useful up to the point where you need to know "which". Sorted by cost.

### W

| Cost   | Name                                          | R | Effect                                                                                     |
|--------|-----------------------------------------------|---|--------------------------------------------------------------------------------------------|
| {W}    | Acrobatic Leap                                | C | Target creature gets +1/+3 and gains flying until end of turn. Untap it.                   |
| {1}{W} | Cosmium Blast                                 | C | Cosmium Blast deals 4 damage to target attacking or blocking creature.                     |
| {1}{W} | Family Reunion                                | C | Choose one —                                                                               |
| {1}{W} | Get Lost                                      | R | Destroy target creature, enchantment, or planeswalker. Its controller creates two Map t... |
| {1}{W} | Spring-Loaded Sawblades // Bladewheel Chariot | U | Flash                                                                                      |
| {2}{W} | Kutzil's Flanker                              | R | Flash                                                                                      |
| {2}{W} | Mischievous Pup                               | U | Flash (You may cast this spell any time you could cast an instant.)                        |
| {5}{W} | Quicksand Whirlpool                           | C | This spell costs {3} less to cast if it targets a tapped creature.                         |

### U

| Cost      | Name                                   | R | Effect                                                                                     |
|-----------|----------------------------------------|---|--------------------------------------------------------------------------------------------|
| {U}       | Cogwork Wrestler                       | C | Flash                                                                                      |
| {U}       | Relic's Roar                           | C | Until end of turn, target artifact or creature becomes a Dinosaur artifact creature wit... |
| {1}{U}    | Brackish Blunder                       | C | Return target creature to its owner's hand. If it was tapped, create a Map token. (It's... |
| {1}{U}    | Eaten by Piranhas                      | U | Flash (You may cast this spell any time you could cast an instant.)                        |
| {1}{U}    | Lodestone Needle // Guidestone Compass | U | Flash                                                                                      |
| {1}{U}    | Malcolm, Alluring Scoundrel            | R | Flash                                                                                      |
| {2}{U}    | Confounding Riddle                     | U | Choose one —                                                                               |
| {2}{U}    | Tishana's Tidebinder                   | R | Flash                                                                                      |
| {2}{U}{U} | Out of Air                             | C | This spell costs {2} less to cast if it targets a creature spell.                          |
| {3}{U}    | Unlucky Drop                           | C | Target artifact or creature's owner puts it on their choice of the top or bottom of the... |
| {3}{U}{U} | Hurl into History                      | U | Counter target artifact or creature spell. Discover X, where X is that spell's mana val... |

### B

| Cost      | Name               | R | Effect                                                                                     |
|-----------|--------------------|---|--------------------------------------------------------------------------------------------|
| {1}{B}    | Bitter Triumph     | U | As an additional cost to cast this spell, discard a card or pay 3 life.                    |
| {1}{B}    | Fanatical Offering | C | As an additional cost to cast this spell, sacrifice an artifact or creature.               |
| {1}{B}    | Fungal Fortitude   | C | Flash                                                                                      |
| {2}{B}    | Another Chance     | C | You may mill two cards. Then return up to two creature cards from your graveyard to you... |
| {1}{B}{B} | Join the Dead      | C | Target creature gets -5/-5 until end of turn.                                              |

### R

| Cost   | Name                                            | R | Effect                                                                                     |
|--------|-------------------------------------------------|---|--------------------------------------------------------------------------------------------|
| {R}    | Dreadmaw's Ire                                  | U | Until end of turn, target attacking creature gets +2/+2 and gains trample and "Whenever... |
| {1}{R} | Abrade                                          | C | Choose one —                                                                               |
| {1}{R} | Ancestors' Aid                                  | C | Target creature gets +2/+0 and gains first strike until end of turn.                       |
| {1}{R} | Zoyowa's Justice                                | U | The owner of target artifact or creature with mana value 1 or greater shuffles it into ... |
| {2}{R} | Idol of the Deep King // Sovereign's Macuahuitl | C | Flash                                                                                      |

### G

| Cost   | Name                    | R | Effect                                                                                     |
|--------|-------------------------|---|--------------------------------------------------------------------------------------------|
| {1}{G} | Disturbed Slumber       | C | Until end of turn, target land you control becomes a 4/4 Dinosaur creature with reach a... |
| {1}{G} | Staggering Size         | C | Target creature gets +3/+3 and gains trample until end of turn.                            |
| {2}{G} | Huatli's Final Strike   | C | Target creature you control gets +1/+0 until end of turn. It deals damage equal to its ... |
| {2}{G} | In the Presence of Ages | C | Reveal the top four cards of your library. You may put a creature card and/or a land ca... |
| {2}{G} | Malamet Scythe          | C | Flash                                                                                      |

### C

| Cost | Name            | R | Effect |
|------|-----------------|---|--------|
| {6}  | Runaway Boulder | C | Flash  |

## Removal, at any speed

Everything that answers a creature, including sorcery speed. Sorceries do not affect a block, but they do affect whether it is worth committing another creature to the board.

| Effect    | Count | At instant speed | Cheapest                                                       |
|-----------|-------|------------------|----------------------------------------------------------------|
| destroy   | 3     | 2                | Bitter Triumph {1}{B}, Get Lost {1}{W}, Molten Collapse {B}{R} |
| damage    | 4     | 2                | Abrade {1}{R}, Magmatic Galleon {3}{R}{R}, Runaway Boulder {6} |
| shrink    | 4     | 2                | Cogwork Wrestler {U}, Dead Weight {B}, Join the Dead {1}{B}{B} |
| exile     | 2     | 1                | Ray of Ruin {4}{B}, Quicksand Whirlpool {5}{W}                 |
| bounce    | 1     | 1                | Brackish Blunder {1}{U}                                        |
| tap       | 1     | 0                | Thousand Moons Crackshot {1}{W}                                |
| sacrifice | 1     | 0                | Tithing Blade // Consuming Sepulcher {1}{B}                    |
| fight     | 1     | 0                | Malamet Battle Glyph {G}                                       |


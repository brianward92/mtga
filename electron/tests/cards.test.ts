import { describe, it, expect } from 'vitest'
import {
  titleKey, crossSourceTitleKey, cleanArenaTitle, namesMatch,
  isLand, isBasicLand, isBasicLandName, poolSummary, castingColors, BASIC_LAND_COLOR
} from '../shared/cards'

describe('title keys', () => {
  it("reproduces Arena's Order_Title: lowercase, letters and digits, // kept", () => {
    expect(titleKey("Anim Pakal, Thousandth Moon")).toBe('animpakalthousandthmoon')
    expect(titleKey('Bake // Bloom')).toBe('bake//bloom')
    expect(titleKey(null)).toBe('')
  })

  it('reconciles the same card spelled by Arena and by Scryfall', () => {
    // Alchemy rebalances, split separators, and a meld card named from the
    // other face. A pack holding any of these lost Arena's ordering entirely,
    // because the sort keys are all-or-nothing per pack.
    expect(crossSourceTitleKey('A-Sarkhan, Soul Aflame')).toBe(crossSourceTitleKey('Sarkhan, Soul Aflame'))
    expect(crossSourceTitleKey('Bake /// Bloom')).toBe(crossSourceTitleKey('Bake // Bloom'))
  })

  it("strips Arena's presentation markup from a localized title", () => {
    expect(cleanArenaTitle('<nobr>Cat-Gator</nobr>')).toBe('Cat-Gator')
    expect(cleanArenaTitle('Hidden   Courtyard ')).toBe('Hidden Courtyard')
  })
})

describe('namesMatch', () => {
  it('accepts a name Arena truncated to fit the rail', () => {
    expect(namesMatch('Faramir, Field Comma...', 'Faramir, Field Commander')).toBe(true)
    expect(namesMatch('Anim Pakal, Thousa…', 'Anim Pakal, Thousandth Moon')).toBe(true)
  })

  it("accepts a name with the next row's count run onto the end", () => {
    // Vision groups rail rows by vertical position and the neighbouring row's
    // "1x" lands inside this row's box. That failed to match, the row read as
    // "not in the plan", and the builder cut all three copies of a wanted card.
    expect(namesMatch('Volatile Wanderglyph 1', 'Volatile Wanderglyph')).toBe(true)
  })

  it('still refuses two genuinely different cards', () => {
    expect(namesMatch('Plains', 'Mountain')).toBe(false)
    expect(namesMatch('Abrade', 'Abrade Extra')).toBe(false)
    expect(namesMatch('', 'Plains')).toBe(false)
  })
})

describe('land classification — one answer for the whole codebase', () => {
  it('classifies basics, nonbasic lands, and spells', () => {
    expect(isBasicLand({ name: 'Plains', type: 'Basic Land — Plains', rarity: 'land' })).toBe(true)
    expect(isLand({ name: 'Hidden Courtyard', type: 'Land', rarity: 'common' })).toBe(true)
    expect(isBasicLand({ name: 'Hidden Courtyard', type: 'Land', rarity: 'common' })).toBe(false)
    expect(isLand({ name: 'Abrade', type: 'Instant', rarity: 'common' })).toBe(false)
  })

  it('treats a rare land as its rarity, not as a land tier', () => {
    // Thornspire Verge leads its pack. Filing it in the bottom land tier
    // shifted every badge after it by one cell.
    expect(isLand({ name: 'Thornspire Verge', type: 'Land', rarity: 'rare' })).toBe(true)
  })

  it('handles the type text that split the old Python and TypeScript rules', () => {
    // statecheck.py tested `type.startswith("Basic Land")`, everything else
    // used a word-boundary regex. Arena's own type line puts a supertype first.
    expect(isBasicLand({ name: 'Snow-Covered Plains', type: 'Snow Basic Land — Plains', rarity: 'land' })).toBe(true)
    expect(isBasicLandName('Wastes')).toBe(true)
    expect(isBasicLandName('Wasteland')).toBe(false)
  })

  it('maps every basic to its colour', () => {
    expect(BASIC_LAND_COLOR).toEqual({ Plains: 'W', Island: 'U', Swamp: 'B', Mountain: 'R', Forest: 'G' })
  })
})

describe('poolSummary', () => {
  it('counts pips per colour, excludes lands, and counts multicolour once per colour', () => {
    const s = poolSummary([
      { name: 'Abrade', colors: 'R', type: 'Instant', rarity: 'common' },
      { name: 'Anim Pakal', colors: 'WR', type: 'Creature', rarity: 'rare' },
      { name: 'Compass Gnome', colors: '', type: 'Artifact Creature', rarity: 'common' },
      { name: 'Plains', colors: '', type: 'Basic Land — Plains', rarity: 'land' }
    ])
    expect(s).toEqual({ counts: { W: 1, U: 0, B: 0, R: 2, G: 0 }, colorless: 1, cards: 3, lands: 1 })
  })
})

describe('the pool sheet uses the shared land rule', () => {
  it('does not file a common cycle land under basic lands', () => {
    // The sheet carried a sixth copy of this rule testing only
    // `rarity === 'land'`, which Arena also gives the common cycle lands. Every
    // Hidden Courtyard and Murky Sewer was filed under "basic lands".
    expect(isBasicLand({ name: 'Hidden Courtyard', type: 'Land', rarity: 'land' })).toBe(false)
    expect(isBasicLand({ name: 'Murky Sewer', type: 'Land', rarity: 'land' })).toBe(false)
    expect(isBasicLand({ name: 'Plains', type: 'Basic Land — Plains', rarity: 'land' })).toBe(true)
  })
})

describe('castingColors — what a card COSTS, not what it is', () => {
  it('reads the mana cost when the printed colours are empty', () => {
    // Waterlogged Hulk is a double-faced artifact whose bundle entry carries
    // colors "" and manaCost "{U}". A lane check reading colors alone judged it
    // colourless, so the advisor built a blue card into a Red/White deck. It sat
    // in hand, uncastable, for an entire game.
    expect(castingColors({ name: 'Waterlogged Hulk', colors: '', manaCost: '{U}', colorIdentity: 'U', type: 'Artifact // Artifact — Vehicle' })).toEqual(['U'])
  })

  it('prefers the printed colours when they are there', () => {
    expect(castingColors({ name: 'Abrade', colors: 'R', manaCost: '{1}{R}', type: 'Instant' })).toEqual(['R'])
    expect(castingColors({ name: 'Anim Pakal', colors: 'RW', manaCost: '{1}{R}{W}', type: 'Creature' })).toEqual(['W', 'R'])
  })

  it('keeps a genuinely colourless card colourless', () => {
    expect(castingColors({ name: 'Compass Gnome', colors: '', manaCost: '{2}', type: 'Artifact Creature' })).toEqual([])
  })

  it('falls back to identity for a land, which prints no cost', () => {
    expect(castingColors({ name: 'Hidden Courtyard', colors: '', manaCost: '', colorIdentity: 'W', type: 'Land', rarity: 'common' })).toEqual(['W'])
  })
})

describe('namesMatch tolerates a clipped leading glyph', () => {
  it('accepts a long read missing its first character', () => {
    // Pick one of a live draft: the crop clipped the C. Refusing this aborted
    // the pick with the entry fee already paid.
    expect(namesMatch('hupacabra Echo', 'Chupacabra Echo')).toBe(true)
  })
  it('accepts a long read whose first character was mangled by the crop', () => {
    // Pick 15: a W with its left stroke clipped reads as a V.
    expect(namesMatch('Valk with the Ancestors', 'Walk with the Ancestors')).toBe(true)
  })
  it('still refuses short or unrelated reads', () => {
    expect(namesMatch('cabra', 'Chupacabra Echo')).toBe(false)
    expect(namesMatch('Staggering Siz', 'Chupacabra Echo')).toBe(false)
  })
})

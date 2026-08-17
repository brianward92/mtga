import { describe, expect, it } from 'vitest'
import {
  BASIC_LAND_NAMES, CLOSE_COUNT, TARGET_LANDS, TARGET_SPELLS,
  basicSplit, buildDeck, chooseLane
} from '../renderer/overlay/deckbuild'
import { deckHtml } from '../renderer/overlay/sheet'
import type { CardRow } from '../shared/state'

let nextGrp = 1

function card(over: Partial<CardRow> = {}): CardRow {
  return {
    grpId: nextGrp++, name: `Card ${nextGrp}`, rarity: 'common', colors: 'G',
    colorIdentity: 'G', manaCost: '{1}{G}', manaValue: 2, type: 'Creature — Bear',
    scryfallId: '', imageUrl: null, ev: 0, prob: null, rank: null,
    percentile: 0.5, grade: 'C', setPercentile: null, setGrade: null, ...over
  }
}

/** n copies of a distinctly named card at a given percentile. */
function copies(n: number, name: string, percentile: number, over: Partial<CardRow> = {}): CardRow[] {
  return Array.from({ length: n }, () => card({ name, percentile, ...over }))
}

describe('chooseLane', () => {
  it('takes the top two colours when the second is a real lane', () => {
    const pool = [...copies(10, 'G card', 0.9), ...copies(6, 'B card', 0.8, { colors: 'B' })]
    expect(chooseLane({ counts: { W: 0, U: 0, B: 6, R: 0, G: 10 }, colorless: 0, cards: 16, lands: 0 }))
      .toEqual(['G', 'B'])
    expect(buildDeck(pool).laneLabel).toBe('G/B')
  })

  it('stays mono when the runner-up is only a splash', () => {
    expect(chooseLane({ counts: { W: 0, U: 4, B: 0, R: 0, G: 12 }, colorless: 0, cards: 16, lands: 0 }))
      .toEqual(['G'])
  })

  it('has no lane for an empty pool', () => {
    expect(chooseLane({ counts: { W: 0, U: 0, B: 0, R: 0, G: 0 }, colorless: 0, cards: 0, lands: 0 })).toEqual([])
  })
})

describe('basicSplit', () => {
  it('splits by the pips the chosen spells actually ask for', () => {
    const spells = [...Array(6).fill({ manaCost: '{1}{G}' }), ...Array(2).fill({ manaCost: '{1}{B}' })]
    const split = basicSplit(spells, ['G', 'B'], 16)
    expect(split.reduce((s, r) => s + r.count, 0)).toBe(16)
    expect(split.find(r => r.color === 'G')!.count).toBeGreaterThan(split.find(r => r.color === 'B')!.count)
  })

  it('keeps a source for a colour that is barely represented', () => {
    const spells = [...Array(20).fill({ manaCost: '{G}' }), { manaCost: '{B}' }]
    const split = basicSplit(spells, ['G', 'B'], 17)
    expect(split.find(r => r.color === 'B')!.count).toBeGreaterThanOrEqual(1)
    expect(split.reduce((s, r) => s + r.count, 0)).toBe(17)
  })

  it('gives a double-pip colour enough sources to actually cast it', () => {
    // Mostly-green deck with two {1}{B}{B} cards: proportional-to-pips alone
    // lands on five Swamps, which does not cast them.
    const spells = [...Array(21).fill({ manaCost: '{1}{G}' }), ...Array(2).fill({ manaCost: '{1}{B}{B}' })]
    const split = basicSplit(spells, ['G', 'B'], 16)
    expect(split.find(r => r.color === 'B')!.count).toBeGreaterThanOrEqual(6)
    expect(split.reduce((s, r) => s + r.count, 0)).toBe(16)
  })

  it('never allocates a colour the deck cannot cast', () => {
    const split = basicSplit([{ manaCost: '{G}' }], ['G', 'B'], 17)
    expect(split.some(r => r.color === 'B')).toBe(false)
  })
})

describe('buildDeck', () => {
  const pool: CardRow[] = [
    ...copies(24, 'Green playable', 0.8),
    ...copies(6, 'Black playable', 0.7, { colors: 'B', manaCost: '{1}{B}' }),
    ...copies(4, 'Red card', 0.95, { colors: 'R', manaCost: '{1}{R}' }),
    ...copies(1, 'Utility land', 0.6, { colors: '', manaCost: '', type: 'Land', rarity: 'uncommon' })
  ]

  it('proposes exactly 40 cards from a deep pool', () => {
    const plan = buildDeck(pool)
    expect(plan.spellCount).toBe(TARGET_SPELLS)
    expect(plan.landCount).toBe(TARGET_LANDS)
    expect(plan.total).toBe(40)
    expect(plan.short).toBe(false)
  })

  it('never plays an off-lane card, however highly the model rates it', () => {
    const plan = buildDeck(pool)
    expect(plan.spells.some(s => s.name === 'Red card')).toBe(false)
    expect(plan.cut).toContainEqual({ color: 'R', count: 4 })
  })

  it('counts the non-basic land against the land slots', () => {
    const plan = buildDeck(pool)
    expect(plan.nonbasicLands).toHaveLength(1)
    const basics = plan.basics.reduce((s, b) => s + b.count, 0)
    expect(basics + plan.nonbasicLands.length).toBe(TARGET_LANDS)
    expect(plan.basics.map(b => BASIC_LAND_NAMES[b.color])).toContain('Forest')
  })

  it('names the closest cuts without claiming them as cut cards', () => {
    const plan = buildDeck(pool)
    expect(plan.close.length).toBeLessThanOrEqual(CLOSE_COUNT)
    // Every close card is one with no copy in the deck.
    for (const c of plan.close) expect(plan.statusByName[c.name].included).toBe(0)
  })

  it('reports a short deck rather than padding it with off-colour cards', () => {
    const thin = [...copies(10, 'Green playable', 0.8), ...copies(4, 'Red card', 0.95, { colors: 'R' })]
    const plan = buildDeck(thin)
    expect(plan.short).toBe(true)
    expect(plan.spellCount).toBe(10)
    expect(plan.spells.every(s => s.name === 'Green playable')).toBe(true)
  })

  it('ranks by the pool-conditioned percentile, not the raw set grade', () => {
    const pool2 = [
      card({ name: 'Great in my pool', percentile: 0.95, setPercentile: 0.1, setGrade: 'D' }),
      card({ name: 'Great in a vacuum', percentile: 0.2, setPercentile: 0.99, setGrade: 'A+' })
    ]
    expect(buildDeck(pool2).spells[0].name).toBe('Great in my pool')
  })

  it('survives a pool with no lane at all', () => {
    expect(buildDeck([]).lane).toEqual([])
    expect(deckHtml(buildDeck([]))).toBe('')
  })
})

describe('deckHtml', () => {
  it('leads with the verdict and escapes card names', () => {
    const pool = [
      ...copies(23, 'Green <b>playable</b>', 0.8),
      ...copies(4, 'Red card', 0.95, { colors: 'R' })
    ]
    const html = deckHtml(buildDeck(pool))
    expect(html).toContain('data-testid="deck-plan"')
    expect(html).toContain('cut R 4')
    expect(html).toContain('&lt;b&gt;playable&lt;/b&gt;')
    expect(html).not.toContain('<b>playable</b>')
    // The seam between model output and our own heuristics stays on screen.
    expect(html).toContain("Order is the model's")
  })
})

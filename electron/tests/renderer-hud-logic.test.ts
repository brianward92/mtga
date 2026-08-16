/**
 * HUD view-model helpers (renderer/overlay/hud-logic.ts) and the sheet's
 * pure HTML builders (renderer/overlay/sheet.ts).
 */
import { describe, it, expect } from 'vitest'
import type { CardRow, PickRecord } from '../shared/state'
import {
  agreement, bestPick, detailLine, eventTitle, groupPool, laneLean, nextCorner, packConviction,
  pickPosition, poolGroupOf, poolSummary, progressDots, rankedCards, sheetSide, whyLine
} from '../renderer/overlay/hud-logic'
import { picksHtml, poolHtml } from '../renderer/overlay/sheet'
import { sigmoid, formatDominancePct } from '../renderer/overlay/conviction'

function card(over: Partial<CardRow> & { grpId: number }): CardRow {
  return {
    name: `Card ${over.grpId}`, rarity: 'common', colors: '', colorIdentity: '', manaCost: '', manaValue: null, type: 'Creature',
    imageUrl: null, ev: null, prob: null, rank: null, percentile: null, grade: null,
    ...over
  }
}

function pick(over: Partial<PickRecord> & { pack: number; pick: number }): PickRecord {
  return { grpId: 1, name: 'Taken', recommendedGrpId: null, recommendedName: null, takenRank: null, ev: null, ...over }
}

describe('poolSummary', () => {
  it('counts colour pips, colourless and lands separately', () => {
    const s = poolSummary([
      card({ grpId: 1, colors: 'W' }),
      card({ grpId: 2, colors: 'WU' }),
      card({ grpId: 3, colors: '' }),
      card({ grpId: 4, colors: 'G', type: 'Basic Land — Forest' }),
      card({ grpId: 5, colors: 'g' })
    ])
    expect(s.counts).toEqual({ W: 2, U: 1, B: 0, R: 0, G: 1 })
    expect(s.colorless).toBe(1)
    expect(s.cards).toBe(4)
    expect(s.lands).toBe(1)
  })

  it('is empty for an empty pool', () => {
    expect(poolSummary([])).toEqual({ counts: { W: 0, U: 0, B: 0, R: 0, G: 0 }, colorless: 0, cards: 0, lands: 0 })
  })
})

describe('laneLean', () => {
  const summary = (counts: Partial<Record<'W' | 'U' | 'B' | 'R' | 'G', number>>) =>
    ({ counts: { W: 0, U: 0, B: 0, R: 0, G: 0, ...counts }, colorless: 0, cards: 0, lands: 0 })

  it('is null while the pool is small or spread', () => {
    expect(laneLean(summary({ W: 1, U: 1, B: 1 }))).toBeNull()
    expect(laneLean(summary({ W: 2, U: 2, B: 2, R: 2, G: 2 }))).toBeNull()
  })

  it('finds a two-colour lane when two colours own most pips', () => {
    const lean = laneLean(summary({ W: 5, U: 4, B: 1, R: 1 }))
    expect(lean).not.toBeNull()
    expect(lean!.colors).toEqual(['W', 'U'])
    expect(lean!.label).toBe('W/U')
    expect(lean!.share).toBeCloseTo(9 / 11, 6)
  })

  it('needs the second colour to clearly beat the third', () => {
    // W dominates but U and B tie: not yet a two-colour lane; W alone qualifies as mono.
    const lean = laneLean(summary({ W: 6, U: 2, B: 2 }))
    expect(lean).not.toBeNull()
    expect(lean!.colors).toEqual(['W'])
    expect(lean!.label).toBe('W')
  })

  it('reports a mono lane when one colour doubles the runner-up', () => {
    expect(laneLean(summary({ G: 6, R: 2, U: 1 }))!.label).toBe('G/R')
    expect(laneLean(summary({ G: 6, R: 1, U: 1 }))!.label).toBe('G')
  })
})

describe('rankedCards / packConviction / whyLine / detailLine', () => {
  const cards = [
    card({ grpId: 2, ev: 1, rank: 2, grade: 'B', percentile: 0.8}),
    card({ grpId: 1, ev: 3, rank: 1, grade: 'A', percentile: 0.97}),
    card({ grpId: 3 })
  ]

  it('ranks by the model and derives the pack conviction from the top two', () => {
    expect(rankedCards(cards).map(c => c.grpId)).toEqual([1, 2, 3])
    const c = packConviction(cards)!
    expect(c.dominance).toBeCloseTo(sigmoid(2), 12)
    expect(c.label).toBe('SLAM')
  })

  it('has no conviction before scores', () => {
    expect(packConviction(cards.map(c => ({ ...c, ev: null, rank: null })))).toBeNull()
  })

  it('formats the why line from dominance and the set grade when it differs', () => {
    const ranked = rankedCards(cards)
    const line = whyLine(ranked[0], ranked[1], packConviction(cards))
    expect(line).toBe(`${formatDominancePct(sigmoid(2))} over #2`)
    expect(whyLine(card({ grpId: 9, grade: 'B', setGrade: 'C+' }), null, null)).toBe('set C+')
    expect(whyLine(card({ grpId: 9 }), null, null)).toBe('')
  })

  it('formats the hover detail line', () => {
    expect(detailLine(card({ grpId: 1, rank: 2, prob: 0.234, ev: -0.5})))
      .toBe('#2 · p 23% · ev -0.50')
    expect(detailLine(card({ grpId: 1, ev: 1.234 }))).toBe('ev +1.23')
    expect(detailLine(card({ grpId: 1 }))).toBe('')
  })
})

describe('header helpers', () => {
  it('formats the pick position and event title', () => {
    expect(pickPosition({ pack: 2, pick: 7 })).toBe('P2P7')
    expect(pickPosition({ pack: null, pick: null })).toBe('')
    expect(eventTitle({ set: 'SOS', format: 'PremierDraft' })).toBe('SOS · Premier Draft')
    expect(eventTitle({ set: 'SOS', format: 'QuickDraft' })).toBe('SOS · Quick Draft')
    expect(eventTitle({ set: null, format: null })).toBe('? · Draft')
  })

  it('builds progress dots for the pack', () => {
    expect(progressDots({ pick: 3, picksPerPack: 5 })).toEqual(['done', 'done', 'current', 'todo', 'todo'])
    expect(progressDots({ pick: null, picksPerPack: 3 })).toEqual(['todo', 'todo', 'todo'])
    expect(progressDots({ pick: 1, picksPerPack: 0 })).toHaveLength(14)
  })

  it('cycles the HUD corner tl → tr → br → bl and picks the sheet side', () => {
    expect(nextCorner('tl')).toBe('tr')
    expect(nextCorner('tr')).toBe('br')
    expect(nextCorner('br')).toBe('bl')
    expect(nextCorner('bl')).toBe('tl')
    expect(sheetSide('tl')).toBe('left')
    expect(sheetSide('bl')).toBe('left')
    expect(sheetSide('tr')).toBe('right')
    expect(sheetSide('br')).toBe('right')
  })
})

describe('agreement / bestPick', () => {
  it('counts picks that matched the model among the scored ones', () => {
    const a = agreement([
      pick({ pack: 1, pick: 1, takenRank: 1 }),
      pick({ pack: 1, pick: 2, takenRank: 3 }),
      pick({ pack: 1, pick: 3, takenRank: null }),
      pick({ pack: 1, pick: 4, takenRank: 1 })
    ])
    expect(a).toEqual({ agreed: 2, scored: 3, rate: 2 / 3 })
    expect(agreement([])).toEqual({ agreed: 0, scored: 0, rate: null })
  })

  it('finds the strongest pool card by percentile', () => {
    expect(bestPick([card({ grpId: 1, percentile: 0.5 }), card({ grpId: 2, percentile: 0.9 }), card({ grpId: 3 })])!.grpId).toBe(2)
    expect(bestPick([card({ grpId: 3 })])).toBeNull()
  })
})

describe('groupPool', () => {
  it('groups WUBRG, multicolour, colourless, lands in order and sorts by mana value', () => {
    const groups = groupPool([
      card({ grpId: 1, colors: 'G', manaValue: 3, name: 'Bear' }),
      card({ grpId: 2, colors: 'G', manaValue: 1, name: 'Elf' }),
      card({ grpId: 3, colors: 'WU', manaValue: 2 }),
      card({ grpId: 4, colors: '', manaValue: 4 }),
      card({ grpId: 5, colors: '', type: 'Land', manaValue: 0 }),
      card({ grpId: 6, colors: 'W', manaValue: 2 })
    ])
    expect(groups.map(g => g.group)).toEqual(['W', 'G', 'M', 'C', 'L'])
    expect(groups[1].cards.map(c => c.name)).toEqual(['Elf', 'Bear'])
    expect(poolGroupOf(card({ grpId: 9, colors: 'ub' }))).toBe('M')
  })
})

describe('sheet html', () => {
  it('escapes names and shows grades', () => {
    const html = poolHtml([card({ grpId: 1, colors: 'R', name: 'Fire <b>Bolt</b>', manaCost: '{R}', grade: 'B+' })])
    expect(html).toContain('Fire &lt;b&gt;Bolt&lt;/b&gt;')
    expect(html).toContain('class="mana-symbol R"')
    expect(html).toContain('grade-b">B+')
    expect(poolHtml([])).toContain('No cards yet')
  })

  it('lists picks newest first with ✓ / rank tags and the model pick when different', () => {
    const html = picksHtml([
      pick({ pack: 1, pick: 1, grpId: 1, name: 'A', recommendedGrpId: 1, recommendedName: 'A', takenRank: 1 }),
      pick({ pack: 1, pick: 2, grpId: 2, name: 'B', recommendedGrpId: 3, recommendedName: 'C & D', takenRank: 3 })
    ])
    expect(html.indexOf('P1p2')).toBeLessThan(html.indexOf('P1p1'))
    expect(html).toContain('s-tag ok">✓')
    expect(html).toContain('s-tag off">#3')
    expect(html).toContain('→ C &amp; D')
    expect(picksHtml([])).toContain('No picks yet')
  })
})

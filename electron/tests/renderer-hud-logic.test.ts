/**
 * HUD view-model helpers (renderer/overlay/hud-logic.ts) and the sheet's
 * pure HTML builders (renderer/overlay/sheet.ts).
 */
import { describe, it, expect } from 'vitest'
import type { CardRow, PickRecord } from '../shared/state'
import {
  agreement, bestPick, detailLine, eventTitle, laneLean, nextCorner, packConviction,
  pickPosition, poolSummary, progressDots, RANKED_ROWS, rankedCards, rankedRows, sheetSide, whyLine
} from '../renderer/overlay/hud-logic'
import { picksHtml, poolColorCountsHtml, poolDisplayRows, poolHtml } from '../renderer/overlay/sheet'
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

describe('rankedRows', () => {
  it('always yields 5 rows (#1–#5), blank when the pack is short or empty', () => {
    expect(rankedRows([])).toHaveLength(RANKED_ROWS)
    expect(rankedRows([]).map(r => r.rank)).toEqual([1, 2, 3, 4, 5])
    expect(rankedRows([])).toEqual(Array.from({ length: 5 }, (_, i) => ({ rank: i + 1, name: '', grade: null, setGrade: null, pct: null })))
    const two = rankedRows([card({ grpId: 1, rank: 2, ev: 0.5, prob: 0.4 }), card({ grpId: 2, rank: 1, ev: 1, prob: 0.6 })])
    expect(two).toHaveLength(5)
    expect(two.map(r => r.name)).toEqual(['Card 2', 'Card 1', '', '', ''])
    expect(rankedRows(Array.from({ length: 14 }, (_, i) => card({ grpId: i + 1, rank: i + 1, ev: -i })))).toHaveLength(5)
  })

  it('lists the model ranking with pool grade, set grade only when different, and chip-rounded pick %', () => {
    const rows = rankedRows([
      card({ grpId: 1, name: 'Second', rank: 2, ev: 1, prob: 0.2549, grade: 'B', setGrade: 'B' }),
      card({ grpId: 2, name: 'First', rank: 1, ev: 2, prob: 0.605, grade: 'A-', setGrade: 'B+' }),
      card({ grpId: 3, name: 'Third', rank: 3, ev: 0, prob: 0.14, grade: null, setGrade: 'C' })
    ])
    expect(rows[0]).toEqual({ rank: 1, name: 'First', grade: 'A-', setGrade: 'B+', pct: 61 })
    expect(rows[1]).toEqual({ rank: 2, name: 'Second', grade: 'B', setGrade: null, pct: 25 })
    expect(rows[2]).toEqual({ rank: 3, name: 'Third', grade: null, setGrade: null, pct: 14 })
    expect(rows[3].name).toBe('')
    expect(rows[4].name).toBe('')
  })

  it('shows names in log order without grade/% while scoring or before scores exist', () => {
    const pack = [
      card({ grpId: 1, name: 'Logged first', rank: 2, ev: 1, prob: 0.3, grade: 'B', setGrade: 'C' }),
      card({ grpId: 2, name: 'Logged second', rank: 1, ev: 2, prob: 0.7, grade: 'A' })
    ]
    const scoring = rankedRows(pack, true)
    expect(scoring.map(r => r.name)).toEqual(['Logged first', 'Logged second', '', '', ''])
    expect(scoring.every(r => r.grade === null && r.setGrade === null && r.pct === null)).toBe(true)
    const unscored = rankedRows([card({ grpId: 1, name: 'A', grade: 'B' }), card({ grpId: 2, name: 'B', grade: 'A' })])
    expect(unscored.slice(0, 2)).toEqual([
      { rank: 1, name: 'A', grade: null, setGrade: null, pct: null },
      { rank: 2, name: 'B', grade: null, setGrade: null, pct: null }
    ])
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

describe('sheet html', () => {
  it('shows explicit WUBRG counts in a stable header order', () => {
    const html = poolColorCountsHtml([
      card({ grpId: 1, colors: 'WU' }),
      card({ grpId: 2, colors: 'R' }),
      card({ grpId: 3, colors: 'G', type: 'Land' })
    ])
    expect(html.match(/sheet-colour-chip/g)).toHaveLength(5)
    expect(html).toContain('data-colour="W" aria-label="White: 1"')
    expect(html).toContain('data-colour="U" aria-label="Blue: 1"')
    expect(html).toContain('data-colour="B" aria-label="Black: 0"')
    expect(html).toContain('data-colour="R" aria-label="Red: 1"')
    expect(html).toContain('data-colour="G" aria-label="Green: 0"')
  })

  it('escapes names and shows grades', () => {
    const html = poolHtml([card({ grpId: 1, colors: 'R', name: 'Fire <b>Bolt</b>', manaCost: '{R}', grade: 'B+' })])
    expect(html).toContain('Fire &lt;b&gt;Bolt&lt;/b&gt;')
    expect(html).toContain('class="mana-symbol R"')
    expect(html).toContain('grade-b">B+')
    expect(poolHtml([])).toContain('No cards yet')
  })

  it('groups duplicate names, keeps grade order, and retains every pick label', () => {
    const pool = [
      card({ grpId: 50, name: 'Plains', rarity: 'land', type: 'Basic Land — Plains' }),
      card({ grpId: 20, name: 'Twin Spell', grade: 'B', setGrade: 'B' }),
      card({ grpId: 30, name: 'Filler', grade: 'C', setGrade: 'C' }),
      card({ grpId: 10, name: 'Bomb', grade: 'A', setGrade: 'A' }),
      card({ grpId: 21, name: 'Twin Spell', grade: 'B', setGrade: 'B' }),
      card({ grpId: 40, name: 'Island', rarity: 'land', type: 'Basic Land — Island' })
    ]
    const picks = [
      pick({ pack: 2, pick: 5, grpId: 21, name: 'Twin Spell' }),
      pick({ pack: 1, pick: 2, grpId: 20, name: 'Twin Spell' }),
      pick({ pack: 1, pick: 1, grpId: 10, name: 'Bomb' })
    ]

    const rows = poolDisplayRows(pool, picks)
    expect(rows.map(row => row.card.name)).toEqual(['Bomb', 'Twin Spell', 'Filler', 'Island', 'Plains'])
    expect(rows.map(row => row.count)).toEqual([1, 2, 1, 1, 1])
    expect(rows.find(row => row.card.name === 'Twin Spell')?.pickLabels).toEqual(['P1p2', 'P2p5'])
    expect(rows.slice(-2).every(row => row.basicLand)).toBe(true)
  })

  it('renders one duplicate row with a count chip and a divider immediately before lands', () => {
    const pool = [
      card({ grpId: 50, name: 'Plains', rarity: 'land', type: 'Basic Land — Plains' }),
      card({ grpId: 20, name: 'Twin Spell', grade: 'B', setGrade: 'B' }),
      card({ grpId: 30, name: 'Filler', grade: 'C', setGrade: 'C' }),
      card({ grpId: 10, name: 'Bomb', grade: 'A', setGrade: 'A' }),
      card({ grpId: 21, name: 'Twin Spell', grade: 'B', setGrade: 'B' })
    ]
    const html = poolHtml(pool, [
      pick({ pack: 2, pick: 5, grpId: 21, name: 'Twin Spell' }),
      pick({ pack: 1, pick: 2, grpId: 20, name: 'Twin Spell' })
    ])

    expect(html.match(/<span class="s-name">Twin Spell<\/span>/g)).toHaveLength(1)
    expect(html).toContain('class="s-copy-count" aria-label="2 copies">×2</span>')
    expect(html).toContain('class="s-pick-labels" aria-label="Picked P1p2, P2p5">P1p2 · P2p5</span>')
    expect(html.match(/data-pool-section="lands"/g)).toHaveLength(1)
    expect(html).toMatch(/data-pool-section="lands">Lands<\/h3>\s*<div class="s-card basic-land">/)
    expect(html.indexOf('>Bomb</span>')).toBeLessThan(html.indexOf('>Twin Spell</span>'))
    expect(html.indexOf('>Twin Spell</span>')).toBeLessThan(html.indexOf('>Filler</span>'))
    expect(html.indexOf('>Filler</span>')).toBeLessThan(html.indexOf('data-pool-section="lands"'))
    expect(html.indexOf('data-pool-section="lands"')).toBeLessThan(html.indexOf('>Plains</span>'))
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

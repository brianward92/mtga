/**
 * Badge chip models (renderer/overlay/chips.ts): ranking, top-pick
 * conviction, runner-up head-to-head, unknown cards, scoring shimmer.
 */
import { describe, it, expect } from 'vitest'
import type { CardRow } from '../shared/state'
import { buildChips, rankOrder, shortBandLabel } from '../renderer/overlay/chips'
import { sigmoid, formatDominancePct } from '../renderer/overlay/conviction'

function card(over: Partial<CardRow> & { grpId: number }): CardRow {
  return {
    name: `Card ${over.grpId}`, rarity: 'common', colors: '', manaCost: '', manaValue: null, type: 'Creature',
    imageUrl: null, ev: null, prob: null, rank: null, percentile: null, grade: null, 
    ...over
  }
}

describe('rankOrder', () => {
  it('orders by explicit rank, then ev desc, unscored last, stable', () => {
    const cards = [
      card({ grpId: 1, ev: 0.5 }),
      card({ grpId: 2, rank: 1, ev: 3 }),
      card({ grpId: 3 }),
      card({ grpId: 4, rank: 2, ev: 2 }),
      card({ grpId: 5, ev: 1 }),
      card({ grpId: 6 })
    ]
    expect(rankOrder(cards)).toEqual([1, 3, 4, 0, 2, 5])
  })
})

describe('shortBandLabel', () => {
  it('uppercases and drops the trailing explanation', () => {
    expect(shortBandLabel('OBVIOUS BOMB — just take it')).toBe('OBVIOUS BOMB')
    expect(shortBandLabel('clear pick')).toBe('CLEAR PICK')
    expect(shortBandLabel('lean')).toBe('LEAN')
  })
})

describe('buildChips', () => {
  const scored = [
    card({ grpId: 10, ev: 3, prob: 0.6, rank: 1, percentile: 0.97, grade: 'A' }),
    card({ grpId: 11, ev: 1, prob: 0.2, rank: 2, percentile: 0.85, grade: 'B+' }),
    card({ grpId: 12, ev: 0, prob: 0.1, rank: 3, percentile: 0.5, grade: 'C' }),
    card({ grpId: 13, ev: -2, prob: 0.05, rank: 4, percentile: 0.1, grade: 'D' }),
    card({ grpId: 14 }) // unknown card
  ]

  it('gives the top pick the conviction band, dominance %, and #1', () => {
    const chips = buildChips(scored, false)
    const top = chips[0]
    expect(top.top).toBe(true)
    expect(top.tier).toBe('top')
    expect(top.rank).toBe(1)
    expect(top.grade).toBe('A')
    // dominance = sigmoid(3 - 1) ≈ 0.88 → SLAM, 5 flames (setPct 0.97 >= 0.75), pct shown
    expect(top.label).toBe('SLAM')
    expect(top.flames).toBe(5)
    expect(top.pct).toBe(formatDominancePct(sigmoid(2)))
  })

  it('gives runner-ups percentile flames, tier by grade, and h2h vs the card above', () => {
    const chips = buildChips(scored, false)
    expect(chips[1]).toMatchObject({ tier: 'b', rank: 2, flames: 4, label: null, pct: formatDominancePct(sigmoid(1 - 3)) })
    expect(chips[2]).toMatchObject({ tier: 'c', rank: 3, flames: 2, pct: formatDominancePct(sigmoid(0 - 1)) })
    expect(chips[3]).toMatchObject({ tier: 'd', rank: 4, flames: 1, pct: formatDominancePct(sigmoid(-2 - 0)) })
  })

  it('draws a frame only (no chip) for unknown cards', () => {
    const chips = buildChips(scored, false)
    expect(chips[4]).toMatchObject({ tier: null, chip: false, grade: null, flames: null, pct: null, rank: null, top: false })
  })

  it('withholds ranks/percentages and shimmers while scoring', () => {
    const chips = buildChips(scored, true)
    for (const c of chips) {
      expect(c.rank).toBeNull()
      expect(c.pct).toBeNull()
      expect(c.label).toBeNull()
      expect(c.top).toBe(false)
      expect(c.shimmer).toBe(true)
    }
    // Intrinsic grade + flames stay visible: they don't depend on the pack.
    expect(chips[0]).toMatchObject({ grade: 'A', flames: 5, tier: 'a', chip: true })
  })

  it('shows grades and flames but no ranks before any ev is known', () => {
    const unscored = scored.map(c => ({ ...c, ev: null, prob: null, rank: null }))
    const chips = buildChips(unscored, false)
    expect(chips[0]).toMatchObject({ grade: 'A', flames: 5, rank: null, pct: null, top: false, tier: 'a', shimmer: false })
    expect(chips[4].chip).toBe(false)
  })

  it('falls back to percentile flames for the top card when only one ev is known', () => {
    const one = scored.map((c, i) => (i === 0 ? c : { ...c, ev: null, rank: null }))
    const chips = buildChips(one, false)
    expect(chips[0]).toMatchObject({ top: true, rank: 1, flames: 5, label: 'SLAM', pct: null })
  })

  it('emits one model per card in state order', () => {
    expect(buildChips(scored, false)).toHaveLength(scored.length)
    expect(buildChips([], false)).toEqual([])
  })
})

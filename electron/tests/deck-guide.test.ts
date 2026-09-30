import { describe, expect, it } from 'vitest'
import { deckGuide, poolCounts } from '../shared/deck-guide'
import type { CardRow } from '../shared/state'
import type { DeckPlan } from '../shared/deck-plan'
const card = (name: string, colors: string, manaValue: number): CardRow => ({ name, colors, manaValue, type: 'Creature', manaCost: '', setGrade: 'B' } as CardRow)
const pool = [card('Blue', 'U', 1), card('White later', 'W', 3), card('White first', 'W', 1), card('White first', 'W', 1), card('Red cut', 'R', 2)]
const plan = { spells: [{ name: 'Blue', count: 1 }, { name: 'White later', count: 1 }, { name: 'White first', count: 2 }], nonbasicLands: [], basics: [{ color: 'W', count: 9 }, { color: 'U', count: 8 }], total: 21 } as unknown as DeckPlan

describe('deck building checklist', () => {
  it('orders additions by WUBRG, cost, title, with lands last', () => {
    expect(deckGuide(plan, pool, {}).add.map(r => r.name)).toEqual(['White first', 'White later', 'Blue', 'Plains', 'Island'])
  })
  it('tracks copies, extra cards, and excess copies separately', () => {
    const guide = deckGuide(plan, pool, { 'White first': 1, Blue: 2, 'Red cut': 1 })
    expect(guide.add.find(r => r.name === 'White first')?.remaining).toBe(1)
    expect(guide.cut.map(r => [r.name, r.remaining])).toEqual([['Blue', 1], ['Red cut', 1]])
    expect(guide.total).toBe(4)
  })
  it('starts drafts from the full pool and moves matching copies to done', () => {
    const guide = deckGuide(plan, pool, poolCounts(pool))
    expect(guide.done.map(r => r.name)).toEqual(['White first', 'White later', 'Blue'])
    expect(guide.cut[0].name).toBe('Red cut')
  })
})

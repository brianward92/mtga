import { describe, expect, it } from 'vitest'
import { buildWhy } from '../renderer/overlay/why'

interface TestCard {
  name: string
  type: string
  colors: string
  prob: number | null
  rank: number | null
}

function card(over: Partial<TestCard> = {}): TestCard {
  return { name: 'Ordinary Card', type: 'Creature', colors: '', prob: null, rank: null, ...over }
}

describe('recommendation WHY builder', () => {
  it('builds three factual clauses from the pick gap, pool lean and at most two hooks', () => {
    const top = card({
      name: 'Eerie Room // Survival Room',
      type: 'Enchantment — Room',
      colors: 'WU',
      prob: 0.61,
      rank: 1
    })
    const runnerUp = card({ prob: 0.264, rank: 2 })
    const pool = [
      card({ name: 'Eerie Watcher', colors: 'W' }),
      card({ name: 'Eerie Guest', colors: 'W' }),
      card({ name: 'Painter\'s Studio', type: 'Enchantment — Room', colors: 'W' }),
      ...Array.from({ length: 2 }, () => card({ colors: 'W' })),
      ...Array.from({ length: 4 }, () => card({ colors: 'U' })),
      card({ colors: 'B' })
    ]

    expect(buildWhy(top, runnerUp, pool)).toBe(
      '#1 by 35 pts over #2 · ' +
      'fits your W/U pool lean (5 W, 4 U) · +2 Eerie, +1 Room pool name/type matches'
    )
  })

  it('uses the direct probability gap and actual ranks, handles ties, and omits bad pairs', () => {
    expect(buildWhy(card({ prob: 0.6049, rank: 3 }), card({ prob: 0.2549, rank: 4 }), []))
      .toBe('#3 by 35 pts over #4')
    expect(buildWhy(card({ prob: 0.404 }), card({ prob: 0.403 }), []))
      .toBe('top pick by <1 pt over runner-up')
    expect(buildWhy(card({ prob: 0.4, rank: 1 }), card({ prob: 0.4, rank: 2 }), []))
      .toBe('#1 tied with #2 on pick probability')
    expect(buildWhy(card({ prob: null }), card({ prob: 0.2 }), [])).toBe('')
    expect(buildWhy(card({ prob: 0.2 }), card({ prob: 0.3 }), [])).toBe('')
    expect(buildWhy(card({ prob: 2 }), card({ prob: -1 }), [])).toBe('')
  })

  it('reports a qualified lane only when the candidate fits it', () => {
    const greenPool = [
      card({ colors: 'G' }), card({ colors: 'G' }), card({ colors: 'G' }),
      card({ colors: 'G' }), card({ colors: 'G' }), card({ colors: 'G' }),
      card({ colors: 'R' }), card({ colors: 'U' })
    ]
    expect(buildWhy(card({ colors: 'G' }), null, greenPool))
      .toBe('fits your G pool lean (6 G)')
    expect(buildWhy(card({ colors: 'GU' }), null, greenPool)).toBe('')
    expect(buildWhy(card({ colors: '' }), null, greenPool)).toBe('')

    expect(buildWhy(card({ colors: 'W' }), null, [
      card({ colors: 'W' }), card({ colors: 'U' }), card({ colors: 'B' })
    ])).toBe('')
  })

  it('matches whole mechanic terms, deduplicates, and requires a current-pool match', () => {
    expect(buildWhy(
      card({ name: 'Survival Delirium Eerie', type: 'Enchantment — Room' }),
      null,
      [
        card({ name: 'A Delirium' }),
        card({ name: 'First Eerie Card' }),
        card({ type: 'Enchantment — Room' }),
        card({ name: 'Second Eerie Card' }),
        card({ name: 'Survival' })
      ]
    )).toBe('+2 Eerie, +1 Room pool name/type matches')
    expect(buildWhy(
      card({ name: 'Funeral Room', type: 'Enchantment — Room' }),
      null,
      [card({ type: 'Enchantment — Room' }), card({ type: 'Enchantment — Room' })]
    )).toBe('+2 Room pool name/type match')
    expect(buildWhy(
      card({ name: 'Eeriness of the Delirious Survivalist' }),
      null,
      [card({ name: 'Eerie Delirium Survival' })]
    )).toBe('')
    expect(buildWhy(card({ name: 'Eerie Card' }), null, [card({ name: 'Ordinary' })])).toBe('')
  })

  it('does not inspect oracle text and omits every absent claim', () => {
    const top = {
      ...card({ prob: null }),
      oracleText: 'Eerie — Delirium and Survival.'
    }
    const pool = [{ ...card(), oracleText: 'Eerie and Delirium.' }]
    expect(buildWhy(top, null, pool)).toBe('')
  })
})

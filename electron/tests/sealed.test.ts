import { describe, expect, it } from 'vitest'
import { recommendSealed, arenaDeckText, isSealed } from '../shared/sealed'
import { sealedHtml } from '../renderer/overlay/sheet'
import type { CardRow } from '../shared/state'

function cards(color: string, count: number, quality: number, over: Partial<CardRow> = {}): CardRow[] {
  return Array.from({ length: count }, (_, i) => ({
    grpId: color.charCodeAt(0) * 100 + i, name: `${color} creature ${i}`, colors: color,
    colorIdentity: color, rarity: 'common', manaCost: `{2}{${color}}`, manaValue: 3,
    type: 'Creature', imageUrl: null, ev: null, prob: null, rank: null,
    percentile: quality, setPercentile: quality, grade: 'B', setGrade: 'B', ...over
  }))
}
const pool = () => [...cards('W', 18, 0.2), ...cards('U', 18, 0.2),
  ...cards('B', 13, 0.8), ...cards('G', 13, 0.85), ...cards('R', 12, 0.4)]

describe('sealed builds', () => {
  it('prefers a strong less numerous pair and provides two alternatives', () => {
    const input = pool()
    const before = JSON.stringify(input)
    const { builds } = recommendSealed(input)
    expect(builds).toHaveLength(3)
    expect(builds[0].plan.laneLabel).toBe('B/G')
    for (const { plan } of builds) {
      expect(plan.total).toBe(40)
      expect(plan.spellCount).toBe(23)
      expect(plan.basics.reduce((n, b) => n + b.count, 0)).toBe(17)
      for (const entry of plan.spells) {
        expect(entry.count).toBeLessThanOrEqual(input.filter(c => c.name === entry.name).length)
        expect(plan.statusByName[entry.name].included).toBe(entry.count)
      }
    }
    expect(JSON.stringify(input)).toBe(before)
    expect(recommendSealed([...input].reverse()).builds).toEqual(builds)
  })

  it('uses set ratings, not transient draft pool ratings', () => {
    const input = pool().map(c => ({ ...c, percentile: c.colors === 'U' ? 1 : 0 }))
    expect(recommendSealed(input).builds[0].plan.laneLabel).toBe('B/G')
  })

  it('balances an expensive spell-heavy pool with creatures and early plays', () => {
    const input = [...cards('B', 14, 0.8, { type: 'Sorcery', manaCost: '{5}{B}', manaValue: 6 }),
      ...cards('G', 20, 0.75)]
    const best = recommendSealed(input).builds[0]
    expect(best.creatures).toBeGreaterThanOrEqual(13)
    expect(best.expensive).toBeLessThanOrEqual(5)
    expect(best.plan.total).toBe(40)
  })

  it('excludes unknown cards and unsupported colorless/snow costs', () => {
    const input = [...pool(), ...cards('B', 1, 1, { name: 'Unknown', unresolved: true }),
      ...cards('B', 1, 1, { name: 'Unrated', setPercentile: null }),
      ...cards('B', 1, 1, { name: 'Needs C', manaCost: '{2}{C}' }),
      ...cards('B', 1, 1, { name: 'Needs snow', manaCost: '{S}{B}' })]
    const result = recommendSealed(input)
    expect(result.unscored).toBe(2)
    expect(result.unsupportedMana).toBe(2)
    expect(result.builds[0].plan.spells.map(c => c.name)).not.toContain('Unknown')
    expect(result.builds[0].plan.spells.map(c => c.name)).not.toContain('Needs C')
    expect(sealedHtml(result)).toContain('Excluded: 2')
  })

  it('supports hybrid and devoid casting costs and preserves duplicates', () => {
    const result = recommendSealed([...pool(),
      ...cards('U', 2, 1, { name: 'Hybrid', colors: 'UG', manaCost: '{U/G}' }),
      ...cards('B', 1, 1, { name: 'Devoid', colors: '', manaCost: '{2}{B}' })])
    const plan = result.builds[0].plan
    expect(plan.laneLabel).toBe('B/G')
    expect(plan.spells.find(c => c.name === 'Hybrid')?.count).toBe(2)
    expect(plan.spells.some(c => c.name === 'Devoid')).toBe(true)
    expect(arenaDeckText(plan)).toContain('2 Hybrid')
  })

  it('counts a spell/land MDFC as a spell, without inventing land sources', () => {
    const result = recommendSealed([...pool(), ...cards('G', 1, 1, {
      name: 'Front // Back', type: 'Creature // Land', manaCost: '{2}{G}',
      faces: [{ name: 'Front', type: 'Creature', manaCost: '{2}{G}', oracleText: '' },
        { name: 'Back', type: 'Land', manaCost: '', oracleText: '' }]
    })])
    expect(result.builds[0].plan.spells.some(c => c.name === 'Front // Back')).toBe(true)
    expect(result.builds[0].plan.nonbasicLands).toEqual([])
  })

  it('never exports an incomplete deck or invents missing spells', () => {
    const result = recommendSealed(cards('G', 5, 0.9))
    expect(result.builds[0].plan.short).toBe(true)
    expect(result.builds[0].plan.total).toBe(22)
    expect(arenaDeckText(result.builds[0].plan)).toBe('')
    expect(sealedHtml(result)).toContain('data-sealed-copy disabled')
    expect(recommendSealed([]).builds).toEqual([])
    expect(recommendSealed(cards('G', 20, 1, { setPercentile: null })).builds).toEqual([])
  })

  it('exports forty cards with no pool cuts or annotations', () => {
    const text = arenaDeckText(recommendSealed(pool()).builds[0].plan)
    expect(text.startsWith('Deck\n')).toBe(true)
    expect(text.trim().split('\n').slice(1).reduce((n, line) => n + Number(line.split(' ')[0]), 0)).toBe(40)
    expect(text).not.toContain('W creature')
    expect(text).toContain('Forest')
    expect(isSealed('ArenaDirect', 'ArenaDirect_FRA_Sealed_20260929')).toBe(true)
    expect(isSealed('PremierDraft')).toBe(false)
  })
})

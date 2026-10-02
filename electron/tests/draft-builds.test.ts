import { describe, expect, it } from 'vitest'
import { recommendDraftBuilds, draftManaPenalty, draftManaBase, landSources } from '../shared/draft-builds'
import { arenaDeckText } from '../shared/sealed'
import type { CardRow } from '../shared/state'
function cards(color: string, count: number, quality = .8, over: Partial<CardRow> = {}): CardRow[] {
  return Array.from({ length: count }, (_, i) => ({ grpId: color.charCodeAt(0) * 100 + i,
    name: `${color} ${i}`, colors: color, colorIdentity: color, rarity: 'common',
    manaCost: `{2}{${color}}`, manaValue: 3, type: 'Creature', imageUrl: null,
    ev: null, prob: null, rank: null, percentile: quality, setPercentile: quality,
    grade: 'B', setGrade: 'B', ...over }))
}
describe('draft builds across color counts', () => {
  it('compares every feasible color count, preserving pool copies and 40-card totals', () => {
    const pool = [...cards('U', 8), ...cards('B', 8), ...cards('R', 8), ...cards('G', 8)]
    const before = JSON.stringify(pool)
    const result = recommendDraftBuilds(pool)
    expect(result.builds.map(b => b.plan.lane.length).sort()).toEqual([1, 2, 3, 4])
    const four = result.builds.find(b => b.plan.lane.length === 4)!.plan
    expect(four.lane).toEqual(['U', 'B', 'R', 'G'])
    expect(four.total).toBe(40)
    for (const b of result.builds) for (const s of b.plan.spells) {
      expect(s.count).toBeLessThanOrEqual(pool.filter(c => c.name === s.name).length)
    }
    expect(JSON.stringify(pool)).toBe(before)
    expect(arenaDeckText(result.builds.find(b => b.plan.short)!.plan)).toBe('')
  })
  it('prefers a castable pair over a marginal third color without fixing', () => {
    const result = recommendDraftBuilds([...cards('B', 14), ...cards('G', 14), ...cards('U', 8, .81)])
    expect(result.builds[0].plan.lane.length).toBe(2)
    expect(result.builds[0].plan.laneLabel).toBe('B/G')
  })
  it('counts dual land production rather than ability color identity', () => {
    const dual = cards('U', 1, .8, { name: 'Dual', type: 'Land', manaCost: '', colorIdentity: 'UB', oracleText: '{T}: Add {U} or {B}.' })[0]
    expect(landSources(dual)).toEqual(['U', 'B'])
    expect(landSources({ ...dual, oracleText: '{T}: Add {C}. {B}: Target creature gets -1/-1.' })).toEqual([])
    const spells = cards('B', 8)
    expect(draftManaPenalty(spells, [{ color: 'B', count: 5 }], [dual])).toBeLessThan(draftManaPenalty(spells, [{ color: 'B', count: 5 }], []))
    const plan = recommendDraftBuilds([...cards('U', 14), ...cards('B', 14), dual]).builds[0].plan
    expect(plan.nonbasicLands.some(c => c.name === 'Dual')).toBe(true)
    expect(plan.landCount).toBe(17)
    expect(plan.total).toBe(40)
  })
  it('excludes unsupported mana and unknown metadata from exported decks', () => {
    const result = recommendDraftBuilds([...cards('G', 24), ...cards('G', 1, 1, { name: 'Unknown', unresolved: true }), ...cards('G', 1, 1, { name: 'Colorless requirement', manaCost: '{2}{C}' })])
    expect(result.unscored).toBe(1)
    expect(result.unsupportedMana).toBe(1)
    expect(arenaDeckText(result.builds[0].plan)).not.toContain('Unknown')
    expect(arenaDeckText(result.builds[0].plan)).not.toContain('Colorless requirement')
  })
  it('does not count hybrid alternatives as additional deck colors', () => {
    const result = recommendDraftBuilds([
      ...cards('R', 14), ...cards('G', 14),
      ...cards('U', 2, .9, { name: "Tam's Resistance", manaCost: '{1}{G/U}' })
    ])
    expect(result.builds.every(b => b.plan.lane.length <= 2)).toBe(true)
    expect(result.builds.find(b => b.plan.laneLabel === 'R/G')?.plan.spells.some(c => c.name === "Tam's Resistance")).toBe(true)
  })
  it('credits each dual once when paying hybrid costs', () => {
    const dual = cards('G', 1, .8, { type: 'Land', manaCost: '', oracleText: '{T}: Add {G} or {U}.' })[0]
    const hybrid = cards('G', 1, .8, { manaCost: '{1}{G/U}' })
    expect(draftManaPenalty(hybrid, [{ color: 'G', count: 3 }], [dual])).toBeCloseTo(.4)
    expect(draftManaPenalty(hybrid, [{ color: 'G', count: 8 }], [])).toBe(0)
  })
  it('allocates basics using existing nonbasic sources', () => {
    const spells = [...cards('R', 12), ...cards('G', 11)]
    const lands = cards('G', 4, .8, { type: 'Land', manaCost: '', oracleText: '{T}: Add {G}.' })
    const mana = draftManaBase(spells, ['R', 'G'], lands)
    expect(mana.basics).toEqual([{ color: 'R', count: 9 }, { color: 'G', count: 4 }])
    expect(mana.penalty).toBe(0)
    expect(draftManaPenalty(spells, mana.basics, lands)).toBe(mana.penalty)
  })
  it('includes chosen-color lands as a single source and preserves seventeen lands', () => {
    const room = cards('G', 1, .8, { name: 'Room of Refuge', type: 'Land', manaCost: '',
      oracleText: 'This land enters tapped. As it enters, choose a color.\n{T}: Add one mana of the chosen color.' })[0]
    expect(landSources(room)).toEqual(['W', 'U', 'B', 'R', 'G'])
    const spells = [...cards('R', 12), ...cards('G', 11)]
    expect(draftManaPenalty([cards('R', 1)[0], cards('G', 1)[0]], [], [room])).toBeCloseTo(1.5)
    const mana = draftManaBase(spells, ['R', 'G'], [room])
    expect(mana.chosenColors).toEqual([{ name: 'Room of Refuge', color: 'R' }])
    expect(mana.basics.reduce((sum, b) => sum + b.count, 0)).toBe(16)
    const plan = recommendDraftBuilds([...spells, room]).builds[0].plan
    expect(plan.nonbasicLands.some(c => c.name === room.name)).toBe(true)
    expect(plan.basics.reduce((sum, b) => sum + b.count, 0) + plan.nonbasicLands.reduce((sum, l) => sum + l.count, 0)).toBe(17)
    expect(plan.total).toBe(40)
  })
  it('keeps enough individual sources to pay mandatory repeated pips', () => {
    const spells = [...cards('G', 22), ...cards('B', 1, .8, { manaCost: '{4}{B}{B}', manaValue: 6 })]
    const mana = draftManaBase(spells, ['B', 'G'], [])
    expect(mana.basics.find(b => b.color === 'B')!.count).toBeGreaterThanOrEqual(2)
  })
  it.each(['{3}{W}{W}{B}{B}', '{3}{W}{W/B}{B}{B}'])('uses distinct lands for simultaneous colored pips in %s', manaCost => {
    const spells = [...cards('G', 8), ...cards('R', 7), ...cards('U', 7),
      ...cards('W', 1, .8, { manaCost, manaValue: 7 })]
    const dual = cards('W', 1, .8, { type: 'Land', manaCost: '', oracleText: '{T}: Add {W} or {B}.' })[0]
    const mana = draftManaBase(spells, ['W', 'U', 'B', 'R', 'G'], [dual])
    const white = mana.basics.find(b => b.color === 'W')?.count ?? 0
    const black = mana.basics.find(b => b.color === 'B')?.count ?? 0
    expect(white + black + 1).toBeGreaterThanOrEqual(4)
    expect(white + 1).toBeGreaterThanOrEqual(manaCost.includes('{W/B}') ? 1 : 2)
    expect(black + 1).toBeGreaterThanOrEqual(2)
    expect(mana.basics.reduce((sum, b) => sum + b.count, 0) + 1).toBe(17)
  })
  it('does not show unknown or uncastable cards as close cuts', () => {
    const result = recommendDraftBuilds([...cards('G', 23),
      ...cards('G', 1, 1, { name: 'Unknown', unresolved: true }),
      ...cards('G', 1, 1, { name: 'Colorless requirement', manaCost: '{2}{C}' })])
    expect(result.builds[0].plan.close).toEqual([])
    expect(result.builds[0].plan.statusByName.Unknown.close).toBe(false)
  })

})

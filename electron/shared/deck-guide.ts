import type { CardRow } from './state'
import type { DeckPlan, DeckEntry } from './deck-plan'
import { BASIC_LAND_NAMES, BASIC_LAND_COLOR, POOL_COLORS, isLand, titleKey } from './cards'

export type DeckCounts = Record<string, number>
export interface GuideRow extends DeckEntry { current: number; target: number; remaining: number; colors: string; manaValue: number | null; land: boolean }
export interface DeckGuide { add: GuideRow[]; cut: GuideRow[]; done: GuideRow[]; total: number; target: number }

/** Pool browsing order: WUBRG, multicolor, colorless, then lands; cost/title within each group. */
function group(row: GuideRow): number {
  if (row.land) return 8
  const colors = POOL_COLORS.filter(c => row.colors.includes(c))
  return colors.length === 1 ? POOL_COLORS.indexOf(colors[0]) : colors.length > 1 ? 5 : 6
}
export function guideOrder(a: GuideRow, b: GuideRow): number {
  return group(a) - group(b) || (a.land && b.land ? POOL_COLORS.indexOf(BASIC_LAND_COLOR[a.name]) - POOL_COLORS.indexOf(BASIC_LAND_COLOR[b.name]) : 0) || (a.manaValue ?? 0) - (b.manaValue ?? 0) || titleKey(a.name).localeCompare(titleKey(b.name))
}
export function poolCounts(pool: readonly CardRow[]): DeckCounts {
  const counts: DeckCounts = {}
  for (const card of pool) counts[card.name] = (counts[card.name] ?? 0) + 1
  return counts
}
export function deckGuide(plan: DeckPlan, pool: readonly CardRow[], counts: DeckCounts): DeckGuide {
  const metadata = new Map(pool.map(card => [card.name, card]))
  const desired = new Map([...plan.spells, ...plan.nonbasicLands,
    ...plan.basics.map(b => ({ name: BASIC_LAND_NAMES[b.color], count: b.count, manaCost: '', grade: null, percentile: null }))].map(e => [e.name, e]))
  const rows: GuideRow[] = []
  for (const name of new Set([...desired.keys(), ...Object.keys(counts)])) {
    const entry = desired.get(name), card = metadata.get(name)
    const current = Math.max(0, Math.floor(counts[name] ?? 0)), target = entry?.count ?? 0
    if (!current && !target) continue
    rows.push({ name, count: target, manaCost: entry?.manaCost ?? card?.manaCost ?? '', grade: entry?.grade ?? card?.setGrade ?? null,
      percentile: entry?.percentile ?? null, current, target, remaining: Math.abs(target - current),
      colors: card?.colors ?? '', manaValue: card?.manaValue ?? null, land: !card || isLand(card) })
  }
  rows.sort(guideOrder)
  return { add: rows.filter(r => r.current < r.target), cut: rows.filter(r => r.current > r.target), done: rows.filter(r => r.current === r.target),
    total: rows.reduce((n, r) => n + r.current, 0), target: plan.total }
}

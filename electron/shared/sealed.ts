/** Sealed uses Premier Draft P1P1 ratings, not a learned deck/win-rate score.
 * Compare all ten pairs with explicit creature/curve penalties. Never feed a
 * 90-card sealed pool to the draft model as an invented draft position.
 */
import type { CardRow } from './state'
import { POOL_COLORS, isLand, type PoolColor } from './cards'
import { buildDeck, BASIC_LAND_NAMES, TARGET_SPELLS, type DeckPlan } from './deck-plan'

export function isSealed(format: string | null, eventName: string | null = null): boolean {
  return /sealed/i.test(`${format ?? ''} ${eventName ?? ''}`)
}

export interface SealedBuild {
  plan: DeckPlan
  creatures: number
  early: number
  expensive: number
  /** Internal heuristic only; not a probability or model output. */
  score: number
}
export interface SealedRecommendation {
  builds: SealedBuild[]
  unscored: number
  unsupportedMana: number
}

// Use the castable front face for modal double-faced cards. No credit for a
// back-face land: this first version uses seventeen ordinary basics.
function front(card: CardRow): CardRow {
  const face = card.faces?.[0]
  return { ...card, type: face?.type ?? card.type.split(' // ')[0],
    manaCost: face?.manaCost ?? card.manaCost.split(' // ')[0],
    manaValue: face ? [...face.manaCost.matchAll(/\{([^}]+)\}/g)].reduce((n, m) => n + (/^\d+$/.test(m[1]) ? Number(m[1]) : m[1] === 'X' ? 0 : m[1].startsWith('2/') ? 2 : 1), 0) : card.manaValue,
    percentile: card.setPercentile, grade: card.setGrade }
}

function castable(card: CardRow, lane: PoolColor[]): boolean {
  if (card.unresolved || !card.type || /\{[CS]\}/.test(card.manaCost)) return false
  const symbols = [...card.manaCost.matchAll(/\{([^}]+)\}/g)].map(m => m[1])
  // Printed cost handles hybrid and devoid; printed colors alone do not.
  if (symbols.length) return symbols.every(symbol => {
    const colors = POOL_COLORS.filter(c => symbol.includes(c))
    if (!colors.length) return true
    if (symbol.includes('/')) return colors.some(c => lane.includes(c)) || symbol.includes('2/')
    return colors.every(c => lane.includes(c))
  })
  return false // Missing or absent casting cost is not a free, castable spell.
}

function facts(cards: CardRow[]) {
  return {
    creatures: cards.filter(c => /\bCreature\b/.test(c.type)).length,
    early: cards.filter(c => c.manaValue !== null && c.manaValue <= 3).length,
    expensive: cards.filter(c => c.manaValue !== null && c.manaValue >= 5).length
  }
}

function value(cards: CardRow[]): number {
  const { creatures, early, expensive } = facts(cards)
  return cards.reduce((sum, c) => sum + (c.percentile ?? 0), 0)
    - Math.max(0, TARGET_SPELLS - cards.length) * 2
    - Math.max(0, 13 - creatures) * 0.18
    - Math.max(0, creatures - 18) * 0.08
    - Math.max(0, 6 - early) * 0.18
    - Math.max(0, expensive - 5) * 0.18
}

/** Deterministic best-improving swaps; preserves each physical pool copy. */
function select(available: CardRow[]): CardRow[] {
  const chosen = available.slice(0, TARGET_SPELLS)
  const rest = available.slice(TARGET_SPELLS)
  for (let step = 0; step < TARGET_SPELLS; step++) {
    let best = value(chosen), from = -1, to = -1
    for (let i = 0; i < chosen.length; i++) {
      for (let j = 0; j < rest.length; j++) {
        const next = [...chosen]; next[i] = rest[j]
        const score = value(next)
        if (score > best + 1e-8) { best = score; from = i; to = j }
      }
    }
    if (from < 0) break
    ;[chosen[from], rest[to]] = [rest[to], chosen[from]]
  }
  return chosen.sort((a, b) => b.percentile! - a.percentile! || a.name.localeCompare(b.name))
}

export function recommendSealed(pool: ReadonlyArray<CardRow>): SealedRecommendation {
  const cards = pool.map(front)
  const spells = cards.filter(c => !isLand(c))
  const rated = spells.filter(c => !c.unresolved && c.type && c.manaValue !== null &&
    c.setPercentile !== null && Number.isFinite(c.setPercentile))
  const unscored = spells.length - rated.length
  const unsupportedMana = rated.filter(c => !POOL_COLORS.some(a =>
    POOL_COLORS.some(b => castable(c, [a, b])))).length
  const builds: SealedBuild[] = []
  for (let i = 0; i < POOL_COLORS.length; i++) {
    for (let j = i + 1; j < POOL_COLORS.length; j++) {
      const lane = [POOL_COLORS[i], POOL_COLORS[j]]
      const available = rated.filter(c => castable(c, lane))
        .sort((a, b) => b.percentile! - a.percentile! || a.name.localeCompare(b.name))
      if (!available.length) continue
      const chosen = select(available)
      // Normalize color membership for hybrid/devoid cards so the common
      // deck-plan helper's playable count and closest cuts match this lane.
      const normalized = cards.map(c => ({ ...c, colors: available.includes(c)
        ? lane.filter(color => c.manaCost.includes(color)).join('') : c.colors }))
      const selected = chosen.map(c => normalized[cards.indexOf(c)])
      const plan = buildDeck(normalized, { lane, spells: selected, nonbasicLands: [] })
      plan.playable = available.length
      const selectedNames = new Set(chosen.map(c => c.name))
      const close = available.filter(c => !selectedNames.has(c.name)).slice(0, 3)
      plan.close = close.map(c => ({ name: c.name, count: 1, manaCost: c.manaCost,
        grade: c.grade, percentile: c.percentile }))
      for (const status of Object.values(plan.statusByName)) status.close = false
      for (const card of close) plan.statusByName[card.name].close = true
      builds.push({ plan, ...facts(chosen), score: value(chosen) })
    }
  }
  builds.sort((a, b) => Number(a.plan.short) - Number(b.plan.short) || b.score - a.score || a.plan.laneLabel.localeCompare(b.plan.laneLabel))
  const seen = new Set<string>()
  return { unscored, unsupportedMana, builds: builds.filter(b => {
    const key = JSON.stringify([b.plan.spells, b.plan.basics])
    if (seen.has(key)) return false
    seen.add(key); return true
  }).slice(0, 3) }
}

/** Name/count format accepted by Arena's deck importer. */
export function arenaDeckText(plan: DeckPlan): string {
  if (plan.short || plan.total !== 40) return ''
  const lines = [...plan.spells, ...plan.nonbasicLands,
    ...plan.basics.map(b => ({ count: b.count, name: BASIC_LAND_NAMES[b.color] }))]
  return `Deck\n${lines.map(c => `${c.count} ${c.name.replace(/[\r\n]/g, ' ')}`).join('\n')}\n`
}

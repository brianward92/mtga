/** Compare draft builds across all color counts with explicit mana-source costs. */
import type { CardRow } from './state'
import { POOL_COLORS, isLand, isBasicLand, type PoolColor } from './cards'
import { buildDeck, TARGET_LANDS, TARGET_SPELLS } from './deck-plan'
import { front, castable, facts, value, select, type SealedBuild, type SealedRecommendation } from './sealed'

/** Potential printed mana production; a chosen-color land must choose just one. */
export function landSources(card: CardRow): PoolColor[] {
  if (!isLand(card)) return []
  const text = card.oracleText ?? ''
  const clauses = text.match(/Add [^.\n]+/gi) ?? []
  if (clauses.some(c => /mana of any color/i.test(c)) || choosesOneColor(card)) return [...POOL_COLORS]
  const types = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest']
  return POOL_COLORS.filter((color, i) => clauses.some(c => c.includes(`{${color}}`)) ||
    new RegExp(`\\b${types[i]}\\b`).test(card.type))
}

function choosesOneColor(card: CardRow): boolean {
  return /choose a color/i.test(card.oracleText ?? '') && /Add [^.\n]*(?:chosen|that) color/i.test(card.oracleText ?? '')
}

const colorMask = (colors: ReadonlyArray<PoolColor>): number => colors.reduce((mask, c) => mask | (1 << POOL_COLORS.indexOf(c)), 0)

/** Source requirements are a deck-building heuristic, not casting probabilities. */
function manaEvaluation(spells: CardRow[], lands: CardRow[]) {
  const requirements: Array<{ mask: number; desired: number }> = []
  const minimums = new Map<number, number>()
  for (const card of spells) {
    const groups = new Map<number, number>()
    for (const [, symbol] of card.manaCost.matchAll(/\{([^}]+)\}/g)) {
      // Phyrexian and two-brid symbols have noncolored payment options.
      if (symbol.includes('/P') || symbol.includes('2/')) continue
      const mask = colorMask(POOL_COLORS.filter(c => symbol.includes(c)))
      if (mask) groups.set(mask, (groups.get(mask) ?? 0) + 1)
    }
    for (const [mask, pips] of groups) {
      const early = (card.manaValue ?? 5) <= 3
      requirements.push({ mask, desired: pips >= 2 ? (early ? 10 : 8) : (early ? 8 : 5) })
    }
    // Hall's condition: for every color subset, pips restricted to those colors
    // need that many distinct lands. A WB dual cannot pay both W and B at once.
    for (let mask = 1; mask < 32; mask++) {
      let pips = 0
      for (const [allowed, count] of groups) if ((allowed & mask) === allowed) pips += count
      if (pips) minimums.set(mask, Math.max(minimums.get(mask) ?? 0, pips))
    }
  }
  const fixed = lands.filter(l => !choosesOneColor(l)).map(l => colorMask(landSources(l)))
  const jointMinimums = [...minimums].map(([mask, minimum]) => ({ mask, minimum, fromLands: fixed.filter(source => source & mask).length }))
  const required = requirements.map(r => ({ ...r, fromLands: fixed.filter(mask => mask & r.mask).length }))
  return {
    fixed,
    choices: lands.filter(choosesOneColor),
    meetsMinimums(counts: number[]): boolean {
      return jointMinimums.every(r => counts.reduce((n, count, i) => n + (r.mask & (1 << i) ? count : 0), r.fromLands) >= r.minimum)
    },
    penalty(counts: number[]): number {
      return required.reduce((sum, r) => {
        const sources = counts.reduce((n, count, i) => n + (r.mask & (1 << i) ? count : 0), r.fromLands)
        return sum + Math.max(0, r.desired - sources) * 0.10
      }, 0)
    }
  }
}

function distributions(slots: number, lane: ReadonlyArray<PoolColor>, visit: (counts: number[]) => void): void {
  const counts = POOL_COLORS.map(() => 0)
  function assign(index: number, left: number): void {
    const colorIndex = POOL_COLORS.indexOf(lane[index])
    if (index === lane.length - 1) { counts[colorIndex] = left; visit(counts); return }
    for (let n = 0; n <= left; n++) { counts[colorIndex] = n; assign(index + 1, left - n) }
  }
  if (lane.length) assign(0, slots)
}

export function draftManaPenalty(spells: CardRow[], basics: Array<{ color: PoolColor; count: number }>, lands: CardRow[]): number {
  const evaluation = manaEvaluation(spells, lands)
  const counts = POOL_COLORS.map(c => basics.filter(b => b.color === c).reduce((n, b) => n + b.count, 0))
  let best = Infinity
  // Room of Refuge is one chosen color, never five simultaneous sources.
  distributions(evaluation.choices.length, POOL_COLORS, extra => {
    best = Math.min(best, evaluation.penalty(counts.map((count, i) => count + extra[i])))
  })
  return best
}

/** Allocate basics after crediting duals and hybrid payment alternatives. */
export function draftManaBase(spells: CardRow[], lane: PoolColor[], lands: CardRow[]) {
  const evaluation = manaEvaluation(spells, lands)
  const slots = TARGET_LANDS - lands.length + evaluation.choices.length
  const weight = POOL_COLORS.map(() => 0)
  for (const card of spells) for (const [, symbol] of card.manaCost.matchAll(/\{([^}]+)\}/g)) {
    if (symbol.includes('/P') || symbol.includes('2/')) continue
    const colors = lane.filter(c => symbol.includes(c))
    for (const c of colors) weight[POOL_COLORS.indexOf(c)] += 1 / colors.length
  }
  const totalWeight = weight.reduce((sum, n) => sum + n, 0)
  const fixedCounts = POOL_COLORS.map((color, i) => lane.includes(color) ? evaluation.fixed.filter(mask => mask & (1 << i)).length : 0)
  const totalSources = slots + fixedCounts.reduce((sum, n) => sum + n, 0)
  let best = Infinity, balance = Infinity, meetsMinimums = false, chosen = POOL_COLORS.map(() => 0)
  distributions(slots, lane, counts => {
    const feasible = evaluation.meetsMinimums(counts)
    if (meetsMinimums && !feasible) return
    const penalty = evaluation.penalty(counts)
    const distance = counts.reduce((sum, n, i) => sum + Math.pow(n + fixedCounts[i] -
      (totalWeight ? weight[i] / totalWeight * totalSources : (lane.includes(POOL_COLORS[i]) ? totalSources / lane.length : 0)), 2), 0)
    if ((feasible && !meetsMinimums) || penalty < best - 1e-8 || (Math.abs(penalty - best) < 1e-8 && distance < balance - 1e-8)) {
      best = penalty; balance = distance; meetsMinimums = feasible; chosen = [...counts]
    }
  })
  const chosenColors = evaluation.choices.map(card => {
    const index = chosen.reduce((best, count, i) => count > chosen[best] ? i : best, 0)
    chosen[index]--
    return { name: card.name, color: POOL_COLORS[index] }
  })
  return { basics: POOL_COLORS.map((color, i) => ({ color, count: chosen[i] })).filter(b => b.count > 0), chosenColors, penalty: best }
}

export function recommendDraftBuilds(pool: ReadonlyArray<CardRow>): SealedRecommendation {
  const cards = pool.map(c => front({ ...c, setPercentile: c.percentile ?? c.setPercentile, setGrade: c.grade ?? c.setGrade }))
  const spells = cards.filter(c => !isLand(c))
  const rated = spells.filter(c => !c.unresolved && c.type && c.manaValue !== null && c.percentile !== null && Number.isFinite(c.percentile))
  const unsupportedMana = rated.filter(c => !castable(c, [...POOL_COLORS])).length
  const builds: SealedBuild[] = []
  for (let mask = 1; mask < 32; mask++) {
    const lane = POOL_COLORS.filter((_, i) => mask & (1 << i))
    const available = rated.filter(c => castable(c, lane)).sort((a, b) => b.percentile! - a.percentile! || a.name.localeCompare(b.name))
    if (!available.length) continue
    const chosen = select(available)
    // Each N-color comparison must actually select a spell of every named color.
    for (const color of lane) {
      const without = lane.filter(c => c !== color)
      if (chosen.some(c => !castable(c, without))) continue
      const candidate = available.find(c => !chosen.includes(c) && !castable(c, without))
      if (!candidate) continue
      if (chosen.length < TARGET_SPELLS) { chosen.push(candidate); continue }
      const index = chosen.map((c, i) => ({ c, i })).reverse().find(({ c, i }) => lane.every(other =>
        castable(c, lane.filter(color => color !== other)) || chosen.some((remaining, j) => j !== i && !castable(remaining, lane.filter(color => color !== other)))))?.i ?? -1
      if (index >= 0) chosen[index] = candidate
    }
    // Do not advertise a color count that the chosen spells do not actually use.
    if (lane.some(color => chosen.every(c => castable(c, lane.filter(other => other !== color))))) continue
    const lands = cards.filter(c => isLand(c) && !isBasicLand(c) && !c.unresolved &&
      landSources(c).some(color => lane.includes(color)))
      .sort((a, b) => Math.min(choosesOneColor(b) ? 1 : 5, landSources(b).filter(c => lane.includes(c)).length) -
        Math.min(choosesOneColor(a) ? 1 : 5, landSources(a).filter(c => lane.includes(c)).length) || a.name.localeCompare(b.name))
      .slice(0, Math.min(6, TARGET_LANDS))
    const normalized = cards.map(c => ({ ...c, colors: available.includes(c) ? lane.filter(color => c.manaCost.includes(color)).join('') : c.colors }))
    const plan = buildDeck(normalized, { lane, spells: chosen.map(c => normalized[cards.indexOf(c)]), nonbasicLands: lands.map(c => normalized[cards.indexOf(c)]) })
    plan.playable = available.length
    const mana = draftManaBase(chosen, lane, lands)
    plan.basics = mana.basics
    const selectedNames = new Set(chosen.map(c => c.name))
    const close = available.filter(c => !selectedNames.has(c.name)).slice(0, 3)
    plan.close = close.map(c => ({ name: c.name, count: 1, manaCost: c.manaCost, grade: c.grade, percentile: c.percentile }))
    for (const status of Object.values(plan.statusByName)) status.close = false
    for (const card of close) plan.statusByName[card.name].close = true
    const penalty = mana.penalty
    builds.push({ plan, ...facts(chosen), score: value(chosen) - penalty })
  }
  builds.sort((a, b) => Number(a.plan.short) - Number(b.plan.short) || b.score - a.score || a.plan.lane.length - b.plan.lane.length || a.plan.laneLabel.localeCompare(b.plan.laneLabel))
  // Preserve the strongest candidate for each N, rather than three similar pairs.
  const counts = new Set<number>()
  return { unscored: spells.length - rated.length, unsupportedMana, builds: builds.filter(b => {
    if (counts.has(b.plan.lane.length)) return false
    counts.add(b.plan.lane.length); return true
  }) }
}

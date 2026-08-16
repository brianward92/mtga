/**
 * HUD view-model helpers (pure logic — unit tested).
 *
 * Everything the HUD shows that is more than a field lookup: pool colour
 * summary + lane lean, the recommendation "why" line, pick progress, the
 * agreement rate and the end-of-draft summary, model naming, corner cycling.
 */
import type { CardRow, DraftState, PickRecord } from '../../shared/state'
import { bandConviction, dominanceFromEvs, formatDominancePct, type Conviction } from './conviction'
import { formatWinRate } from './shared'
import { rankOrder } from './chips'
import type { HudCorner } from './types'

export const POOL_COLORS = ['W', 'U', 'B', 'R', 'G'] as const
export type PoolColor = (typeof POOL_COLORS)[number]

export const COLOR_NAMES: Readonly<Record<PoolColor | 'C', string>> = {
  W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green', C: 'Colorless'
}

export interface PoolSummary {
  /** Colour pips per colour (multicolour cards count once per colour). */
  counts: Record<PoolColor, number>
  /** Non-land cards with no colour. */
  colorless: number
  /** Non-land cards in the pool. */
  cards: number
  /** Land cards in the pool. */
  lands: number
}

function isLand(card: Pick<CardRow, 'type'>): boolean {
  return /\bland\b/i.test(card.type || '')
}

/** Colour distribution of the pool (lands excluded — they don't reveal a lane). */
export function poolSummary(pool: ReadonlyArray<Pick<CardRow, 'colors' | 'type'>>): PoolSummary {
  const counts: Record<PoolColor, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 }
  let colorless = 0
  let cards = 0
  let lands = 0
  for (const card of pool) {
    if (isLand(card)) { lands++; continue }
    cards++
    const letters = new Set((card.colors || '').toUpperCase().split('').filter((c): c is PoolColor => c in counts))
    if (letters.size === 0) { colorless++; continue }
    for (const c of letters) counts[c]++
  }
  return { counts, colorless, cards, lands }
}

export interface LaneLean {
  colors: PoolColor[]
  /** 'W/U' or 'G' */
  label: string
  /** Share of colour pips the lane owns (0..1). */
  share: number
}

/**
 * Lane lean: the two colours that dominate the pool's colour pips, or a lone
 * dominant colour. Null while the pool is too small (< 4 coloured pips) or
 * the colours are still spread. Two colours "dominate" when they own at
 * least 60% of the pips and the second colour clearly beats the third; one
 * colour dominates when it owns at least half and doubles the runner-up.
 */
export function laneLean(summary: PoolSummary): LaneLean | null {
  const entries = (Object.entries(summary.counts) as Array<[PoolColor, number]>).sort((a, b) => b[1] - a[1])
  const total = entries.reduce((s, [, n]) => s + n, 0)
  if (total < 4) return null
  const [a, b, c] = entries
  if (b[1] > 0 && (a[1] + b[1]) / total >= 0.6 && b[1] > c[1]) {
    return { colors: [a[0], b[0]], label: `${a[0]}/${b[0]}`, share: (a[1] + b[1]) / total }
  }
  if (a[1] / total >= 0.5 && a[1] >= 2 * b[1]) {
    return { colors: [a[0]], label: a[0], share: a[1] / total }
  }
  return null
}

/** Cards in the pack ordered by the model (state order → ranked). */
export function rankedCards(cards: ReadonlyArray<CardRow>): CardRow[] {
  return rankOrder(cards).map(i => cards[i])
}

/** Conviction band for the pack (null before scores / with <2 scored cards). */
export function packConviction(cards: ReadonlyArray<CardRow>): Conviction | null {
  const dominance = dominanceFromEvs(cards.map(c => c.ev))
  if (dominance === null) return null
  const top = rankedCards(cards)[0]
  if (!top || top.ev === null) return null
  return bandConviction(dominance, top.percentile)
}

/**
 * The recommendation's one-line "why": head-to-head % over the runner-up,
 * plus the raw set grade when it differs. Empty when nothing is known.
 */
export function whyLine(top: CardRow, runnerUp: CardRow | null, conviction: Conviction | null): string {
  const parts: string[] = []
  if (conviction && runnerUp) {
    parts.push(`${formatDominancePct(conviction.dominance)} over #2`)
  }
  if (top.setGrade && top.grade && top.setGrade !== top.grade) parts.push(`set ${top.setGrade}`)
  return parts.join(' · ')
}

/** Detail line for a hovered card: rank, raw set grade, probability and EV. */
export function detailLine(card: CardRow): string {
  const parts: string[] = []
  if (card.rank !== null) parts.push(`#${card.rank}`)
  if (card.setGrade && card.grade && card.setGrade !== card.grade) parts.push(`set ${card.setGrade}`)
  if (card.prob !== null && Number.isFinite(card.prob)) parts.push(`p ${Math.round(card.prob * 100)}%`)
  if (card.ev !== null && Number.isFinite(card.ev)) parts.push(`ev ${card.ev >= 0 ? '+' : ''}${card.ev.toFixed(2)}`)
  return parts.join(' · ')
}

/** "P2P7" (empty between packs). */
export function pickPosition(state: Pick<DraftState, 'pack' | 'pick'>): string {
  return state.pack !== null && state.pick !== null ? `P${state.pack}P${state.pick}` : ''
}

/** Progress dots for the current pack: 'done' | 'current' | 'todo' per pick. */
export function progressDots(state: Pick<DraftState, 'pick' | 'picksPerPack'>): Array<'done' | 'current' | 'todo'> {
  const n = Math.max(1, Math.min(20, state.picksPerPack || 14))
  const pick = state.pick ?? 0
  return Array.from({ length: n }, (_, i) => (i + 1 < pick ? 'done' : i + 1 === pick ? 'current' : 'todo'))
}

/** "SOS · Premier Draft" — format's trailing "Draft" gets a space. */
export function eventTitle(state: Pick<DraftState, 'set' | 'format'>): string {
  const set = state.set ?? '?'
  const format = state.format ? state.format.replace(/([a-z])Draft$/, '$1 Draft').trim() : 'Draft'
  return `${set} · ${format}`
}

export interface Agreement {
  agreed: number
  scored: number
  /** 0..1, null when nothing was scored. */
  rate: number | null
}

/** Picks that matched the model's #1 out of the picks the model had scored. */
export function agreement(picks: ReadonlyArray<PickRecord>): Agreement {
  const scored = picks.filter(p => p.takenRank !== null)
  const agreed = scored.filter(p => p.takenRank === 1)
  return { agreed: agreed.length, scored: scored.length, rate: scored.length ? agreed.length / scored.length : null }
}

/** The pool's strongest card by set-relative percentile (null when unknown). */
export function bestPick(pool: ReadonlyArray<CardRow>): CardRow | null {
  let best: CardRow | null = null
  for (const card of pool) {
    if (card.percentile === null || !Number.isFinite(card.percentile)) continue
    if (!best || (card.percentile > (best.percentile ?? -1))) best = card
  }
  return best
}

export const HUD_CORNERS: readonly HudCorner[] = ['tl', 'tr', 'br', 'bl']

/** tl → tr → br → bl → tl */
export function nextCorner(corner: HudCorner): HudCorner {
  const i = HUD_CORNERS.indexOf(corner)
  return HUD_CORNERS[(i + 1) % HUD_CORNERS.length]
}

/** Which side the sheet slides in from for a HUD corner. */
export function sheetSide(corner: HudCorner): 'left' | 'right' {
  return corner === 'tl' || corner === 'bl' ? 'left' : 'right'
}

/** Group order for the pool sheet: WUBRG, multicolour, colourless, lands. */
export type PoolGroup = PoolColor | 'M' | 'C' | 'L'
export const POOL_GROUP_ORDER: readonly PoolGroup[] = ['W', 'U', 'B', 'R', 'G', 'M', 'C', 'L']
export const POOL_GROUP_NAMES: Readonly<Record<PoolGroup, string>> = {
  W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green', M: 'Multicolour', C: 'Colourless', L: 'Lands'
}

export function poolGroupOf(card: Pick<CardRow, 'colors' | 'type'>): PoolGroup {
  if (isLand(card)) return 'L'
  const letters = [...new Set((card.colors || '').toUpperCase().split('').filter(c => POOL_COLORS.includes(c as PoolColor)))]
  if (letters.length === 0) return 'C'
  if (letters.length > 1) return 'M'
  return letters[0] as PoolColor
}

/** Pool grouped by colour, groups in POOL_GROUP_ORDER, cards by mana value then name. */
export function groupPool(pool: ReadonlyArray<CardRow>): Array<{ group: PoolGroup; cards: CardRow[] }> {
  const buckets = new Map<PoolGroup, CardRow[]>()
  for (const card of pool) {
    const g = poolGroupOf(card)
    const list = buckets.get(g) ?? []
    list.push(card)
    buckets.set(g, list)
  }
  return POOL_GROUP_ORDER
    .filter(g => buckets.has(g))
    .map(g => ({
      group: g,
      cards: [...buckets.get(g)!].sort((a, b) => (a.manaValue ?? 99) - (b.manaValue ?? 99) || a.name.localeCompare(b.name))
    }))
}

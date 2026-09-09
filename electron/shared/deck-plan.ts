/**
 * Deckbuild advice for a finished draft (pure logic — unit tested).
 *
 * The draft is over and the pool is known, so the assistant can keep helping:
 * name the lane, say which colours are dead, and propose a 40 built from the
 * model's pool-conditioned grades.
 *
 * DIVISION OF LABOUR. The card ORDER is entirely the model's — we rank by the
 * same pool-conditioned percentile the overlay recommends by, and never invent
 * a rating. Everything about DECK SHAPE is ours: DraftFM scores cards, it has
 * no notion of deck size, land counts, or splashing. Those constants live here,
 * named, so the seam between "the model said" and "we assumed" stays visible.
 */
import type { CardRow, Grade } from '../../shared/state'
import { gradeOrdinal } from '../../shared/grades'
import { POOL_COLORS, poolSummary, type PoolColor, type PoolSummary } from './hud-logic'

/** Limited decks are 40 cards. Not a model output — a rule of the format. */
export const DECK_SIZE = 40
/** The usual 17 lands / 23 spells split for a two-colour creature deck. */
export const TARGET_LANDS = 17
export const TARGET_SPELLS = DECK_SIZE - TARGET_LANDS
/**
 * A second colour needs this many cards before it is a lane and not a splash.
 * Deliberately not lower: three or four off-colour cards is the shape of a pool
 * you drifted past, and treating that as a lane proposes a deck you can't cast.
 */
export const SECOND_COLOR_MIN = 5
/** How many just-missed cards to name, so the last cut is arguable. */
export const CLOSE_COUNT = 3
/** At most this many non-basic lands; each one replaces a basic. */
export const MAX_NONBASIC_LANDS = 2
/**
 * Source floors. Raw pips-in-proportion is the naive split and it starves the
 * shallower colour: a deck of mostly-green spells plus two {1}{B}{B} cards
 * lands on five Swamps, which does not cast them. These are the usual limited
 * guidelines for how many sources a cost actually wants.
 */
export const MIN_SOURCES_DOUBLE_PIP = 6
export const MIN_SOURCES_SUPPORTING = 4
/** Below this many pips a colour is a light touch and takes what's left. */
export const SUPPORTING_PIP_MIN = 3

/** The basic land each lane colour runs. */
export const BASIC_LAND_NAMES: Readonly<Record<PoolColor, string>> = {
  W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest'
}

function isLand(card: Pick<CardRow, 'type'>): boolean {
  return /\bland\b/i.test(card.type || '')
}

function isBasicLand(card: Pick<CardRow, 'type' | 'rarity'>): boolean {
  return /\bbasic land\b/i.test(card.type || '') || (card.rarity || '').toLowerCase() === 'land'
}

/** Colour letters a card actually costs (multicolour yields several). */
function colorsOf(card: Pick<CardRow, 'colors'>): PoolColor[] {
  const seen = new Set((card.colors || '').toUpperCase().split(''))
  return POOL_COLORS.filter(c => seen.has(c))
}

/**
 * Castable in this lane: on-colour or colourless. Lands are judged by colour
 * IDENTITY, not cost — a dual land costs nothing but only serves its colours,
 * and reading `colors` alone lets an off-lane land into the deck.
 */
function inLane(card: Pick<CardRow, 'colors' | 'colorIdentity' | 'type'>, lane: ReadonlyArray<PoolColor>): boolean {
  const letters = isLand(card) ? colorsOf({ colors: card.colorIdentity }) : colorsOf(card)
  return letters.every(c => lane.includes(c))
}

/**
 * Best → worst by the model's pool-conditioned percentile, falling back to the
 * raw grade ladder when a card never scored. Ties break by name so the same
 * pool always proposes the same 40.
 */
function byModelRank(a: CardRow, b: CardRow): number {
  const pa = a.percentile, pb = b.percentile
  if (pa !== null && pb !== null && pa !== pb) return pb - pa
  if (pa !== null && pb === null) return -1
  if (pa === null && pb !== null) return 1
  const ga = a.grade ?? a.setGrade, gb = b.grade ?? b.setGrade
  const oa = ga ? gradeOrdinal(ga) : -1, ob = gb ? gradeOrdinal(gb) : -1
  if (oa !== ob) return ob - oa
  return a.name.localeCompare(b.name)
}

/** One line of the proposed deck: identical names collapse into a count. */
export interface DeckEntry {
  name: string
  count: number
  manaCost: string
  grade: Grade | null
  /** Best percentile among the copies, for display ordering. */
  percentile: number | null
}

/** A colour that was drafted but is not in the lane. */
export interface CutColor {
  color: PoolColor
  count: number
}

/** Where every pool card ended up, keyed by card name. */
export interface CardStatus {
  /** Copies that made the 40. */
  included: number
  /** Copies owned. */
  total: number
  /** Just missed the last slot. */
  close: boolean
}

/** The full deckbuild recommendation for a finished pool. */
export interface DeckPlan {
  /** One or two colours, most-drafted first. */
  lane: PoolColor[]
  /** 'B/G', or 'G' for a mono lane. */
  laneLabel: string
  /** Off-lane colours worth naming, biggest first. */
  cut: CutColor[]
  /** On-lane non-land cards available (the honest denominator). */
  playable: number
  /** The proposed spells, best → worst. */
  spells: DeckEntry[]
  /** Non-basic lands worth playing (on-lane or colourless). */
  nonbasicLands: DeckEntry[]
  /** Basic land counts, derived from the chosen spells' pips. */
  basics: Array<{ color: PoolColor; count: number }>
  /** Cards that just missed, best first. */
  close: DeckEntry[]
  spellCount: number
  landCount: number
  total: number
  /** Fewer playables than TARGET_SPELLS: the deck is short and we say so. */
  short: boolean
  statusByName: Record<string, CardStatus>
}

function toEntries(cards: ReadonlyArray<CardRow>): DeckEntry[] {
  const out: DeckEntry[] = []
  const byName = new Map<string, DeckEntry>()
  for (const card of cards) {
    const found = byName.get(card.name)
    if (found) {
      found.count += 1
      if (card.percentile !== null && (found.percentile === null || card.percentile > found.percentile)) {
        found.percentile = card.percentile
      }
      continue
    }
    const entry: DeckEntry = {
      name: card.name,
      count: 1,
      manaCost: card.manaCost,
      grade: card.grade ?? card.setGrade,
      percentile: card.percentile
    }
    byName.set(card.name, entry)
    out.push(entry)
  }
  return out
}

/**
 * Pick the lane: the most-drafted colour, plus the runner-up when it has
 * enough cards to be a real second colour rather than a splash.
 */
export function chooseLane(summary: PoolSummary): PoolColor[] {
  const ranked = (Object.entries(summary.counts) as Array<[PoolColor, number]>)
    .sort((a, b) => b[1] - a[1] || POOL_COLORS.indexOf(a[0]) - POOL_COLORS.indexOf(b[0]))
  const [first, second] = ranked
  if (!first || first[1] === 0) return []
  const lane = [first[0]]
  if (second && second[1] >= SECOND_COLOR_MIN) lane.push(second[0])
  return lane
}

/**
 * Split the basics by the coloured pips the chosen spells actually ask for.
 * Every lane colour that appears at all keeps at least one source.
 */
export function basicSplit(
  spells: ReadonlyArray<Pick<CardRow, 'manaCost'>>,
  lane: ReadonlyArray<PoolColor>,
  slots: number
): Array<{ color: PoolColor; count: number }> {
  if (slots <= 0 || lane.length === 0) return []
  const pips = new Map<PoolColor, number>(lane.map(c => [c, 0]))
  const doublePip = new Set<PoolColor>()
  for (const spell of spells) {
    const perCard = new Map<PoolColor, number>()
    for (const sym of (spell.manaCost || '').toUpperCase().matchAll(/\{([^}]*)\}/g)) {
      for (const c of lane) {
        if (!sym[1].includes(c)) continue
        pips.set(c, pips.get(c)! + 1)
        perCard.set(c, (perCard.get(c) ?? 0) + 1)
      }
    }
    for (const [c, n] of perCard) if (n >= 2) doublePip.add(c)
  }
  const total = [...pips.values()].reduce((s, n) => s + n, 0)
  if (total === 0) {
    // No coloured costs at all: split as evenly as the slots allow.
    return lane.map((color, i) => ({ color, count: Math.floor(slots / lane.length) + (i < slots % lane.length ? 1 : 0) }))
  }
  const raw = lane.map(color => ({ color, exact: (pips.get(color)! / total) * slots }))
  const out = raw.map(r => ({ color: r.color, count: pips.get(r.color)! > 0 ? Math.max(1, Math.floor(r.exact)) : 0 }))
  // Hand out the rounding remainder to the largest fractional parts.
  let left = slots - out.reduce((s, r) => s + r.count, 0)
  const order = [...raw]
    .map((r, i) => ({ i, frac: r.exact - Math.floor(r.exact) }))
    .sort((a, b) => b.frac - a.frac)
  for (let k = 0; left > 0 && order.length > 0; k++, left--) out[order[k % order.length].i].count += 1
  // Over-allocated by the at-least-one floor: shave the biggest pile.
  while (left < 0) {
    const biggest = out.reduce((m, r) => (r.count > m.count ? r : m), out[0])
    if (biggest.count <= 1) break
    biggest.count -= 1
    left++
  }

  // Raise any colour below its source floor, paying for it from the deepest
  // colour. The floor never wins if it would leave the main colour shorter.
  for (const row of out) {
    const n = pips.get(row.color)!
    if (n === 0) continue
    const floor = doublePip.has(row.color)
      ? MIN_SOURCES_DOUBLE_PIP
      : n >= SUPPORTING_PIP_MIN ? MIN_SOURCES_SUPPORTING : 1
    while (row.count < Math.min(floor, slots)) {
      const donor = out.reduce((m, r) => (r.count > m.count ? r : m), out[0])
      if (donor === row || donor.count <= row.count + 1) break
      donor.count -= 1
      row.count += 1
    }
  }
  return out.filter(r => r.count > 0)
}

/** Build the whole recommendation from a finished pool. */
export function buildDeck(pool: ReadonlyArray<CardRow>): DeckPlan {
  const summary = poolSummary(pool)
  const lane = chooseLane(summary)
  const laneLabel = lane.join('/')

  const spellsAvailable = pool.filter(c => !isLand(c) && inLane(c, lane)).sort(byModelRank)
  const chosen = spellsAvailable.slice(0, TARGET_SPELLS)
  const missed = spellsAvailable.slice(TARGET_SPELLS)

  // Non-basic lands that cast our spells earn a slot ahead of a basic.
  const nonbasic = pool
    .filter(c => isLand(c) && !isBasicLand(c) && inLane(c, lane))
    .sort(byModelRank)
    .slice(0, MAX_NONBASIC_LANDS)

  const landCount = TARGET_LANDS
  const basics = basicSplit(chosen, lane, Math.max(0, landCount - nonbasic.length))

  const cut = (Object.entries(summary.counts) as Array<[PoolColor, number]>)
    .filter(([color, n]) => n > 0 && !lane.includes(color))
    .map(([color, count]) => ({ color, count }))
    .sort((a, b) => b.count - a.count)

  const statusByName: Record<string, CardStatus> = {}
  for (const card of pool) {
    statusByName[card.name] ??= { included: 0, total: 0, close: false }
    statusByName[card.name].total += 1
  }
  for (const card of chosen) statusByName[card.name].included += 1
  for (const card of nonbasic) statusByName[card.name].included += 1
  // "Close" is only meaningful for a card with no copy in the deck; an extra
  // copy of something already played is a quantity call, not a cut.
  const close = missed.filter(c => statusByName[c.name].included === 0).slice(0, CLOSE_COUNT)
  for (const card of close) statusByName[card.name].close = true

  const spellCount = chosen.length
  return {
    lane,
    laneLabel,
    cut,
    playable: spellsAvailable.length,
    spells: toEntries(chosen),
    nonbasicLands: toEntries(nonbasic),
    basics,
    close: toEntries(close),
    spellCount,
    landCount,
    total: spellCount + landCount,
    short: spellCount < TARGET_SPELLS,
    statusByName
  }
}

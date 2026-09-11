/**
 * Arena's Limited deckbuilder geometry and ordering (pure — unit tested).
 *
 * Everything here is window-relative. Unlike the pack grid, which lives in
 * the centred height-scaled content box, the builder's panels are anchored
 * to the window EDGES: the deck-list rail hugs the right edge and the
 * filter bar / pool grid hug the left. Fractions were measured on a
 * 1280x748 pt window at (208,39) on 2026-09-06 (LTR Premier, vertical
 * compact list, sideboard collapsed). Other sizes and the horizontal layout
 * are unmeasured: run `arena.sh build --dry-run` and compare against
 * `arena.sh shot` before trusting a new window size.
 *
 * Ordering of the deck-list rail (observed on that deck, 30 distinct rows):
 * mana value ascending, then Arena's Order_ColorOrder (mono W U B R G,
 * then the fixed two-colour table, then colourless), then title; lands last,
 * basics by colour then nonbasics. Duplicates collapse to one "Nx" row.
 */

import { colorOrder, type DisplayOrderCard } from './display-order'
import { isLand, isBasicLand, titleKey, namesMatch } from './cards'
import { aspectBucketOf, nearestCalibrationBucket } from './layout'

export { namesMatch }

export interface DeckRailCalibration {
  /** Row centre x, as a fraction of window width. */
  rowX: number
  /** First row centre y when the list is scrolled to the top (fraction of height). */
  firstRowY: number
  /** Last row centre y when the list is scrolled fully down. */
  lastRowY: number
  /** Row pitch as a fraction of window height. */
  rowPitch: number
  /** The Done button centre (never clicked by automation; here to avoid it). */
  done: { x: number; y: number }
  /** The rail's left edge, for OCR regions. */
  railLeft: number
  /**
   * The OCR region's top and bottom.
   *
   * `railTop` is deliberately ABOVE the first row: the "40/40 Cards" header
   * sits there and is the only on-screen source of the deck size, which is the
   * checkpoint every edit is verified against. The deckbuilder used to pass its
   * own 0.165 here and silently disagree with this file.
   */
  railTop: number
  railBottom: number
}

/**
 * The builder's geometry for one window shape.
 *
 * Bucketed by aspect ratio, the same way the pack grid's calibration is: these
 * are fractions of the window, and a window of a different SHAPE moves the
 * panels relative to each other, not just their size. The numbers below were
 * measured to four decimals on exactly one window on one afternoon and were
 * then applied to every window, which is how the land tiles came to be clicked
 * where the land tiles are not.
 */
export interface BuilderCalibration {
  rail: DeckRailCalibration
  landPicker: LandPickerCalibration
  pool: PoolCalibration
}

export interface LandPickerCalibration {
  /** Land filter icon in the pool filter bar. */
  filter: { x: number; y: number }
  /** Basic-land tile centres in the filtered pool grid, by colour. */
  tiles: Record<'W' | 'U' | 'B' | 'R' | 'G', { x: number; y: number }>
}

export interface PoolCalibration {
  search: { x: number; y: number }
  /** The X inside the search field. */
  clearSearch: { x: number; y: number }
  /** Centre of the first (top-left) pool card. */
  firstCell: { x: number; y: number }
}

export const DECK_RAIL: DeckRailCalibration = {
  rowX: 0.9008,
  firstRowY: 0.2219,
  lastRowY: 0.7473,
  rowPitch: 0.04269,
  done: { x: 0.902, y: 0.934 },
  railLeft: 0.775,
  railTop: 0.165,
  railBottom: 0.90
}

/** The filter bar's land toggle and the basic-land tiles it reveals. */
export const LAND_PICKER: LandPickerCalibration = {
  filter: { x: 0.327, y: 0.1618 },
  tiles: {
    W: { x: 0.240, y: 0.416 },
    U: { x: 0.390, y: 0.416 },
    B: { x: 0.540, y: 0.416 },
    R: { x: 0.689, y: 0.416 },
    G: { x: 0.090, y: 0.779 }
  }
}

/**
 * The card pool on the left of the builder, and its search field.
 *
 * Searching for a card by name is far steadier than indexing into the pool
 * grid: one query leaves a single result in the first cell, so nothing depends
 * on the pool's sort order, its scroll position, or how many cards are left.
 *
 * The overlay's own deckbuild sidebar is mirrored to the left and covers the
 * first two columns, so whatever drives these must hide the overlay first.
 */
export const POOL: PoolCalibration = {
  search: { x: 0.0844, y: 0.1626 },
  clearSearch: { x: 0.1311, y: 0.1626 },
  firstCell: { x: 0.0906, y: 0.4183 }
}

/** The one window shape anyone has actually measured: 1280x748, aspect 1.7. */
export const MEASURED_ASPECT = 'aspect-1.7'

const BUILDER_BY_ASPECT: Readonly<Record<string, BuilderCalibration>> = {
  [MEASURED_ASPECT]: { rail: DECK_RAIL, landPicker: LAND_PICKER, pool: POOL }
}

/** Aspect buckets with measured builder geometry. */
export function builderBuckets(): string[] {
  return Object.keys(BUILDER_BY_ASPECT)
}

/**
 * Builder geometry for a window, and whether it was actually measured for it.
 *
 * `measured` is false when the nearest bucket is a guess. Callers should say so
 * out loud rather than click confidently: an unmeasured shape is exactly the
 * situation where a click lands on nothing and the run reports success.
 */
export function builderCalibrationFor(rect: { width: number; height: number }): { calibration: BuilderCalibration; bucket: string; measured: boolean } {
  const bucket = nearestCalibrationBucket(builderBuckets(), rect.width, rect.height) ?? MEASURED_ASPECT
  return { calibration: BUILDER_BY_ASPECT[bucket] ?? BUILDER_BY_ASPECT[MEASURED_ASPECT], bucket, measured: aspectBucketOf(rect.width, rect.height) === bucket }
}

/**
 * How many rail rows are fully visible above the Done button.
 *
 * Derived from the geometry rather than stored: a stored count of 16 cannot
 * survive a window resize, and it is the kind of constant that stays right
 * until the day it is silently wrong.
 */
export function visibleRows(cal: DeckRailCalibration = DECK_RAIL): number {
  return Math.floor((cal.lastRowY - cal.firstRowY) / cal.rowPitch) + 1
}

export interface Rect { x: number; y: number; width: number; height: number }

/**
 * How close to Done a rail click may land, in row pitches.
 *
 * Done sits in the SAME x column as every rail row, and on the measured window
 * its centre is only 25pt below the bottom of the OCR region — less than one
 * row pitch. Nothing stopped a click there: row y came straight from OCR with
 * no upper bound, and the only thing keeping automation off the button was that
 * two fractions happened not to overlap. Done commits the deck and is the
 * player's to press, so the distance is asserted rather than assumed.
 */
export const DONE_CLEARANCE_PITCHES = 1.5

/** Thrown rather than clicking somewhere that might be Done. */
export class UnsafeRailClick extends Error {}

/**
 * Screen y values a rail click may use, given the window.
 *
 * `measured` false means this window shape has never been measured, so the
 * fractions are a guess from another aspect and the clearance below Done cannot
 * be trusted at all: refuse every rail click rather than warn and continue.
 */
export function assertSafeRailClick(
  rect: Rect,
  y: number,
  cal: DeckRailCalibration = DECK_RAIL,
  measured = true
): void {
  if (!measured) {
    throw new UnsafeRailClick(`no rail geometry measured for a ${rect.width}x${rect.height} window; refusing to click near Done`)
  }
  const doneY = rect.y + cal.done.y * rect.height
  const limit = doneY - DONE_CLEARANCE_PITCHES * cal.rowPitch * rect.height
  if (y >= limit) {
    throw new UnsafeRailClick(`rail click at y=${Math.round(y)} is within ${DONE_CLEARANCE_PITCHES} row pitches of Done (y=${Math.round(doneY)}); refusing`)
  }
  if (y <= rect.y) throw new UnsafeRailClick(`rail click at y=${Math.round(y)} is above the window`)
}

/** Window-relative fraction → screen point. */
export function at(rect: Rect, fx: number, fy: number): { x: number; y: number } {
  return { x: Math.round(rect.x + fx * rect.width), y: Math.round(rect.y + fy * rect.height) }
}

/** Screen point of deck-list row `index` when the list is scrolled to the top. */
export function railRowTop(rect: Rect, index: number, cal: DeckRailCalibration = DECK_RAIL): { x: number; y: number } {
  return at(rect, cal.rowX, cal.firstRowY + index * cal.rowPitch)
}

/** Screen point of row `index` of `total` when the list is scrolled fully down. */
export function railRowBottom(rect: Rect, index: number, total: number, cal: DeckRailCalibration = DECK_RAIL): { x: number; y: number } {
  return at(rect, cal.rowX, cal.lastRowY - (total - 1 - index) * cal.rowPitch)
}

/** The rail region to OCR, in screen points. */
export function railRegion(rect: Rect, cal: DeckRailCalibration = DECK_RAIL): Rect {
  return {
    x: Math.round(rect.x + cal.railLeft * rect.width),
    y: Math.round(rect.y + cal.railTop * rect.height),
    width: Math.round((1 - cal.railLeft) * rect.width),
    height: Math.round((cal.railBottom - cal.railTop) * rect.height)
  }
}

export interface DeckListCard extends DisplayOrderCard {
  name: string
  manaValue: number | null
  type?: string | null
}


/** Arena's deck-list sort. Stable, so equal keys keep input order. */
export function deckListOrder<T extends DeckListCard>(cards: ReadonlyArray<T>): T[] {
  return cards
    .map((card, index) => ({ card, index }))
    .sort((a, b) => {
      const la = isLand(a.card), lb = isLand(b.card)
      if (la !== lb) return la ? 1 : -1
      if (la && lb) {
        const ba = isBasicLand(a.card), bb = isBasicLand(b.card)
        if (ba !== bb) return ba ? -1 : 1
      } else {
        const mv = (a.card.manaValue ?? 0) - (b.card.manaValue ?? 0)
        if (mv !== 0) return mv
      }
      const c = colorOrder(a.card) - colorOrder(b.card)
      if (c !== 0) return c
      const ta = titleKey(a.card.name), tb = titleKey(b.card.name)
      if (ta !== tb) return ta < tb ? -1 : 1
      return a.index - b.index
    })
    .map(e => e.card)
}

export interface DeckRow<T extends DeckListCard = DeckListCard> {
  name: string
  count: number
  card: T
}

/** Collapse a deck (one entry per copy) into Arena's "Nx Name" rows, in rail order. */
export function deckRows<T extends DeckListCard>(deck: ReadonlyArray<T>): DeckRow<T>[] {
  const rows: DeckRow<T>[] = []
  for (const card of deckListOrder(deck)) {
    const last = rows[rows.length - 1]
    if (last && last.name === card.name) last.count++
    else rows.push({ name: card.name, count: 1, card })
  }
  return rows
}

/** One OCR'd rail line: "3x Esquire of the King" → {count, name}. */
export function parseRailLine(text: string): { count: number; name: string } | null {
  const m = text.trim().match(/^(\d{1,2}|[Il])\s*[xX×]\s*(.+)$/)
  if (!m) return null
  const count = /^[Il]$/.test(m[1]) ? 1 : Number(m[1])
  // Recognition drops stray glyphs between the count and the name — the
  // Swamp row of a live build read "17x ( Swamp". Left as "( Swamp" the row is
  // not a basic-land name, the builder sees no Swamps at all, and it adds
  // sixteen on top of the seventeen already there: 57/40. A name starts with
  // a letter.
  return { count, name: m[2].trim().replace(/^[^A-Za-z]+/, '').trim() }
}

/**
 * Arena's deck-size header: "41/40 Cards" → 41.
 *
 * The denominator is whatever the format asks for — 40 in Limited, 60 in a
 * constructed deck — so it is read, not assumed. `deckSize` reports it for
 * callers that want to check they are looking at the format they expect.
 */
export function parseDeckCount(text: string): number | null {
  return parseDeckHeader(text)?.count ?? null
}
/** Deck sizes Arena's builder can show. Anything else is not a deck header. */
const DECK_SIZES = [40, 60, 100]

export function parseDeckHeader(text: string): { count: number; deckSize: number } | null {
  // Anchored on a real deck size, and on digit boundaries.
  //
  // The previous pattern was `(\d{1,3})\/(\d{1,3})` with nothing around it, so
  // it matched any "N/M" anywhere in the line. A creature's printed power and
  // toughness is exactly that shape: a rail row reading "2x Cavern Stomper 2/4"
  // parsed as a two-card deck, and the builder then believed it was 38 cards
  // short and started adding. The header is the only place a plausible deck size
  // appears, so require one.
  const m = text.match(/(?<!\d)(\d{1,3})\s*\/\s*(\d{2,3})(?!\d)/)
  if (!m) return null
  const deckSize = Number(m[2])
  if (!DECK_SIZES.includes(deckSize)) return null
  return { count: Number(m[1]), deckSize }
}


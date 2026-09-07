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

export interface DeckRailCalibration {
  /** Row centre x, as a fraction of window width. */
  rowX: number
  /** First row centre y when the list is scrolled to the top (fraction of height). */
  firstRowY: number
  /** Last row centre y when the list is scrolled fully down. */
  lastRowY: number
  /** Row pitch as a fraction of window height. */
  rowPitch: number
  /** Rows fully visible above the Done button. */
  visibleRows: number
  /** The Done button centre (never clicked by automation; here to avoid it). */
  done: { x: number; y: number }
  /** The rail's left edge, for OCR regions. */
  railLeft: number
  /** Top of the first row's box and bottom of the last visible row's box. */
  railTop: number
  railBottom: number
}

export const DECK_RAIL: DeckRailCalibration = {
  rowX: 0.9008,
  firstRowY: 0.2219,
  lastRowY: 0.7473,
  rowPitch: 0.04269,
  visibleRows: 16,
  done: { x: 0.902, y: 0.934 },
  railLeft: 0.775,
  railTop: 0.195,
  railBottom: 0.90
}

/** The filter bar's land toggle and the basic-land tiles it reveals. */
export const LAND_PICKER = {
  /** Land filter icon in the pool filter bar. */
  filter: { x: 0.327, y: 0.1618 },
  /** Basic-land tile centres in the filtered pool grid, by colour. */
  tiles: {
    W: { x: 0.240, y: 0.416 },
    U: { x: 0.390, y: 0.416 },
    B: { x: 0.540, y: 0.416 },
    R: { x: 0.689, y: 0.416 },
    G: { x: 0.090, y: 0.779 }
  } as Record<'W' | 'U' | 'B' | 'R' | 'G', { x: number; y: number }>
}

export interface Rect { x: number; y: number; width: number; height: number }

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

function isLand(card: DeckListCard): boolean {
  return /\bland\b/i.test(card.type ?? '') || (card.rarity ?? '').toLowerCase() === 'land'
}
function isBasic(card: DeckListCard): boolean {
  return /\bbasic land\b/i.test(card.type ?? '')
}
function titleKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9/]/g, '')
}

/** Arena's deck-list sort. Stable, so equal keys keep input order. */
export function deckListOrder<T extends DeckListCard>(cards: ReadonlyArray<T>): T[] {
  return cards
    .map((card, index) => ({ card, index }))
    .sort((a, b) => {
      const la = isLand(a.card), lb = isLand(b.card)
      if (la !== lb) return la ? 1 : -1
      if (la && lb) {
        const ba = isBasic(a.card), bb = isBasic(b.card)
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
  return { count, name: m[2].trim() }
}

/** "41/40 Cards" → 41. */
export function parseDeckCount(text: string): number | null {
  const m = text.match(/(\d{1,3})\s*\/\s*40/)
  return m ? Number(m[1]) : null
}

/** Loose name match for OCR output: case, punctuation, and truncation ("Faramir, Field Comma…") tolerant. */
export function namesMatch(ocr: string, name: string): boolean {
  const a = titleKey(ocr.replace(/[….]+$/, ''))
  const b = titleKey(name)
  if (!a || !b) return false
  return a === b || (a.length >= 8 && b.startsWith(a))
}

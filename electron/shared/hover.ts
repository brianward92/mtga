/**
 * Hover pop-out prediction (pure — unit tested).
 *
 * Arena draws its enlarged card preview INSIDE its own window, so an
 * always-on-top overlay cannot sit between the pack and the preview. Instead
 * we predict where the preview will be from the hovered card cell and hide
 * whatever we draw there. Measured on a 1512x949 Arena window: the preview is
 * ~2.1x the card, ~0.19 card-widths to the right, vertically centred on the
 * card, flipping to the left when it would run off the window; a flavour-text
 * box also appears just above-left of the preview.
 */
import type { Rect } from './layout'

export const POPOUT_SCALE = 2.1
export const POPOUT_GAP = 0.19
export const SPLIT_POPOUT_WIDTH_SCALE = 5.0
export const SPLIT_POPOUT_HEIGHT_SCALE = 2.35
export const SPLIT_POPOUT_GAP = 0.5
export const SPLIT_POPOUT_TOP_OFFSET = 0.35

export interface PopoutOptions {
  /** Arena renders Rooms/split cards as a wide landscape preview. */
  split?: boolean
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

export function contains(r: Rect, p: { x: number; y: number }): boolean {
  return p.x >= r.x && p.x < r.x + r.width && p.y >= r.y && p.y < r.y + r.height
}

/** Index of the card cell under the cursor, or -1. */
export function hoveredCardIndex(point: { x: number; y: number }, cards: Rect[]): number {
  return cards.findIndex(card => contains(card, point))
}

/** Regions Arena's preview is expected to cover for a hovered card. */
export function predictPopout(
  card: Rect,
  view: { width: number; height: number },
  opts: PopoutOptions = {}
): Rect[] {
  const split = opts.split === true
  const w = card.width * (split ? SPLIT_POPOUT_WIDTH_SCALE : POPOUT_SCALE)
  const h = card.height * (split ? SPLIT_POPOUT_HEIGHT_SCALE : POPOUT_SCALE)
  const gap = card.width * (split ? SPLIT_POPOUT_GAP : POPOUT_GAP)
  let x = card.x + card.width + gap
  if (x + w > view.width) x = card.x - gap - w
  let y = split
    ? card.y - card.height * SPLIT_POPOUT_TOP_OFFSET
    : card.y + card.height / 2 - h / 2
  y = Math.max(0, Math.min(view.height - h, y))
  const preview = { x, y, width: w, height: h }
  // Flavour/rules-text box: bridges the hovered card and preview, level with
  // the preview's top. Rooms use the same secondary region beside their wide
  // landscape preview.
  const boxLeft = Math.min(card.x, x)
  const boxRight = Math.max(card.x + card.width, x + w)
  const box = { x: boxLeft, y: y - card.height * 0.05, width: boxRight - boxLeft, height: card.height * 0.28 }
  return [preview, box]
}

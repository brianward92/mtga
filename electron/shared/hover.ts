/**
 * Hover preview awareness (pure — unit tested).
 *
 * Arena draws its enlarged card preview INSIDE its own window, so an
 * always-on-top overlay cannot sit between the pack and the preview. The
 * overlay only knows the cursor: once it has rested on a pack card, Arena's
 * preview is taken to be up, and everything the overlay draws steps aside
 * until the cursor leaves the card. `predictPopout` estimates where the
 * preview lands (measured on a 1512x949 window: ~2.1x the card, ~0.19
 * card-widths to the right, vertically centred, flipped left for the
 * right-most column, clamped at the bottom, with a flavour-text box just
 * above). The fade and the badge lift only need to know that a preview is
 * up; the estimate says where.
 */
import type { Rect } from './layout'

/** Portrait preview size relative to its source card. */
const POPOUT_SCALE = 2.1
/** Portrait preview gap in source-card widths. */
const POPOUT_GAP = 0.19
/** Split/Room preview width in source-card widths. */
const SPLIT_POPOUT_WIDTH_SCALE = 5.0
/** Split/Room preview height in source-card heights. */
const SPLIT_POPOUT_HEIGHT_SCALE = 2.35
/** Split/Room preview gap in source-card widths. */
const SPLIT_POPOUT_GAP = 0.5
/** Split/Room preview lift in source-card heights. */
const SPLIT_POPOUT_TOP_OFFSET = 0.35
/** Rest on a card this long before Arena's preview is taken to be up. */
const HOVER_ENTER_DWELL_MS = 250
/** Grace period that preserves a preview during a brief cursor excursion. */
const HOVER_LEAVE_GRACE_MS = 120

/** Arena preview variants inferred from the hovered card and grid column. */
export interface PopoutOptions {
  /** Arena renders Rooms/split cards as a wide landscape preview. */
  split?: boolean
  /** Arena places previews left of cards in the right-most grid column. */
  flipLeft?: boolean
}

/** Whether a point lies within a rectangle's half-open bounds. */
function contains(r: Rect, p: { x: number; y: number }): boolean {
  return p.x >= r.x && p.x < r.x + r.width && p.y >= r.y && p.y < r.y + r.height
}

/** Index of the card cell under the cursor, or -1. */
export function hoveredCardIndex(point: { x: number; y: number }, cards: Rect[]): number {
  return cards.findIndex(card => contains(card, point))
}

/** True when a row-major cell occupies the last column of its full grid. */
export function isRightmostGridColumn(index: number, maxCols: number): boolean {
  if (!Number.isInteger(index) || index < 0) return false
  const cols = Math.max(1, Math.floor(maxCols))
  return index % cols === cols - 1
}

/**
 * Pure hover intent state machine for the no-capture prediction path.
 * Callers provide monotonic time, making enter dwell and leave grace fully
 * deterministic in tests. Brief excursions from the active cell preserve its
 * preview; a different cell still earns its own complete enter dwell.
 */
export class HoverPreviewIntent {
  private candidate = -1
  private candidateSince = 0
  private active = -1
  private leftSince: number | null = null

  constructor(
    private readonly enterDwellMs = HOVER_ENTER_DWELL_MS,
    private readonly leaveGraceMs = HOVER_LEAVE_GRACE_MS
  ) {}

  reset(): void {
    this.candidate = -1
    this.candidateSince = 0
    this.active = -1
    this.leftSince = null
  }

  update(hoveredIndex: number, now: number): number {
    const hovered = Number.isInteger(hoveredIndex) && hoveredIndex >= 0 ? hoveredIndex : -1

    if (this.active >= 0 && hovered === this.active) {
      this.candidate = hovered
      this.candidateSince = now
      this.leftSince = null
      return this.active
    }

    if (hovered !== this.candidate) {
      this.candidate = hovered
      this.candidateSince = now
    }

    if (this.active >= 0) {
      if (this.leftSince === null) this.leftSince = now
      if (now - this.leftSince < this.leaveGraceMs) return this.active
      this.active = -1
      this.leftSince = null
    }

    if (hovered >= 0 && now - this.candidateSince >= this.enterDwellMs) {
      this.active = hovered
      this.leftSince = null
    }
    return this.active
  }
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
  if (opts.flipLeft === true || x + w > view.width) x = card.x - gap - w
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

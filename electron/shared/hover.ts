/**
 * Hover pop-out prediction (pure — unit tested).
 *
 * Arena draws its enlarged card preview INSIDE its own window, so an
 * always-on-top overlay cannot sit between the pack and the preview. Instead
 * we predict where the preview will be from the hovered card cell and hide
 * whatever we draw there. Measured on a 1512x949 Arena window: the preview is
 * ~2.1x the card, ~0.19 card-widths to the right, vertically centred on the
 * card. Arena deliberately flips the right-most grid column to the left and
 * clamps the bottom row upward; a flavour-text box also appears just
 * above-left of the preview.
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
/** A mere edge-touch must not make a neighbouring badge disappear. */
const PREVIEW_CELL_COVERAGE_THRESHOLD = 0.15
/** Required stable hover before predicted preview regions activate. */
const HOVER_ENTER_DWELL_MS = 350
/** Grace period that preserves a preview during a brief cursor excursion. */
const HOVER_LEAVE_GRACE_MS = 120

/** Arena preview variants inferred from the hovered card and grid column. */
export interface PopoutOptions {
  /** Arena renders Rooms/split cards as a wide landscape preview. */
  split?: boolean
  /** Arena places previews left of cards in the right-most grid column. */
  flipLeft?: boolean
}

/** Whether two positive-area rectangles overlap. */
export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
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
 * Fraction of `target` covered by the union of `regions` (0..1).
 *
 * The union matters because the main preview and its rules box overlap. A
 * straight sum would count those pixels twice and lift cells too eagerly.
 */
export function intersectionFraction(target: Rect, regions: Rect[]): number {
  if (target.width <= 0 || target.height <= 0 || regions.length === 0) return 0

  const targetRight = target.x + target.width
  const targetBottom = target.y + target.height
  const clipped = regions.flatMap(region => {
    const x = Math.max(target.x, region.x)
    const y = Math.max(target.y, region.y)
    const right = Math.min(targetRight, region.x + region.width)
    const bottom = Math.min(targetBottom, region.y + region.height)
    return right > x && bottom > y ? [{ x, y, width: right - x, height: bottom - y }] : []
  })
  if (clipped.length === 0) return 0

  const edges = [...new Set(clipped.flatMap(rect => [rect.x, rect.x + rect.width]))].sort((a, b) => a - b)
  let coveredArea = 0
  for (let i = 0; i + 1 < edges.length; i++) {
    const left = edges[i]
    const right = edges[i + 1]
    if (right <= left) continue
    const intervals = clipped
      .filter(rect => rect.x < right && rect.x + rect.width > left)
      .map(rect => [rect.y, rect.y + rect.height] as const)
      .sort((a, b) => a[0] - b[0])
    if (intervals.length === 0) continue

    let top = intervals[0][0]
    let bottom = intervals[0][1]
    let coveredHeight = 0
    for (let j = 1; j < intervals.length; j++) {
      const [nextTop, nextBottom] = intervals[j]
      if (nextTop > bottom) {
        coveredHeight += bottom - top
        top = nextTop
        bottom = nextBottom
      } else {
        bottom = Math.max(bottom, nextBottom)
      }
    }
    coveredHeight += bottom - top
    coveredArea += (right - left) * coveredHeight
  }
  return Math.min(1, coveredArea / (target.width * target.height))
}

/** Neighbour cells substantially covered by a predicted preview. */
export function previewCoveredCellIndices(
  cards: Rect[],
  hoveredIndex: number,
  regions: Rect[],
  threshold = PREVIEW_CELL_COVERAGE_THRESHOLD
): number[] {
  return cards.flatMap((card, index) =>
    index !== hoveredIndex && intersectionFraction(card, regions) > threshold ? [index] : []
  )
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

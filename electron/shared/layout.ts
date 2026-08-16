/**
 * Badge overlay geometry (pure logic — unit tested).
 *
 * Maps the Arena window size + pack card count onto per-card rects: the card
 * cell itself (calibration ghosts) and the badge chip anchored at its
 * top-center (live badges). Arena lays the pack out as a row-major grid in
 * the left/upper region of the draft screen; the exact fractions vary with
 * window aspect and UI scale, so EVERY constant lives in CalibrationConfig
 * and is user-tunable in calibration mode.
 *
 * Cells are row-major (left→right, top→bottom) in Arena's DISPLAY order —
 * see display-order.ts for the mapping from the log's PackCards order. The
 * numbered ghosts in calibration mode exist to verify the grid geometry.
 */

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** User-tunable fractions and dimensions for Arena's pack grid. */
export interface CalibrationConfig {
  /** Pack area origin/size, as fractions of the Arena window. */
  packLeft: number
  packTop: number
  packWidth: number
  packHeight: number
  /** Cards per full row (row-major; the last row takes the remainder). */
  maxCols: number
  /** Horizontal alignment of a partial last row. */
  lastRowAlign: 'center' | 'left'
  /** Vertical gap between rows, as a fraction of the row height. */
  rowGap: number
  /** Horizontal gap between columns, as a fraction of the cell width. */
  colGap: number
  /** Card width / height (a physical MTG card is 63/88 ≈ 0.716). */
  cardAspect: number
  /** Badge anchor below the card's top edge, as a fraction of card height. */
  badgeOffsetY: number
  /** Badge chip size in px (width additionally clamps to the card width). */
  badgeWidth: number
  badgeHeight: number
  /**
   * Cards in a FULL pack (P1P1). Card size is derived from this reference grid
   * rather than the current pack's card count, because Arena keeps cards the
   * same size as a pack is drafted down — only the grid shrinks. Without this,
   * a 3-card pack would stretch its single row over the whole pack area.
   */
  refCount: number
}

/**
 * Starting point for the user's calibration draft, measured against Arena's
 * default windowed size on a MacBook (1512x949 pt): the pack sits in a
 * left-aligned 5-column grid (5/5/4 for 14 cards) starting ~11% in from the
 * left and ~19% down, with the right ~35% of the window being Arena's
 * pick/pool rail. Wider windows may fit more columns — calibration mode
 * exists to tune all of this against a real pack.
 */
export const DEFAULT_CALIBRATION: CalibrationConfig = {
  packLeft: 0.11,
  packTop: 0.188,
  packWidth: 0.552,
  packHeight: 0.723,
  maxCols: 5,
  lastRowAlign: 'left',
  rowGap: 0.066,
  colGap: 0.093,
  cardAspect: 63 / 88,
  badgeOffsetY: 0.075,
  badgeWidth: 140,
  badgeHeight: 28,
  refCount: 14
}

/** Calibration nudge/scale steps (fractions of the window / multipliers). */
export const NUDGE_STEP = 0.005
/** Multiplicative step for pack-area scaling controls. */
export const SCALE_STEP = 1.02
/** Fractional vertical step for the badge anchor control. */
export const BADGE_Y_STEP = 0.01

type NumericKey = Exclude<keyof CalibrationConfig, 'lastRowAlign'>

const LIMITS: Record<NumericKey, [number, number]> = {
  packLeft: [0, 0.9],
  packTop: [0, 0.9],
  packWidth: [0.05, 1],
  packHeight: [0.05, 1],
  maxCols: [1, 10],
  rowGap: [0, 0.9],
  colGap: [0, 0.9],
  cardAspect: [0.3, 2],
  badgeOffsetY: [-0.5, 1],
  badgeWidth: [40, 240],
  badgeHeight: [16, 64],
  refCount: [1, 20]
}

function clampNum(key: NumericKey, value: unknown): number {
  const [lo, hi] = LIMITS[key]
  const n = typeof value === 'number' && Number.isFinite(value) ? value : DEFAULT_CALIBRATION[key]
  const clamped = Math.min(hi, Math.max(lo, n))
  return key === 'maxCols' || key === 'refCount' ? Math.round(clamped) : clamped
}

/**
 * Parse a persisted/foreign value into a full, clamped CalibrationConfig.
 * Unknown or out-of-range fields fall back to the defaults.
 */
export function normalizeCalibration(raw: unknown): CalibrationConfig {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const numeric = {} as Record<NumericKey, number>
  for (const key of Object.keys(LIMITS) as NumericKey[]) {
    numeric[key] = clampNum(key, src[key])
  }
  return {
    ...numeric,
    lastRowAlign:
      src.lastRowAlign === 'left' || src.lastRowAlign === 'center'
        ? src.lastRowAlign
        : DEFAULT_CALIBRATION.lastRowAlign
  }
}

/** Merge a partial patch onto a base config, clamped. */
export function mergeCalibration(
  base: CalibrationConfig,
  patch: Partial<CalibrationConfig>
): CalibrationConfig {
  return normalizeCalibration({ ...base, ...patch })
}

/**
 * Aspect bucket key for persisting one calibration per window shape:
 * width/height rounded to one decimal ("aspect-1.8" covers 16:9 ≈ 1.78).
 * Conventional keys are "aspect-1.3" (4:3), "aspect-1.6" (16:10),
 * "aspect-1.8" (16:9), and "aspect-2.4" (3440×1440 ultrawide); other
 * positive one-decimal aspects are valid too. Invalid sizes use "default".
 */
export function aspectBucketOf(width: number, height: number): string {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return 'default'
  }
  return `aspect-${(width / height).toFixed(1)}`
}

/** Parse the numeric aspect out of a bucket key; null for "default"/garbage. */
export function aspectOfBucket(bucket: string): number | null {
  const m = /^aspect-(\d+(?:\.\d+)?)$/.exec(bucket)
  if (!m) return null
  const value = Number(m[1])
  return Number.isFinite(value) && value > 0 ? value : null
}

/**
 * Best stored numeric calibration bucket for a valid window shape: the exact
 * bucket when it exists, else the numerically nearest calibrated aspect.
 * Invalid sizes return null; "default" is not treated as geometry. A user who
 * tuned the overlay at one window size should not drop back to raw guesses
 * after resizing Arena slightly — 1.7 is far closer to 1.8 than the defaults.
 */
export function nearestCalibrationBucket(
  buckets: string[],
  width: number,
  height: number
): string | null {
  const exact = aspectBucketOf(width, height)
  if (exact === 'default') return null
  const target = width / height
  if (!Number.isFinite(target) || target <= 0) return null
  if (buckets.includes(exact)) return exact

  // Compare fallbacks with the real aspect rather than the rounded bucket key.
  // Near a rounding boundary, 1.34 may be closer to a stored 1.5 calibration
  // than 1.1 even though its persisted key rounds to 1.3.

  let best: { bucket: string; aspect: number; distance: number } | null = null
  for (const bucket of buckets) {
    const aspect = aspectOfBucket(bucket)
    if (aspect === null) continue
    const distance = Math.abs(aspect - target)
    if (!best) {
      best = { bucket, aspect, distance }
      continue
    }
    // Four ULPs at the operands' scale cover rounding from the subtractions
    // used to derive and compare distances. Mathematical ties then resolve to
    // the lexically smaller key, independent of bucket iteration order.
    const epsilon = 4 * Number.EPSILON * Math.max(
      1, Math.abs(target), Math.abs(aspect), Math.abs(best.aspect)
    )
    const tied = Math.abs(distance - best.distance) <= epsilon
    if (distance < best.distance - epsilon || (tied && bucket < best.bucket)) {
      best = { bucket, aspect, distance }
    }
  }
  return best?.bucket ?? null
}

/**
 * Row-major arrangement for a pack of `count` cards: full rows of `maxCols`,
 * the remainder in the last row. rowsForCount(14, 8) -> [8, 6].
 */
export function rowsForCount(count: number, maxCols: number): number[] {
  const n = Math.max(0, Math.floor(count))
  const cols = Math.max(1, Math.floor(maxCols))
  const rows: number[] = []
  for (let remaining = n; remaining > 0; remaining -= cols) {
    rows.push(Math.min(cols, remaining))
  }
  return rows
}

/** Card and badge rectangles for one row-major pack position. */
export interface CardSlot {
  /** Full card cell rect (calibration ghosts). */
  card: Rect
  /** Badge chip rect anchored at the card's top-center (live badges). */
  badge: Rect
}

/** Computed pack bounds and row-major card slots for one Arena view. */
export interface PackLayout {
  /** The configured pack area rect (calibration frame). */
  pack: Rect
  /** One slot per card, in row-major order (Arena display order). */
  cards: CardSlot[]
}

/**
 * Compute card + badge rects for a pack of `count` cards inside a window of
 * `view` size (the badge window covers the Arena window exactly, so these
 * are window-relative px). Pure: same inputs, same rects.
 */
export function packLayout(
  view: { width: number; height: number },
  count: number,
  config: CalibrationConfig
): PackLayout {
  const pack: Rect = {
    x: config.packLeft * view.width,
    y: config.packTop * view.height,
    width: config.packWidth * view.width,
    height: config.packHeight * view.height
  }

  const rows = rowsForCount(count, config.maxCols)
  const cards: CardSlot[] = []
  if (rows.length === 0) return { pack, cards }

  // Card geometry comes from the FULL-pack grid so cards keep their size as the
  // pack is drafted down; Arena keeps the shrinking grid anchored to the TOP of
  // the pack area (verified live at 10 cards: rows stay put, the last row empties).
  const refRows = Math.max(
    rows.length,
    rowsForCount(Math.max(config.refCount, count), config.maxCols).length
  )
  const rowH = pack.height / refRows
  const cellW = pack.width / config.maxCols
  const gridTop = pack.y

  // Card size: fixed aspect, fitted to the cell minus the configured gaps.
  const maxCardH = rowH * (1 - config.rowGap)
  const maxCardW = cellW * (1 - config.colGap)
  const cardH = Math.min(maxCardH, maxCardW / config.cardAspect)
  const cardW = cardH * config.cardAspect

  rows.forEach((cols, rowIndex) => {
    const rowY = gridTop + rowIndex * rowH
    const isPartial = cols < config.maxCols
    const startX = isPartial && config.lastRowAlign === 'center'
      ? pack.x + (pack.width - cols * cellW) / 2
      : pack.x

    for (let col = 0; col < cols; col++) {
      const cellX = startX + col * cellW
      const card: Rect = {
        x: cellX + (cellW - cardW) / 2,
        y: rowY + (rowH - cardH) / 2,
        width: cardW,
        height: cardH
      }
      const badgeW = Math.min(config.badgeWidth, cardW)
      const badge: Rect = {
        x: card.x + (cardW - badgeW) / 2,
        y: card.y + config.badgeOffsetY * cardH,
        width: badgeW,
        height: config.badgeHeight
      }
      cards.push({ card, badge })
    }
  })

  return { pack, cards }
}

// ---------------------------------------------------------------------------
// Calibration ops (helper-panel buttons -> config transforms)
// ---------------------------------------------------------------------------

/** One adjustment emitted by the calibration helper panel. */
export type CalibrationOp =
  | { type: 'nudge'; dx: -1 | 0 | 1; dy: -1 | 0 | 1 }
  | { type: 'scale'; dir: 1 | -1 }
  | { type: 'scale-width'; dir: 1 | -1 }
  | { type: 'scale-height'; dir: 1 | -1 }
  | { type: 'cols'; dir: 1 | -1 }
  | { type: 'badge-y'; dir: 1 | -1 }
  | { type: 'reset' }

/** Apply one helper-panel op; always returns a clamped, valid config. */
export function applyCalibrationOp(
  config: CalibrationConfig,
  op: CalibrationOp
): CalibrationConfig {
  switch (op.type) {
    case 'nudge':
      return mergeCalibration(config, {
        packLeft: config.packLeft + op.dx * NUDGE_STEP,
        packTop: config.packTop + op.dy * NUDGE_STEP
      })
    case 'scale': {
      const f = op.dir === 1 ? SCALE_STEP : 1 / SCALE_STEP
      return mergeCalibration(config, {
        packWidth: config.packWidth * f,
        packHeight: config.packHeight * f
      })
    }
    case 'scale-width': {
      const f = op.dir === 1 ? SCALE_STEP : 1 / SCALE_STEP
      return mergeCalibration(config, { packWidth: config.packWidth * f })
    }
    case 'scale-height': {
      const f = op.dir === 1 ? SCALE_STEP : 1 / SCALE_STEP
      return mergeCalibration(config, { packHeight: config.packHeight * f })
    }
    case 'cols':
      return mergeCalibration(config, { maxCols: config.maxCols + op.dir })
    case 'badge-y':
      return mergeCalibration(config, { badgeOffsetY: config.badgeOffsetY + op.dir * BADGE_Y_STEP })
    case 'reset':
      return { ...DEFAULT_CALIBRATION }
    default:
      return config
  }
}

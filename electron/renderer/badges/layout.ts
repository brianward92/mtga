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
 * Row-major order (left→right, top→bottom) is ASSUMED to match the order of
 * the log's PackCards list — the numbered ghosts in calibration mode exist
 * precisely to verify this against a real pack.
 */

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

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
}

/**
 * Starting point for the user's calibration draft. The pack area sits in
 * roughly the left ~75% x upper ~80% of the window (right side is Arena's
 * pick/pool rail, top is the event header); cards run in rows of up to 8.
 * All of these are guesses until calibrated — that is the point of the mode.
 */
export const DEFAULT_CALIBRATION: CalibrationConfig = {
  packLeft: 0.035,
  packTop: 0.14,
  packWidth: 0.71,
  packHeight: 0.72,
  maxCols: 8,
  lastRowAlign: 'center',
  rowGap: 0.08,
  colGap: 0.06,
  cardAspect: 63 / 88,
  badgeOffsetY: 0.02,
  badgeWidth: 120,
  badgeHeight: 28
}

/** Calibration nudge/scale steps (fractions of the window / multipliers). */
export const NUDGE_STEP = 0.005
export const SCALE_STEP = 1.02
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
  badgeHeight: [16, 64]
}

function clampNum(key: NumericKey, value: unknown): number {
  const [lo, hi] = LIMITS[key]
  const n = typeof value === 'number' && Number.isFinite(value) ? value : DEFAULT_CALIBRATION[key]
  const clamped = Math.min(hi, Math.max(lo, n))
  return key === 'maxCols' ? Math.round(clamped) : clamped
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
    lastRowAlign: src.lastRowAlign === 'left' ? 'left' : 'center'
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
 * Invalid sizes land in the shared "default" bucket.
 */
export function aspectBucketOf(width: number, height: number): string {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return 'default'
  }
  return `aspect-${(width / height).toFixed(1)}`
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

export interface CardSlot {
  /** Full card cell rect (calibration ghosts). */
  card: Rect
  /** Badge chip rect anchored at the card's top-center (live badges). */
  badge: Rect
}

export interface PackLayout {
  /** The configured pack area rect (calibration frame). */
  pack: Rect
  /** One slot per card, in row-major order (matches PackCards order). */
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

  const rowH = pack.height / rows.length
  const cellW = pack.width / config.maxCols

  // Card size: fixed aspect, fitted to the cell minus the configured gaps.
  const maxCardH = rowH * (1 - config.rowGap)
  const maxCardW = cellW * (1 - config.colGap)
  const cardH = Math.min(maxCardH, maxCardW / config.cardAspect)
  const cardW = cardH * config.cardAspect

  rows.forEach((cols, rowIndex) => {
    const rowY = pack.y + rowIndex * rowH
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

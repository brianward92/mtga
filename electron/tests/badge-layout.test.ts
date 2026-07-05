/**
 * Badge overlay geometry: pack grid mapping, calibration config
 * normalization/merge, aspect buckets, and helper-panel ops.
 */

import { describe, it, expect } from 'vitest'
import {
  DEFAULT_CALIBRATION,
  NUDGE_STEP,
  SCALE_STEP,
  BADGE_Y_STEP,
  normalizeCalibration,
  mergeCalibration,
  aspectBucketOf,
  rowsForCount,
  packLayout,
  applyCalibrationOp,
  CalibrationConfig
} from '../renderer/badges/layout'

const VIEWS = [
  { width: 1600, height: 900 },   // 16:9
  { width: 1920, height: 1200 },  // 16:10
  { width: 2560, height: 1440 }   // 16:9 retina-ish
]

describe('rowsForCount', () => {
  it('fills full rows of maxCols, remainder last (row-major)', () => {
    expect(rowsForCount(15, 8)).toEqual([8, 7])
    expect(rowsForCount(14, 8)).toEqual([8, 6])
    expect(rowsForCount(13, 8)).toEqual([8, 5])
    expect(rowsForCount(8, 8)).toEqual([8])
    expect(rowsForCount(2, 8)).toEqual([2])
    expect(rowsForCount(14, 5)).toEqual([5, 5, 4])
  })

  it('handles degenerate inputs', () => {
    expect(rowsForCount(0, 8)).toEqual([])
    expect(rowsForCount(-3, 8)).toEqual([])
    expect(rowsForCount(3, 0)).toEqual([1, 1, 1]) // maxCols floors at 1
  })
})

describe('packLayout geometry', () => {
  const config = DEFAULT_CALIBRATION

  for (const view of VIEWS) {
    for (const n of [8, 14, 15]) {
      it(`produces ${n} slots inside the pack area at ${view.width}x${view.height}`, () => {
        const layout = packLayout(view, n, config)
        expect(layout.cards).toHaveLength(n)

        // Pack area matches the configured fractions
        expect(layout.pack.x).toBeCloseTo(config.packLeft * view.width, 6)
        expect(layout.pack.y).toBeCloseTo(config.packTop * view.height, 6)
        expect(layout.pack.width).toBeCloseTo(config.packWidth * view.width, 6)
        expect(layout.pack.height).toBeCloseTo(config.packHeight * view.height, 6)

        for (const slot of layout.cards) {
          // Every card cell stays within the pack area (small float slack)
          expect(slot.card.x).toBeGreaterThanOrEqual(layout.pack.x - 1e-6)
          expect(slot.card.y).toBeGreaterThanOrEqual(layout.pack.y - 1e-6)
          expect(slot.card.x + slot.card.width)
            .toBeLessThanOrEqual(layout.pack.x + layout.pack.width + 1e-6)
          expect(slot.card.y + slot.card.height)
            .toBeLessThanOrEqual(layout.pack.y + layout.pack.height + 1e-6)

          // Cards keep the configured aspect ratio
          expect(slot.card.width / slot.card.height).toBeCloseTo(config.cardAspect, 6)

          // Badge chip: anchored top-center of its card
          const cardCx = slot.card.x + slot.card.width / 2
          const badgeCx = slot.badge.x + slot.badge.width / 2
          expect(badgeCx).toBeCloseTo(cardCx, 6)
          expect(slot.badge.y)
            .toBeCloseTo(slot.card.y + config.badgeOffsetY * slot.card.height, 6)
          expect(slot.badge.width).toBeLessThanOrEqual(config.badgeWidth)
          expect(slot.badge.width).toBeLessThanOrEqual(slot.card.width + 1e-6)
          expect(slot.badge.height).toBe(config.badgeHeight)
        }
      })
    }
  }

  it('orders slots row-major: left→right, then next row down', () => {
    const layout = packLayout({ width: 1600, height: 900 }, 14, config) // [8, 6]
    const top = layout.cards.slice(0, 8)
    const bottom = layout.cards.slice(8)

    for (let i = 1; i < top.length; i++) {
      expect(top[i].card.x).toBeGreaterThan(top[i - 1].card.x)
      expect(top[i].card.y).toBeCloseTo(top[0].card.y, 6)
    }
    for (let i = 1; i < bottom.length; i++) {
      expect(bottom[i].card.x).toBeGreaterThan(bottom[i - 1].card.x)
    }
    expect(bottom[0].card.y).toBeGreaterThan(top[0].card.y)
  })

  it('centers a partial last row by default, left-aligns when configured', () => {
    const view = { width: 1600, height: 900 }
    const centered = packLayout(view, 14, config) // last row: 6 of 8
    const packCx = centered.pack.x + centered.pack.width / 2
    const row = centered.cards.slice(8)
    const rowCx = (row[0].card.x + row[row.length - 1].card.x + row[0].card.width) / 2
    expect(rowCx).toBeCloseTo(packCx, 4)

    const leftAligned = packLayout(view, 14, { ...config, lastRowAlign: 'left' })
    // First card of the partial row lines up with the first card of a full row
    expect(leftAligned.cards[8].card.x).toBeCloseTo(leftAligned.cards[0].card.x, 6)
  })

  it('scales linearly with the window size (pure fractions)', () => {
    const a = packLayout({ width: 1600, height: 900 }, 15, config)
    const b = packLayout({ width: 3200, height: 1800 }, 15, config)
    for (let i = 0; i < 15; i++) {
      expect(b.cards[i].card.x).toBeCloseTo(a.cards[i].card.x * 2, 4)
      expect(b.cards[i].card.y).toBeCloseTo(a.cards[i].card.y * 2, 4)
      expect(b.cards[i].card.width).toBeCloseTo(a.cards[i].card.width * 2, 4)
    }
    // Badge chips stay fixed-size px (not scaled), just re-anchored
    expect(b.cards[0].badge.height).toBe(a.cards[0].badge.height)
  })

  it('returns an empty layout for zero cards', () => {
    expect(packLayout({ width: 1600, height: 900 }, 0, config).cards).toEqual([])
  })
})

describe('calibration config normalize/merge', () => {
  it('fills defaults for missing/garbage input', () => {
    expect(normalizeCalibration(undefined)).toEqual(DEFAULT_CALIBRATION)
    expect(normalizeCalibration(null)).toEqual(DEFAULT_CALIBRATION)
    expect(normalizeCalibration('nope')).toEqual(DEFAULT_CALIBRATION)
    expect(normalizeCalibration({ packLeft: 'x', maxCols: NaN })).toEqual(DEFAULT_CALIBRATION)
  })

  it('clamps out-of-range values instead of rejecting them', () => {
    const c = normalizeCalibration({
      packLeft: -1,
      packWidth: 5,
      maxCols: 99,
      badgeWidth: 9999,
      badgeHeight: 1
    })
    expect(c.packLeft).toBe(0)
    expect(c.packWidth).toBe(1)
    expect(c.maxCols).toBe(10)
    expect(c.badgeWidth).toBe(240)
    expect(c.badgeHeight).toBe(16)
  })

  it('rounds maxCols to an integer and validates lastRowAlign', () => {
    expect(normalizeCalibration({ maxCols: 7.6 }).maxCols).toBe(8)
    expect(normalizeCalibration({ lastRowAlign: 'left' }).lastRowAlign).toBe('left')
    expect(normalizeCalibration({ lastRowAlign: 'diagonal' }).lastRowAlign).toBe('center')
  })

  it('merges a partial patch over a base config', () => {
    const merged = mergeCalibration(DEFAULT_CALIBRATION, { packTop: 0.2, maxCols: 5 })
    expect(merged.packTop).toBe(0.2)
    expect(merged.maxCols).toBe(5)
    expect(merged.packLeft).toBe(DEFAULT_CALIBRATION.packLeft)
    // Patch values still clamp
    expect(mergeCalibration(DEFAULT_CALIBRATION, { packLeft: 7 }).packLeft).toBe(0.9)
  })
})

describe('aspectBucketOf', () => {
  it('buckets by width/height rounded to one decimal', () => {
    expect(aspectBucketOf(1920, 1080)).toBe('aspect-1.8')
    expect(aspectBucketOf(2560, 1440)).toBe('aspect-1.8')
    expect(aspectBucketOf(1920, 1200)).toBe('aspect-1.6')
    expect(aspectBucketOf(3440, 1440)).toBe('aspect-2.4')
  })

  it('sends invalid sizes to the default bucket', () => {
    expect(aspectBucketOf(0, 900)).toBe('default')
    expect(aspectBucketOf(1600, 0)).toBe('default')
    expect(aspectBucketOf(NaN, 900)).toBe('default')
  })
})

describe('applyCalibrationOp', () => {
  const base = DEFAULT_CALIBRATION

  it('nudges the pack origin by the step', () => {
    const right = applyCalibrationOp(base, { type: 'nudge', dx: 1, dy: 0 })
    expect(right.packLeft).toBeCloseTo(base.packLeft + NUDGE_STEP, 9)
    expect(right.packTop).toBe(base.packTop)

    const up = applyCalibrationOp(base, { type: 'nudge', dx: 0, dy: -1 })
    expect(up.packTop).toBeCloseTo(base.packTop - NUDGE_STEP, 9)
  })

  it('scales both dimensions together, or one at a time', () => {
    const bigger = applyCalibrationOp(base, { type: 'scale', dir: 1 })
    expect(bigger.packWidth).toBeCloseTo(base.packWidth * SCALE_STEP, 9)
    expect(bigger.packHeight).toBeCloseTo(base.packHeight * SCALE_STEP, 9)

    const wider = applyCalibrationOp(base, { type: 'scale-width', dir: 1 })
    expect(wider.packWidth).toBeCloseTo(base.packWidth * SCALE_STEP, 9)
    expect(wider.packHeight).toBe(base.packHeight)

    const shorter = applyCalibrationOp(base, { type: 'scale-height', dir: -1 })
    expect(shorter.packHeight).toBeCloseTo(base.packHeight / SCALE_STEP, 9)
  })

  it('scale/nudge round-trips return to the start', () => {
    let c = base
    c = applyCalibrationOp(c, { type: 'scale', dir: 1 })
    c = applyCalibrationOp(c, { type: 'scale', dir: -1 })
    expect(c.packWidth).toBeCloseTo(base.packWidth, 9)
    c = applyCalibrationOp(c, { type: 'nudge', dx: 1, dy: 1 })
    c = applyCalibrationOp(c, { type: 'nudge', dx: -1, dy: -1 })
    expect(c.packLeft).toBeCloseTo(base.packLeft, 9)
    expect(c.packTop).toBeCloseTo(base.packTop, 9)
  })

  it('adjusts columns and badge offset within limits', () => {
    expect(applyCalibrationOp(base, { type: 'cols', dir: -1 }).maxCols).toBe(base.maxCols - 1)
    const atMax = mergeCalibration(base, { maxCols: 10 })
    expect(applyCalibrationOp(atMax, { type: 'cols', dir: 1 }).maxCols).toBe(10)

    const down = applyCalibrationOp(base, { type: 'badge-y', dir: 1 })
    expect(down.badgeOffsetY).toBeCloseTo(base.badgeOffsetY + BADGE_Y_STEP, 9)
  })

  it('nudges clamp at the pack-area limits', () => {
    let c = mergeCalibration(base, { packLeft: 0.899 })
    c = applyCalibrationOp(c, { type: 'nudge', dx: 1, dy: 0 })
    expect(c.packLeft).toBe(0.9)
    c = applyCalibrationOp(c, { type: 'nudge', dx: 1, dy: 0 })
    expect(c.packLeft).toBe(0.9)
  })

  it('reset restores the defaults', () => {
    const mangled = mergeCalibration(base, { packLeft: 0.5, maxCols: 3 })
    expect(applyCalibrationOp(mangled, { type: 'reset' })).toEqual(DEFAULT_CALIBRATION)
  })
})

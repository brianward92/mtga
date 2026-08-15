/**
 * Pure Arena-glue geometry: anchor capture/apply (edge affinity, fractional
 * offsets, zoom scaling) and the magnetic snap candidates used by manual
 * drags. No Electron — mirrors badge-layout.test.ts's approach.
 */

import { describe, it, expect } from 'vitest'
import {
  PANEL_MAX_WIDTH,
  PANEL_MIN_WIDTH,
  Rect,
  SNAP_THRESHOLD,
  ZOOM_MAX,
  ZOOM_MIN,
  applyAnchor,
  captureAnchor,
  chooseSides,
  clampPanelSize,
  snapAxis,
  snapCandidates
} from '../main/windows/panel-anchor'

const ARENA: Rect = { x: 100, y: 50, width: 1600, height: 900 }

const scaledOpts = (currentHeight = 0) => ({ scaleHeight: true, currentHeight })

describe('chooseSides', () => {
  it('picks the nearest Arena side per axis', () => {
    // Near top-left of Arena
    expect(chooseSides(ARENA, { x: 120, y: 60, width: 300, height: 400 }))
      .toEqual({ hSide: 'left', vSide: 'top' })
    // Near bottom-right of Arena
    expect(chooseSides(ARENA, { x: 1350, y: 500, width: 300, height: 400 }))
      .toEqual({ hSide: 'right', vSide: 'bottom' })
  })

  it('treats a panel docked outside an edge as belonging to that edge', () => {
    // Flush against Arena's outside-right edge
    const outside = { x: ARENA.x + ARENA.width, y: 60, width: 300, height: 400 }
    expect(chooseSides(ARENA, outside).hSide).toBe('right')
  })
})

describe('captureAnchor / applyAnchor round-trip', () => {
  it('reproduces the captured bounds while Arena is unchanged', () => {
    const bounds: Rect = { x: 1350, y: 480, width: 300, height: 420 }
    const anchor = captureAnchor(ARENA, bounds, 1)
    const applied = applyAnchor(anchor, ARENA, scaledOpts(bounds.height))
    expect(applied.bounds).toEqual(bounds)
    expect(applied.zoom).toBe(1)
  })

  it('translates with an Arena move, pixel for pixel', () => {
    const bounds: Rect = { x: 1350, y: 480, width: 300, height: 420 }
    const anchor = captureAnchor(ARENA, bounds, 1)
    const moved = { ...ARENA, x: ARENA.x + 250, y: ARENA.y - 40 }
    const applied = applyAnchor(anchor, moved, scaledOpts(bounds.height))
    expect(applied.bounds.x).toBe(bounds.x + 250)
    expect(applied.bounds.y).toBe(bounds.y - 40)
    expect(applied.bounds.width).toBe(bounds.width)
    expect(applied.zoom).toBe(1)
  })

  it('keeps a right/bottom-docked panel glued to that edge through a resize', () => {
    // Panel flush inside Arena's bottom-right corner
    const bounds: Rect = {
      x: ARENA.x + ARENA.width - 300,
      y: ARENA.y + ARENA.height - 420,
      width: 300,
      height: 420
    }
    const anchor = captureAnchor(ARENA, bounds, 1)
    const grown = { ...ARENA, width: 1920, height: 1080 } // +20% height
    const applied = applyAnchor(anchor, grown, scaledOpts(bounds.height))
    // Still flush at the new bottom-right, with the panel scaled up 20%
    expect(applied.zoom).toBeCloseTo(1.2, 5)
    expect(applied.bounds.width).toBe(360)
    expect(applied.bounds.height).toBe(504)
    expect(applied.bounds.x + applied.bounds.width).toBe(grown.x + grown.width)
    expect(applied.bounds.y + applied.bounds.height).toBe(grown.y + grown.height)
  })

  it('scales zoom with Arena height and clamps to the zoom limits', () => {
    // Wide panel so the min-size floor (240/720) sits below ZOOM_MIN
    const bounds: Rect = { x: 200, y: 100, width: 720, height: 900 }
    const anchor = captureAnchor(ARENA, bounds, 1)
    const tiny = { ...ARENA, height: 200 } // ratio 0.22 -> clamp
    expect(applyAnchor(anchor, tiny, scaledOpts(900)).zoom).toBe(ZOOM_MIN)
    const huge = { ...ARENA, height: 9000 } // ratio 10 -> clamp
    expect(applyAnchor(anchor, huge, scaledOpts(900)).zoom).toBe(ZOOM_MAX)
  })

  it('floors zoom where scaling would push the panel under its size minimums', () => {
    // 300-wide panel: width bottoms out at 240 -> zoom floors at 0.8, so the
    // window size and CSS zoom stay consistent (no content reflow at the min)
    const bounds: Rect = { x: 200, y: 100, width: 300, height: 400 }
    const anchor = captureAnchor(ARENA, bounds, 1)
    const tiny = { ...ARENA, height: 200 }
    const applied = applyAnchor(anchor, tiny, scaledOpts(400))
    expect(applied.zoom).toBeCloseTo(240 / 300, 5)
    expect(applied.bounds.width).toBe(240)
  })

  it('passes the current height through when scaleHeight is false', () => {
    // Draft verdict/mini: the renderer owns the height
    const bounds: Rect = { x: 200, y: 100, width: 300, height: 400 }
    const anchor = captureAnchor(ARENA, bounds, 1)
    const grown = { ...ARENA, height: 1080 }
    const applied = applyAnchor(anchor, grown, { scaleHeight: false, currentHeight: 512 })
    expect(applied.bounds.height).toBe(512)
    expect(applied.bounds.width).toBe(Math.round(300 * 1.2))
  })

  it('anchors a panel docked outside Arena via a negative fraction', () => {
    // Docked flush against Arena's outside-right edge
    const bounds: Rect = { x: ARENA.x + ARENA.width, y: 50, width: 300, height: 400 }
    const anchor = captureAnchor(ARENA, bounds, 1)
    expect(anchor.fx).toBeLessThan(0)
    const moved = { ...ARENA, x: ARENA.x + 100 }
    const applied = applyAnchor(anchor, moved, scaledOpts(400))
    expect(applied.bounds.x).toBe(bounds.x + 100)
  })

  it('keeps an outside-docked panel flush through a width-only Arena resize', () => {
    // Outside offsets are panel-sized, not Arena-sized: a flush outside dock
    // must not drift when Arena's width changes without a zoom change
    const bounds: Rect = { x: ARENA.x + ARENA.width, y: 50, width: 300, height: 400 }
    const anchor = captureAnchor(ARENA, bounds, 1)
    const wider = { ...ARENA, width: 2000 } // height unchanged -> zoom 1
    const applied = applyAnchor(anchor, wider, scaledOpts(400))
    expect(applied.bounds.x).toBe(wider.x + wider.width) // still flush
  })

  it('keeps an outside-docked panel flush through a scaling resize', () => {
    const bounds: Rect = { x: ARENA.x + ARENA.width, y: 50, width: 300, height: 400 }
    const anchor = captureAnchor(ARENA, bounds, 1)
    const grown = { x: 100, y: 50, width: 1920, height: 1080 } // zoom 1.2
    const applied = applyAnchor(anchor, grown, scaledOpts(400))
    expect(applied.bounds.width).toBe(360)
    expect(applied.bounds.x).toBe(grown.x + grown.width) // flush at new edge
  })

  it('starts from a non-1 zoom baseline without a jump', () => {
    const bounds: Rect = { x: 200, y: 100, width: 360, height: 480 } // already at zoom 1.2
    const anchor = captureAnchor(ARENA, bounds, 1.2)
    const same = applyAnchor(anchor, ARENA, scaledOpts(bounds.height))
    expect(same.zoom).toBeCloseTo(1.2, 5)
    expect(same.bounds).toEqual(bounds)
    // Arena shrinks back 1/1.2: zoom returns toward 1
    const shrunk = { ...ARENA, height: 750 }
    expect(applyAnchor(anchor, shrunk, scaledOpts(bounds.height)).zoom).toBeCloseTo(1, 2)
  })

  it('never emits a width below the panel minimum', () => {
    const bounds: Rect = { x: 200, y: 100, width: PANEL_MIN_WIDTH, height: 400 }
    const anchor = captureAnchor(ARENA, bounds, 1)
    const small = { ...ARENA, height: 540 } // 0.6x
    const applied = applyAnchor(anchor, small, scaledOpts(400))
    expect(applied.bounds.width).toBe(PANEL_MIN_WIDTH)
  })
})

describe('clampPanelSize', () => {
  it('clamps to the base limits at zoom 1', () => {
    expect(clampPanelSize(10_000, 10_000)).toEqual({ width: PANEL_MAX_WIDTH, height: 1200 })
    expect(clampPanelSize(0, 0)).toEqual({ width: PANEL_MIN_WIDTH, height: 36 })
  })

  it('raises the ceiling with zoom but never lowers it below the base', () => {
    expect(clampPanelSize(10_000, 500, 1.5).width).toBe(Math.round(PANEL_MAX_WIDTH * 1.5))
    // Zoomed out: ceiling stays at the base maximum
    expect(clampPanelSize(10_000, 500, 0.6).width).toBe(PANEL_MAX_WIDTH)
  })
})

describe('snapping', () => {
  const WORK_AREA: Rect = { x: 0, y: 33, width: 1512, height: 949 }
  const SIZE = { width: 300, height: 400 }

  it('offers only work-area edges without an Arena rect', () => {
    const c = snapCandidates(WORK_AREA, SIZE, null)
    expect(c.x).toEqual([0, 1512 - 300])
    expect(c.y).toEqual([33, 33 + 949 - 400])
  })

  it('adds inside and outside-docked Arena edges when Arena is live', () => {
    const arena: Rect = { x: 100, y: 50, width: 800, height: 600 }
    const c = snapCandidates(WORK_AREA, SIZE, arena)
    expect(c.x).toContain(100)        // inside-left
    expect(c.x).toContain(600)        // inside-right (900 - 300)
    expect(c.x).toContain(900)        // docked outside-right
    expect(c.x).toContain(-200)       // docked outside-left
    expect(c.y).toContain(50)         // inside-top
    expect(c.y).toContain(250)        // inside-bottom (650 - 400)
  })

  it('snapAxis pulls within the threshold and lets go beyond it', () => {
    expect(snapAxis(12, [0, 500])).toBe(0)             // 12px away -> snap
    expect(snapAxis(SNAP_THRESHOLD + 1, [0, 500])).toBe(SNAP_THRESHOLD + 1)
    expect(snapAxis(495, [0, 500])).toBe(500)          // nearest wins
    expect(snapAxis(250, [0, 500])).toBe(250)          // mid-air stays free
  })
})

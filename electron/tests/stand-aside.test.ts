import { describe, expect, it } from 'vitest'
import {
  CHROME_BAND_FRACTION, CHROME_DWELL_MS, LEAVE_GRACE_MS, WINDOW_MOVE_GRACE_MS,
  StandAside, inChromeBand
} from '../main/overlay/stand-aside'

const arena = { width: 1512, height: 949 }
const gear = { x: 1478, y: 100 }
const pack = { x: 700, y: 500 }

describe('inChromeBand', () => {
  it("covers Arena's menu bar but not the title bar or the pack", () => {
    expect(inChromeBand(gear, arena)).toBe(true)
    expect(inChromeBand({ x: 95, y: 96 }, arena)).toBe(true) // Home
    expect(inChromeBand({ x: 700, y: 20 }, arena)).toBe(false) // title bar: drag handle
    expect(inChromeBand({ x: 756, y: arena.height * CHROME_BAND_FRACTION + 1 }, arena)).toBe(false)
    expect(inChromeBand(pack, arena)).toBe(false)
  })

  it('follows the letterboxed content box on a wide window', () => {
    const wide = { width: 2400, height: 900 }
    expect(inChromeBand({ x: 60, y: 90 }, wide)).toBe(false) // letterbox gutter
    expect(inChromeBand({ x: 1200, y: 90 }, wide)).toBe(true)
  })

  it('ignores degenerate rects', () => {
    expect(inChromeBand({ x: 10, y: 10 }, { width: 0, height: 0 })).toBe(false)
  })
})

describe('StandAside', () => {
  it('steps aside only after a dwell, and comes back on its own', () => {
    const s = new StandAside()
    expect(s.sample(pack, arena, 0)).toBe(false)
    // Sweeping through the band does nothing.
    expect(s.sample(gear, arena, 10)).toBe(false)
    expect(s.sample(pack, arena, 120)).toBe(false)
    expect(s.active).toBe(false)
    // Resting there steps aside.
    expect(s.sample(gear, arena, 200)).toBe(false)
    expect(s.sample(gear, arena, 200 + CHROME_DWELL_MS)).toBe(true)
    expect(s.active).toBe(true)
    // Coming back down restores after the grace, not instantly (no flicker).
    const left = 200 + CHROME_DWELL_MS
    expect(s.sample(pack, arena, left + 100)).toBe(false)
    expect(s.active).toBe(true)
    expect(s.sample(pack, arena, left + LEAVE_GRACE_MS + 1)).toBe(true)
    expect(s.active).toBe(false)
  })

  it('never hides for longer than the grace once the cursor leaves', () => {
    const s = new StandAside()
    s.sample(gear, arena, 0)
    s.sample(gear, arena, CHROME_DWELL_MS)
    expect(s.active).toBe(true)
    s.sample(pack, arena, CHROME_DWELL_MS + LEAVE_GRACE_MS + 1)
    expect(s.active).toBe(false)
  })

  it('stays out of the way while the cursor rests in the menu bar', () => {
    const s = new StandAside()
    s.sample(gear, arena, 0)
    s.sample(gear, arena, CHROME_DWELL_MS)
    for (const t of [1_000, 5_000, 30_000]) {
      s.sample(gear, arena, t)
      expect(s.active).toBe(true)
    }
  })

  it('comes back and holds off while the window is dragged or resized', () => {
    const s = new StandAside()
    s.sample(gear, arena, 0)
    s.sample(gear, arena, CHROME_DWELL_MS)
    expect(s.active).toBe(true)
    expect(s.noteWindowMoved(1_000)).toBe(true)
    expect(s.active).toBe(false)
    // Dragging holds the cursor near the band: it must not latch mid-drag.
    expect(s.sample(gear, arena, 1_100)).toBe(false)
    expect(s.sample(gear, arena, 1_100 + CHROME_DWELL_MS)).toBe(false)
    expect(s.active).toBe(false)
    // After the drag, resting there works again.
    const after = 1_000 + WINDOW_MOVE_GRACE_MS + 10
    expect(s.sample(gear, arena, after)).toBe(false)
    expect(s.sample(gear, arena, after + CHROME_DWELL_MS)).toBe(true)
  })

  it('release brings the overlay straight back', () => {
    const s = new StandAside()
    s.sample(gear, arena, 0)
    s.sample(gear, arena, CHROME_DWELL_MS)
    expect(s.release()).toBe(true)
    expect(s.active).toBe(false)
    expect(s.release()).toBe(false)
  })
})

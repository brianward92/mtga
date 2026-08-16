import { describe, expect, it } from 'vitest'
import { CHROME_BAND_FRACTION, STAND_ASIDE_TIMEOUT_MS, StandAside, inChromeBand } from '../main/overlay/stand-aside'

const arena = { width: 1512, height: 949 }

describe('inChromeBand', () => {
  it('covers Arena\'s top menu bar across the content box', () => {
    expect(inChromeBand({ x: 1478, y: 100 }, arena)).toBe(true) // the gear
    expect(inChromeBand({ x: 95, y: 96 }, arena)).toBe(true) // Home
    expect(inChromeBand({ x: 756, y: arena.height * CHROME_BAND_FRACTION + 1 }, arena)).toBe(false)
    expect(inChromeBand({ x: 756, y: 500 }, arena)).toBe(false) // the pack
  })

  it('follows the letterboxed content box on a wide window', () => {
    const wide = { width: 2400, height: 900 }
    expect(inChromeBand({ x: 60, y: 50 }, wide)).toBe(false) // letterbox gutter
    expect(inChromeBand({ x: 1200, y: 50 }, wide)).toBe(true)
  })

  it('ignores degenerate rects and points above the window', () => {
    expect(inChromeBand({ x: 10, y: 10 }, { width: 0, height: 0 })).toBe(false)
    expect(inChromeBand({ x: 100, y: -5 }, arena)).toBe(false)
  })
})

describe('StandAside', () => {
  it('latches on chrome entry and holds while the cursor moves away', () => {
    const s = new StandAside()
    expect(s.sample({ x: 756, y: 500 }, arena, 0)).toBe(false)
    expect(s.active).toBe(false)
    expect(s.sample({ x: 1478, y: 100 }, arena, 10)).toBe(true)
    expect(s.active).toBe(true)
    // Moving into the middle of the screen (an open Options panel) keeps it.
    expect(s.sample({ x: 700, y: 500 }, arena, 2000)).toBe(false)
    expect(s.active).toBe(true)
  })

  it('expires after the timeout and can be released early', () => {
    const s = new StandAside()
    s.sample({ x: 1478, y: 100 }, arena, 0)
    expect(s.sample({ x: 700, y: 500 }, arena, STAND_ASIDE_TIMEOUT_MS - 1)).toBe(false)
    expect(s.sample({ x: 700, y: 500 }, arena, STAND_ASIDE_TIMEOUT_MS)).toBe(true)
    expect(s.active).toBe(false)

    s.sample({ x: 1478, y: 100 }, arena, 100)
    expect(s.release()).toBe(true)
    expect(s.active).toBe(false)
    expect(s.release()).toBe(false)
  })
})

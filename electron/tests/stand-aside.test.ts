import { describe, expect, it } from 'vitest'
import {
  CHROME_BAND_FRACTION, WINDOW_MOVE_GRACE_MS, StandAside, inChromeBand
} from '../main/overlay/stand-aside'
import { sidebarShellFrame } from '../shared/layout'

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

  it('excuses our own sidebar, whose top edge reaches into the band', () => {
    const sidebar = sidebarShellFrame(arena)
    // Resting on the top of the pool must never read as reaching for Arena's
    // menus — that hid the whole overlay until the drafter returned to the pack.
    expect(inChromeBand({ x: sidebar.x + 40, y: sidebar.y + 2 }, arena)).toBe(false)
    // Arena's gear sits just above the sidebar and still steps us aside.
    expect(inChromeBand({ x: sidebar.x + 40, y: sidebar.y - 2 }, arena)).toBe(true)
  })

  it('recognizes the higher gear position without a fullscreen title bar', () => {
    expect(inChromeBand({ x: 1368, y: 32 }, { ...arena, titleBarHeight: 0 })).toBe(true)
    expect(inChromeBand({ x: 1368, y: 32 }, { ...arena, titleBarHeight: 28 })).toBe(false)
  })

  it('ignores degenerate rects', () => {
    expect(inChromeBand({ x: 10, y: 10 }, { width: 0, height: 0 })).toBe(false)
  })
})

describe('StandAside', () => {
  it('ignores the cursor entirely: only a click steps aside', () => {
    const s = new StandAside()
    // Hovering the gear for any length of time is not leaving the draft screen.
    expect(s.active).toBe(false)
    expect(s.noteClick(pack, arena, 0)).toBe(false)
    expect(s.active).toBe(false)
    // Clicking the gear opens Arena's own UI over the draft.
    expect(s.noteClick(gear, arena, 100)).toBe(true)
    expect(s.active).toBe(true)
  })

  it('keeps Graphics controls above DraftFM until both settings pages close', () => {
    const s = new StandAside()
    s.noteClick(gear, arena, 0)
    expect(s.noteClick({ x: 756, y: 440 }, arena, 100)).toBe(false)
    expect(s.noteClick({ x: 850, y: 400 }, arena, 200)).toBe(false)
    expect(s.active).toBe(true)
    expect(s.noteEscape()).toBe(false) // Graphics -> Options
    expect(s.active).toBe(true)
    expect(s.noteEscape()).toBe(true) // Options -> draft
    expect(s.active).toBe(false)
  })

  it('keeps settings exclusive across fullscreen geometry changes', () => {
    const s = new StandAside()
    s.noteClick(gear, arena, 0)
    expect(s.noteWindowMoved(1_000)).toBe(false)
    expect(s.active).toBe(true)
    s.noteClick(pack, arena, 1_100)
    expect(s.active).toBe(true)
  })

  it('suppresses title-bar dragging without preventing later gear clicks', () => {
    const s = new StandAside()
    s.noteWindowMoved(1_000)
    expect(s.noteClick(gear, arena, 1_100)).toBe(false)
    expect(s.noteClick(gear, arena, 1_000 + WINDOW_MOVE_GRACE_MS + 10)).toBe(true)
  })

  it('handles Escape opening and closing Options without a mouse click', () => {
    const s = new StandAside()
    expect(s.noteEscape()).toBe(true)
    expect(s.active).toBe(true)
    expect(s.noteEscape()).toBe(true)
    expect(s.active).toBe(false)
  })

  it('release brings the overlay straight back', () => {
    const s = new StandAside()
    s.noteClick(gear, arena, 0)
    expect(s.release()).toBe(true)
    expect(s.active).toBe(false)
    expect(s.release()).toBe(false)
  })
})

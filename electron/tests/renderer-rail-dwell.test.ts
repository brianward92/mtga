import { describe, expect, it } from 'vitest'
import {
  EMPTY_RAIL_DWELL,
  RAIL_DWELL_MS,
  advanceRailDwell,
  pointInRailBounds,
  railDwellDelay
} from '../renderer/overlay/rail-dwell'

describe('rail panel dwell', () => {
  it('yields only after the cursor rests on the same panel for 250 ms', () => {
    const entered = advanceRailDwell(EMPTY_RAIL_DWELL, 'hud', 1_000)
    expect(entered).toEqual({ target: 'hud', since: 1_000, yielded: null })
    expect(advanceRailDwell(entered, 'hud', 1_000 + RAIL_DWELL_MS - 1).yielded).toBeNull()
    expect(advanceRailDwell(entered, 'hud', 1_000 + RAIL_DWELL_MS).yielded).toBe('hud')
  })

  it('restarts the dwell when the cursor moves to the other rail panel', () => {
    const hud = advanceRailDwell(EMPTY_RAIL_DWELL, 'hud', 100)
    const sheet = advanceRailDwell(hud, 'sheet', 300)
    expect(sheet).toEqual({ target: 'sheet', since: 300, yielded: null })
    expect(advanceRailDwell(sheet, 'sheet', 549).yielded).toBeNull()
    expect(advanceRailDwell(sheet, 'sheet', 550).yielded).toBe('sheet')
  })

  it('clears a yield when the cursor leaves the body for a button or Arena', () => {
    const entered = advanceRailDwell(EMPTY_RAIL_DWELL, 'sheet', 0)
    const yielded = advanceRailDwell(entered, 'sheet', RAIL_DWELL_MS)
    expect(advanceRailDwell(yielded, null, RAIL_DWELL_MS + 1)).toBe(EMPTY_RAIL_DWELL)
  })

  it('keeps a yielded panel armed by bounds after CSS removes it from hit-testing', () => {
    const bounds = { left: 100, top: 200, right: 300, bottom: 500 }
    expect(pointInRailBounds(100, 200, bounds)).toBe(true)
    expect(pointInRailBounds(299, 499, bounds)).toBe(true)
    expect(pointInRailBounds(300, 499, bounds)).toBe(false)
    expect(pointInRailBounds(299, 500, bounds)).toBe(false)

    const entered = advanceRailDwell(EMPTY_RAIL_DWELL, 'sheet', 0)
    const yielded = advanceRailDwell(entered, 'sheet', RAIL_DWELL_MS)
    expect(advanceRailDwell(yielded, 'sheet', RAIL_DWELL_MS + 1)).toBe(yielded)
  })

  it('reports only the remaining delay for a pending dwell', () => {
    const entered = advanceRailDwell(EMPTY_RAIL_DWELL, 'hud', 50)
    expect(railDwellDelay(entered, 125)).toBe(175)
    const yielded = advanceRailDwell(entered, 'hud', 300)
    expect(railDwellDelay(yielded, 300)).toBeNull()
    expect(railDwellDelay(EMPTY_RAIL_DWELL, 300)).toBeNull()
  })
})

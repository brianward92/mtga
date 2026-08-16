import { describe, expect, it } from 'vitest'
import {
  EMPTY_RAIL_DWELL,
  RAIL_DWELL_MS,
  advanceRailDwell,
  pointInRailBounds,
  railDwellDelay,
  railDwellIncludes,
  railDwellTarget,
  railTopology,
  reconcileRailDwellTopology
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

  it('treats a joined HUD and sheet as one continuous dwell target', () => {
    const fromHud = advanceRailDwell(EMPTY_RAIL_DWELL, railDwellTarget('hud', true), 100)
    const crossedJoin = advanceRailDwell(fromHud, railDwellTarget('sheet', true), 200)

    expect(crossedJoin).toBe(fromHud)
    expect(advanceRailDwell(crossedJoin, 'rail', 350).yielded).toBe('rail')
    expect(railDwellIncludes('rail', 'hud')).toBe(true)
    expect(railDwellIncludes('rail', 'sheet')).toBe(true)
  })

  it('keeps standalone HUD and sheet yields independent', () => {
    expect(railDwellTarget('hud', false)).toBe('hud')
    expect(railDwellTarget('sheet', false)).toBe('sheet')
    expect(railDwellIncludes('hud', 'hud')).toBe(true)
    expect(railDwellIncludes('hud', 'sheet')).toBe(false)
    expect(railDwellIncludes('sheet', 'hud')).toBe(false)
    expect(railDwellIncludes('sheet', 'sheet')).toBe(true)
  })

  it('restarts a standalone dwell when the sheet joins the HUD', () => {
    const hud = advanceRailDwell(EMPTY_RAIL_DWELL, railDwellTarget('hud', false), 100)
    const joined = advanceRailDwell(hud, railDwellTarget('hud', true), 200)

    expect(joined).toEqual({ target: 'rail', since: 200, yielded: null })
    expect(advanceRailDwell(joined, 'rail', 449).yielded).toBeNull()
    expect(advanceRailDwell(joined, 'rail', 450).yielded).toBe('rail')
  })

  it('clears a joined yield before arming the remaining standalone panel', () => {
    const rail = advanceRailDwell(EMPTY_RAIL_DWELL, railDwellTarget('sheet', true), 100)
    const yieldedRail = advanceRailDwell(rail, 'rail', 350)
    const standaloneSheet = advanceRailDwell(yieldedRail, railDwellTarget('sheet', false), 400)

    expect(yieldedRail.yielded).toBe('rail')
    expect(standaloneSheet).toEqual({ target: 'sheet', since: 400, yielded: null })
    expect(advanceRailDwell(standaloneSheet, 'sheet', 649).yielded).toBeNull()
    expect(advanceRailDwell(standaloneSheet, 'sheet', 650).yielded).toBe('sheet')
  })

  it('clears a joined yield when the cursor leaves the body for a button or Arena', () => {
    const entered = advanceRailDwell(EMPTY_RAIL_DWELL, 'rail', 0)
    const yielded = advanceRailDwell(entered, 'rail', RAIL_DWELL_MS)
    expect(advanceRailDwell(yielded, null, RAIL_DWELL_MS + 1)).toBe(EMPTY_RAIL_DWELL)
  })

  it('invalidates both pending and yielded state when rail topology changes', () => {
    const pending = advanceRailDwell(EMPTY_RAIL_DWELL, 'rail', 100)
    const yielded = advanceRailDwell(pending, 'rail', 350)

    expect(railTopology(true, true, true)).toBe('rail')
    expect(railTopology(true, true, false)).toBe('split')
    expect(railTopology(true, false, false)).toBe('hud')
    expect(railTopology(false, true, false)).toBe('sheet')
    expect(railTopology(false, false, false)).toBe('none')
    expect(reconcileRailDwellTopology(pending, 'rail', 'hud')).toBe(EMPTY_RAIL_DWELL)
    expect(reconcileRailDwellTopology(yielded, 'rail', 'sheet')).toBe(EMPTY_RAIL_DWELL)
    expect(reconcileRailDwellTopology(yielded, 'rail', 'rail')).toBe(yielded)
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

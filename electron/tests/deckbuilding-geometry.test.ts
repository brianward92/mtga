import { describe, expect, it } from 'vitest'
import { sidebarShellFrame } from '../shared/layout'
import { sidebarPanelFrame } from '../renderer/overlay/sidebar'
import { pointOnSidebar } from '../main/overlay/sidebar-pointer'
import { inChromeBand } from '../main/overlay/stand-aside'

const arena = { width: 1280, height: 748, titleBarHeight: 28 }

describe('deckbuilding sidebar geometry', () => {
  it('keeps the rightmost pool card and next-page arrow outside visual and input ownership', () => {
    const rail = sidebarShellFrame(arena, 'right', 'complete')
    const panel = sidebarPanelFrame(arena, 'right', 'complete')
    expect(rail.x).toBeCloseTo(1004.8)
    expect(rail.width).toBeCloseTo(275.2)
    expect(panel.width).toBeCloseTo(263.2)
    for (const x of [0.73, 0.76, 0.767, 0.784]) {
      const poolPoint = { x: x * arena.width, y: .602 * arena.height }
      expect(poolPoint.x).toBeLessThan(rail.x)
      expect(pointOnSidebar(poolPoint, arena, 'right', 'complete')).toBe(false)
    }
    expect(pointOnSidebar({ x: rail.x + 1, y: rail.y + 1 }, arena, 'right', 'complete')).toBe(true)
  })

  it('moves the same narrow rail to the left for cuts without covering the Arena deck', () => {
    const right = sidebarShellFrame(arena, 'right', 'complete')
    const left = sidebarShellFrame(arena, 'left', 'complete')
    expect(left.x).toBe(0)
    expect(left.width).toBe(right.width)
    expect(pointOnSidebar({ x: .83 * arena.width, y: .4 * arena.height }, arena, 'left', 'complete')).toBe(false)
  })

  it('uses window width across aspect ratios and keeps draft geometry unchanged', () => {
    for (const view of [arena, { width: 1512, height: 949 }, { width: 1920, height: 1080 }]) {
      const deck = sidebarShellFrame(view, 'right', 'complete')
      expect(deck.x / view.width).toBeCloseTo(.785)
      expect(deck.width / view.width).toBeCloseTo(.215)
      expect(sidebarShellFrame(view, 'right', 'active')).toEqual(sidebarShellFrame(view))
    }
  })

  it('keeps the same deckbuilder horizontal bounds without a native title bar', () => {
    const a = sidebarShellFrame(arena, 'right', 'complete')
    const b = sidebarShellFrame({ ...arena, height: arena.height - 28, titleBarHeight: 0 }, 'right', 'complete')
    expect(b.x).toBe(a.x)
    expect(b.width).toBe(a.width)
    expect(b.y).toBeCloseTo(a.y - 28)
    expect(b.height).toBeCloseTo(a.height)
  })

  it('only exempts the actual narrow sidebar from Arena menu clicks', () => {
    const insideOldWideRail = { x: .76 * arena.width, y: .13 * arena.height }
    expect(inChromeBand(insideOldWideRail, arena, 'right', 'complete')).toBe(true)
    expect(inChromeBand({ ...insideOldWideRail, x: .82 * arena.width }, arena, 'right', 'complete')).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import { packLayout, sidebarShellFrame, DEFAULT_CALIBRATION } from '../shared/layout'

describe('fullscreen content coordinates', () => {
  it('aligns the same drawable area with and without a native title bar', () => {
    const windowed = packLayout({ width: 1512, height: 949, titleBarHeight: 28 }, 14, DEFAULT_CALIBRATION)
    const full = packLayout({ width: 1512, height: 921, titleBarHeight: 0 }, 14, DEFAULT_CALIBRATION)
    full.cards.forEach((slot, i) => {
      expect(slot.card.x).toBeCloseTo(windowed.cards[i].card.x)
      expect(slot.card.y).toBeCloseTo(windowed.cards[i].card.y - 28)
      expect(slot.card.height).toBeCloseTo(windowed.cards[i].card.height)
    })
  })
  it('keeps the opaque sidebar anchored to the same game content edge', () => {
    const a = sidebarShellFrame({ width: 1512, height: 949, titleBarHeight: 28 })
    const b = sidebarShellFrame({ width: 1512, height: 921, titleBarHeight: 0 })
    expect(b.x).toBe(a.x)
    expect(b.y).toBe(a.y - 28)
    expect(b.height).toBe(a.height)
  })
})

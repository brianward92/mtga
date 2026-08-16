import { describe, expect, it } from 'vitest'
import { sheetAnchor } from '../renderer/overlay/sheet'

describe('pool sheet rail geometry', () => {
  it.each([
    ['tl', { x: 30, y: 209, width: 333, height: 300 }, { top: 509, bottom: 86, height: 354 }],
    ['tr', { x: 1_149, y: 209, width: 333, height: 300 }, { top: 509, bottom: 86, height: 354 }],
    ['bl', { x: 30, y: 600, width: 333, height: 330 }, { top: 209, bottom: 349, height: 391 }],
    ['br', { x: 1_149, y: 600, width: 333, height: 330 }, { top: 209, bottom: 349, height: 391 }]
  ] as const)('keeps a %s sheet inside a 1512x949 Arena rail', (corner, hud, expected) => {
    const anchor = sheetAnchor(949, corner, hud)

    expect(anchor).toEqual(expected)
    expect(anchor.bottom).toBeGreaterThanOrEqual(949 * 0.09)
    expect(anchor.top + anchor.height).toBeLessThanOrEqual(949 * 0.91)
    expect(anchor.top).toBeGreaterThanOrEqual(0)
    expect(anchor.top + anchor.height + anchor.bottom).toBe(949)
  })

  it('never overlaps a tall HUD when no sheet height remains', () => {
    const anchor = sheetAnchor(949, 'tr', { x: 1_149, y: 700, width: 333, height: 200 })

    expect(anchor).toEqual({ top: 863, bottom: 86, height: 0 })
    expect(anchor.top).toBeLessThanOrEqual(949 - anchor.bottom)
  })

  it.each([
    ['tl', { x: 0, y: 4, width: 10, height: 10 }, { top: 4, bottom: 1, height: 0 }],
    ['tr', { x: 0, y: 4, width: 10, height: 10 }, { top: 4, bottom: 1, height: 0 }],
    ['bl', { x: 0, y: -4, width: 10, height: 10 }, { top: 1, bottom: 4, height: 0 }],
    ['br', { x: 0, y: -4, width: 10, height: 10 }, { top: 1, bottom: 4, height: 0 }]
  ] as const)('clamps %s stacking in an extremely small view', (corner, hud, expected) => {
    expect(sheetAnchor(5, corner, hud)).toEqual(expected)
  })
})

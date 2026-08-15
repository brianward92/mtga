import { describe, expect, it } from 'vitest'
import { hoveredCardIndex, intersects, predictPopout } from '../renderer/badges/hover'

const view = { width: 1512, height: 949 }
const card = { x: 843, y: 447, width: 148, height: 212 } // Impossible Inferno cell (pts)

describe('hover pop-out prediction', () => {
  it('finds the hovered cell', () => {
    const cards = [{ x: 0, y: 0, width: 10, height: 10 }, card]
    expect(hoveredCardIndex({ x: 900, y: 500 }, cards)).toBe(1)
    expect(hoveredCardIndex({ x: 5, y: 5 }, cards)).toBe(0)
    expect(hoveredCardIndex({ x: 300, y: 300 }, cards)).toBe(-1)
  })

  it('places the preview to the right, ~2.1x, vertically centred', () => {
    const [preview] = predictPopout(card, view)
    expect(preview.x).toBeGreaterThan(card.x + card.width)
    expect(preview.width).toBeCloseTo(card.width * 2.1, 5)
    expect(preview.y + preview.height / 2).toBeCloseTo(card.y + card.height / 2, 5)
    // Measured screen: preview spanned roughly x 1020..1330 pt
    expect(preview.x).toBeGreaterThan(1000)
    expect(preview.x + preview.width).toBeLessThan(1360)
  })

  it('flips left when the preview would run off the right edge', () => {
    const rightCard = { ...card, x: 1300 }
    const [preview] = predictPopout(rightCard, view)
    expect(preview.x + preview.width).toBeLessThanOrEqual(rightCard.x)
  })

  it('clamps vertically inside the window', () => {
    const [top] = predictPopout({ ...card, y: 0 }, view)
    expect(top.y).toBe(0)
    const [bottom] = predictPopout({ ...card, y: 900 }, view)
    expect(bottom.y + bottom.height).toBeLessThanOrEqual(view.height)
  })

  it('intersects is symmetric and strict on edges', () => {
    const a = { x: 0, y: 0, width: 10, height: 10 }
    expect(intersects(a, { x: 10, y: 0, width: 5, height: 5 })).toBe(false)
    expect(intersects(a, { x: 9, y: 9, width: 5, height: 5 })).toBe(true)
  })
})

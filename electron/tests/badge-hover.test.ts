import { describe, expect, it } from 'vitest'
import { hoveredCardIndex, intersects, predictPopout } from '../shared/hover'

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

  it('keeps the portrait prediction unchanged when split mode is omitted or false', () => {
    expect(predictPopout(card, view, { split: false })).toEqual(predictPopout(card, view))
  })

  it('predicts the landscape preview and rules box for Rooms and split cards', () => {
    const leftCard = { ...card, x: 100 }
    const [preview, rulesBox] = predictPopout(leftCard, view, { split: true })

    expect(preview).toEqual({
      x: leftCard.x + leftCard.width + leftCard.width * 0.5,
      y: leftCard.y - leftCard.height * 0.35,
      width: leftCard.width * 5,
      height: leftCard.height * 2.35
    })
    expect(rulesBox.x).toBe(leftCard.x)
    expect(rulesBox.x + rulesBox.width).toBe(preview.x + preview.width)
    expect(rulesBox.y).toBeLessThan(preview.y)
  })

  it('flips a landscape split preview left when it would overflow', () => {
    const rightCard = { ...card, x: 1300 }
    const [preview] = predictPopout(rightCard, view, { split: true })
    expect(preview.x + preview.width).toBe(rightCard.x - rightCard.width * 0.5)
  })

  it('intersects is symmetric and strict on edges', () => {
    const a = { x: 0, y: 0, width: 10, height: 10 }
    expect(intersects(a, { x: 10, y: 0, width: 5, height: 5 })).toBe(false)
    expect(intersects(a, { x: 9, y: 9, width: 5, height: 5 })).toBe(true)
  })
})

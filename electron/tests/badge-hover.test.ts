import { describe, expect, it } from 'vitest'
import {
  HoverPreviewIntent,
  hoveredCardIndex,
  isRightmostGridColumn,
  predictPopout
} from '../shared/hover'
import { DEFAULT_CALIBRATION, packLayout } from '../shared/layout'

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

  it('matches Arena placement across the actual 1512x949 five-column grid', () => {
    const grid = packLayout(view, 14, DEFAULT_CALIBRATION).cards.map(slot => slot.card)
    const fourthColumn = grid[3]
    const bottomRow = grid[10]

    const [fourthPreview] = predictPopout(fourthColumn, view, {
      flipLeft: isRightmostGridColumn(3, DEFAULT_CALIBRATION.maxCols)
    })
    expect(fourthPreview.x).toBeGreaterThan(fourthColumn.x + fourthColumn.width)

    for (const index of [4, 9]) {
      const rightmost = grid[index]
      const [rightPreview] = predictPopout(rightmost, view, {
        flipLeft: isRightmostGridColumn(index, DEFAULT_CALIBRATION.maxCols)
      })
      expect(rightPreview.x + rightPreview.width).toBeLessThan(rightmost.x)
    }

    const [bottomPreview] = predictPopout(bottomRow, view, {
      flipLeft: isRightmostGridColumn(10, DEFAULT_CALIBRATION.maxCols)
    })
    expect(bottomPreview.y + bottomPreview.height).toBeCloseTo(view.height, 5)
    expect(bottomPreview.y).toBeLessThan(
      bottomRow.y + bottomRow.height / 2 - bottomPreview.height / 2
    )
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

  it('applies a 250 ms enter dwell and exact 120 ms leave grace', () => {
    const intent = new HoverPreviewIntent()
    expect(intent.update(2, 0)).toBe(-1)
    expect(intent.update(2, 249)).toBe(-1)
    expect(intent.update(2, 250)).toBe(2)

    expect(intent.update(-1, 251)).toBe(2)
    expect(intent.update(-1, 370)).toBe(2)
    expect(intent.update(-1, 371)).toBe(-1)
  })

  it('keeps the active preview through a brief excursion but dwells on a new cell', () => {
    const intent = new HoverPreviewIntent()
    expect(intent.update(1, 0)).toBe(-1)
    expect(intent.update(1, 350)).toBe(1)
    expect(intent.update(-1, 360)).toBe(1)
    expect(intent.update(1, 479)).toBe(1)

    expect(intent.update(2, 500)).toBe(1)
    expect(intent.update(2, 619)).toBe(1)
    expect(intent.update(2, 620)).toBe(-1)
    expect(intent.update(2, 850)).toBe(2)
  })
})

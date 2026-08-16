import { describe, expect, it } from 'vitest'
import {
  HoverPreviewIntent,
  HoverPreviewSelection,
  hoveredCardIndex,
  intersectionFraction,
  intersects,
  isRightmostGridColumn,
  predictPopout,
  previewCoveredCellIndices
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

  it('intersects is symmetric and strict on edges', () => {
    const a = { x: 0, y: 0, width: 10, height: 10 }
    expect(intersects(a, { x: 10, y: 0, width: 5, height: 5 })).toBe(false)
    expect(intersects(a, { x: 9, y: 9, width: 5, height: 5 })).toBe(true)
  })

  it('lifts neighbours only when their union overlap exceeds 15 percent', () => {
    const cells = [
      { x: 0, y: 0, width: 100, height: 100 },
      { x: 100, y: 0, width: 100, height: 100 },
      { x: 200, y: 0, width: 100, height: 100 }
    ]
    const exactThreshold = [{ x: 85, y: 0, width: 15, height: 100 }]
    expect(intersectionFraction(cells[0], exactThreshold)).toBeCloseTo(0.15, 8)
    expect(previewCoveredCellIndices(cells, 2, exactThreshold)).toEqual([])

    const overlappingRegions = [
      { x: 80, y: 0, width: 12, height: 100 },
      { x: 88, y: 0, width: 12, height: 100 },
      { x: 200, y: 0, width: 20, height: 100 }
    ]
    // The first two rectangles overlap: their union is 20%, not 24%.
    expect(intersectionFraction(cells[0], overlappingRegions)).toBeCloseTo(0.2, 8)
    // Cell 2 is the hovered card and is never lifted, despite a 20% overlap.
    expect(previewCoveredCellIndices(cells, 2, overlappingRegions)).toEqual([0])
  })

  it('applies a 350 ms enter dwell and exact 120 ms leave grace', () => {
    const intent = new HoverPreviewIntent()
    expect(intent.update(2, 0)).toBe(-1)
    expect(intent.update(2, 349)).toBe(-1)
    expect(intent.update(2, 350)).toBe(2)

    expect(intent.update(-1, 351)).toBe(2)
    expect(intent.update(-1, 470)).toBe(2)
    expect(intent.update(-1, 471)).toBe(-1)
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

  it('latches the last fully dwelled preview selection until an explicit pack reset', () => {
    const selection = new HoverPreviewSelection()
    expect(selection.update(1, 0)).toBe(-1)
    expect(selection.update(1, 349)).toBe(-1)
    expect(selection.update(1, 350)).toBe(1)

    expect(selection.update(-1, 1_000)).toBe(1)
    expect(selection.update(2, 2_000)).toBe(1)
    expect(selection.update(2, 2_349)).toBe(1)
    expect(selection.update(2, 2_350)).toBe(2)

    selection.reset()
    expect(selection.update(-1, 3_000)).toBe(-1)
  })
})

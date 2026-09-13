import { EventEmitter } from 'events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getCursorScreenPoint } = vi.hoisted(() => ({
  getCursorScreenPoint: vi.fn(() => ({ x: -1, y: -1 }))
}))
vi.mock('electron', () => ({ screen: { getCursorScreenPoint }, systemPreferences: {} }))

import type { ArenaGeometryPoller, HelperFrame } from '../main/arena-geometry'
import { LayerDetector } from '../main/overlay/layer'
import { DEFAULT_CALIBRATION, packLayout } from '../shared/layout'

class FakePoller extends EventEmitter {
  lastKnown = { x: 0, y: 0, width: 1200, height: 800 }
}

function visiblePackFrame(view: { width: number; height: number }, count: number): HelperFrame {
  const width = 120
  const height = 80
  const cards = packLayout(view, count, DEFAULT_CALIBRATION).cards.map(slot => slot.card)
  const data = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const point = { x: (x + 0.5) * view.width / width, y: (y + 0.5) * view.height / height }
      const inCard = cards.some(card =>
        point.x >= card.x && point.x < card.x + card.width &&
        point.y >= card.y && point.y < card.y + card.height
      )
      data[y * width + x] = inCard ? 180 : 50
    }
  }
  return { width, height, data }
}

function detectorFor(poller: FakePoller, active: () => boolean = () => true): LayerDetector {
  return new LayerDetector({
    poller: poller as unknown as ArenaGeometryPoller,
    packCount: () => 14,
    config: () => DEFAULT_CALIBRATION,
    active
  })
}

function hover(card: { x: number; y: number; width: number; height: number }): void {
  getCursorScreenPoint.mockReturnValue({ x: card.x + card.width / 2, y: card.y + card.height / 2 })
}

describe('LayerDetector', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    getCursorScreenPoint.mockClear()
    getCursorScreenPoint.mockReturnValue({ x: -1, y: -1 })
  })

  afterEach(() => vi.useRealTimers())

  it('runs its 50 ms cursor poll only while badges are live', () => {
    const poller = new FakePoller()
    let active = false
    const detector = detectorFor(poller, () => active)

    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(200)
    expect(getCursorScreenPoint).not.toHaveBeenCalled()

    active = true
    detector.syncActivity()
    detector.syncActivity()
    expect(vi.getTimerCount()).toBe(1)
    vi.advanceTimersByTime(200)
    expect(getCursorScreenPoint).toHaveBeenCalledTimes(4)

    active = false
    detector.syncActivity()
    expect(vi.getTimerCount()).toBe(0)
    vi.advanceTimersByTime(200)
    expect(getCursorScreenPoint).toHaveBeenCalledTimes(4)

    detector.dispose()
  })

  it('lifts every other badge and reports the preview once the cursor has rested on a card', () => {
    const poller = new FakePoller()
    poller.lastKnown = { x: 0, y: 0, width: 1512, height: 949 }
    const cards = packLayout(poller.lastKnown, 14, DEFAULT_CALIBRATION).cards.map(slot => slot.card)
    const rightmost = cards[4]
    hover(rightmost)
    const detector = detectorFor(poller)

    // The first poll lands at 50 ms; the 250 ms rest is measured from there.
    detector.syncActivity()
    vi.advanceTimersByTime(299)
    expect(detector.state.regions).toEqual([])
    expect(detector.state.cells).toEqual([])
    vi.advanceTimersByTime(1)

    const [preview] = detector.state.regions
    expect(preview.x + preview.width).toBeLessThan(rightmost.x)
    expect(detector.state.cells).toEqual([0, 1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13])
    expect(detector.state.covered).toBe(false)

    // Leaving the card restores everything after the short leave grace.
    getCursorScreenPoint.mockReturnValue({ x: -1, y: -1 })
    vi.advanceTimersByTime(200)
    expect(detector.state).toEqual({ cells: [], regions: [], covered: false })

    detector.resetBaseline()
    expect(detector.state).toEqual({ cells: [], regions: [], covered: false })
    detector.dispose()
  })

  it('steps aside the same way on the capture path, with pixel diffs on top', () => {
    const poller = new FakePoller()
    const view = poller.lastKnown
    const cards = packLayout(view, 14, DEFAULT_CALIBRATION).cards.map(slot => slot.card)
    const frame = visiblePackFrame(view, 14)
    const detector = detectorFor(poller)

    // Establish the capture baseline with no hover, then rest on cell zero.
    poller.emit('frame', frame)
    expect(detector.state).toEqual({ cells: [], regions: [], covered: false })
    hover(cards[0])
    poller.emit('frame', frame)
    vi.advanceTimersByTime(249)
    poller.emit('frame', frame)
    expect(detector.state.regions).toEqual([])
    vi.advanceTimersByTime(1)
    poller.emit('frame', frame)

    expect(detector.state.regions).toHaveLength(2)
    expect(detector.state.cells).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13])
    expect(detector.state.covered).toBe(false)

    // A darkened pack (modal) lifts everything regardless of the cursor.
    const dark: HelperFrame = { ...frame, data: frame.data.map(v => Math.round(v * 0.3)) }
    poller.emit('frame', dark)
    expect(detector.state.covered).toBe(true)

    detector.dispose()
  })
})

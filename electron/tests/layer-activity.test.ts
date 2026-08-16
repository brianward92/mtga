import { EventEmitter } from 'events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getCursorScreenPoint } = vi.hoisted(() => ({
  getCursorScreenPoint: vi.fn(() => ({ x: -1, y: -1 }))
}))
vi.mock('electron', () => ({ screen: { getCursorScreenPoint } }))

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

describe('LayerDetector fallback activity', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    getCursorScreenPoint.mockClear()
    getCursorScreenPoint.mockReturnValue({ x: -1, y: -1 })
  })

  afterEach(() => vi.useRealTimers())

  it('runs its 50 ms cursor fallback only while badges are live', () => {
    const poller = new FakePoller()
    let active = false
    const detector = new LayerDetector({
      poller: poller as unknown as ArenaGeometryPoller,
      packCount: () => 14,
      config: () => DEFAULT_CALIBRATION,
      active: () => active
    })

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

  it('uses right-column placement after dwell and reports thresholded neighbours', () => {
    const poller = new FakePoller()
    poller.lastKnown = { x: 0, y: 0, width: 1512, height: 949 }
    const cards = packLayout(poller.lastKnown, 14, DEFAULT_CALIBRATION).cards.map(slot => slot.card)
    const rightmost = cards[4]
    getCursorScreenPoint.mockReturnValue({
      x: rightmost.x + rightmost.width / 2,
      y: rightmost.y + rightmost.height / 2
    })
    const detector = new LayerDetector({
      poller: poller as unknown as ArenaGeometryPoller,
      packCount: () => 14,
      config: () => DEFAULT_CALIBRATION,
      active: () => true
    })

    detector.syncActivity()
    vi.advanceTimersByTime(399)
    expect(detector.state.regions).toEqual([])
    vi.advanceTimersByTime(1)

    const [preview] = detector.state.regions
    expect(preview.x + preview.width).toBeLessThan(rightmost.x)
    expect(detector.state.cells).toEqual([2, 3, 7, 8])
    expect(detector.state.selectedCell).toBe(4)

    getCursorScreenPoint.mockReturnValue({ x: -1, y: -1 })
    vi.advanceTimersByTime(200)
    expect(detector.state.regions).toEqual([])
    expect(detector.state.selectedCell).toBe(4)

    detector.resetBaseline()
    expect(detector.state.selectedCell).toBeNull()
    expect(detector.state.regions).toEqual([])
    detector.dispose()
  })

  it('tracks the sticky dwell selection on the capture path without predicted regions', () => {
    const poller = new FakePoller()
    const view = poller.lastKnown
    const cards = packLayout(view, 14, DEFAULT_CALIBRATION).cards.map(slot => slot.card)
    const frame = visiblePackFrame(view, 14)
    const detector = new LayerDetector({
      poller: poller as unknown as ArenaGeometryPoller,
      packCount: () => 14,
      config: () => DEFAULT_CALIBRATION,
      active: () => true
    })

    // Establish the capture baseline with no hover, then dwell on cell zero.
    poller.emit('frame', frame)
    getCursorScreenPoint.mockReturnValue({
      x: cards[0].x + cards[0].width / 2,
      y: cards[0].y + cards[0].height / 2
    })
    poller.emit('frame', frame)
    vi.advanceTimersByTime(349)
    poller.emit('frame', frame)
    expect(detector.state.selectedCell).toBeNull()
    vi.advanceTimersByTime(1)
    poller.emit('frame', frame)

    expect(detector.state.regions).toEqual([])
    expect(detector.state.selectedCell).toBe(0)
    getCursorScreenPoint.mockReturnValue({ x: -1, y: -1 })
    vi.advanceTimersByTime(500)
    poller.emit('frame', frame)
    expect(detector.state.selectedCell).toBe(0)

    detector.resetBaseline()
    expect(detector.state.selectedCell).toBeNull()
    detector.dispose()
  })
})

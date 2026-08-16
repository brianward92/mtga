import { EventEmitter } from 'events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getCursorScreenPoint } = vi.hoisted(() => ({
  getCursorScreenPoint: vi.fn(() => ({ x: -1, y: -1 }))
}))
vi.mock('electron', () => ({ screen: { getCursorScreenPoint } }))

import type { ArenaGeometryPoller } from '../main/arena-geometry'
import { LayerDetector } from '../main/overlay/layer'
import { DEFAULT_CALIBRATION, packLayout } from '../shared/layout'

class FakePoller extends EventEmitter {
  lastKnown = { x: 0, y: 0, width: 1200, height: 800 }
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
    detector.dispose()
  })
})

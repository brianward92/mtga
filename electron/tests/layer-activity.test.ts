import { EventEmitter } from 'events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getCursorScreenPoint } = vi.hoisted(() => ({
  getCursorScreenPoint: vi.fn(() => ({ x: -1, y: -1 }))
}))
vi.mock('electron', () => ({ screen: { getCursorScreenPoint } }))

import type { ArenaGeometryPoller } from '../main/arena-geometry'
import { LayerDetector } from '../main/overlay/layer'
import { DEFAULT_CALIBRATION } from '../shared/layout'

class FakePoller extends EventEmitter {
  lastKnown = { x: 0, y: 0, width: 1200, height: 800 }
}

describe('LayerDetector fallback activity', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    getCursorScreenPoint.mockClear()
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
})

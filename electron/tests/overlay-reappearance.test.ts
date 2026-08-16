import { describe, expect, it } from 'vitest'
import {
  INITIAL_OVERLAY_REAPPEARANCE,
  OVERLAY_REAPPEARANCE_DELAY_MS,
  advanceOverlayReappearance,
  mayShowOverlay,
  overlayReappearanceDelay
} from '../main/overlay/reappearance'

describe('overlay reappearance', () => {
  it('does not delay the first found observation', () => {
    const state = advanceOverlayReappearance(INITIAL_OVERLAY_REAPPEARANCE, true, 1_000)
    expect(state).toEqual({ phase: 'ready', readyAt: null })
    expect(mayShowOverlay(state, true, true)).toBe(true)
  })

  it('waits 250 ms after a lost to found transition', () => {
    const lost = advanceOverlayReappearance(INITIAL_OVERLAY_REAPPEARANCE, false, 1_000)
    const found = advanceOverlayReappearance(lost, true, 1_100)

    expect(found).toEqual({
      phase: 'waiting',
      readyAt: 1_100 + OVERLAY_REAPPEARANCE_DELAY_MS
    })
    expect(overlayReappearanceDelay(found, 1_200)).toBe(150)
    expect(advanceOverlayReappearance(found, true, 1_349)).toBe(found)

    const ready = advanceOverlayReappearance(found, true, 1_350)
    expect(ready).toEqual({ phase: 'ready', readyAt: null })
    expect(mayShowOverlay(ready, true, true)).toBe(true)
  })

  it('cancels a pending reappearance when Arena is lost again', () => {
    const lost = advanceOverlayReappearance(INITIAL_OVERLAY_REAPPEARANCE, false, 0)
    const pending = advanceOverlayReappearance(lost, true, 100)
    const lostAgain = advanceOverlayReappearance(pending, false, 200)

    expect(lostAgain).toEqual({ phase: 'lost', readyAt: null })
    expect(overlayReappearanceDelay(lostAgain, 1_000)).toBeNull()

    const foundAgain = advanceOverlayReappearance(lostAgain, true, 1_000)
    expect(foundAgain).toEqual({
      phase: 'waiting',
      readyAt: 1_000 + OVERLAY_REAPPEARANCE_DELAY_MS
    })
  })

  it('requires both user-visible content and frontmost Arena at show time', () => {
    const ready = advanceOverlayReappearance(INITIAL_OVERLAY_REAPPEARANCE, true, 0)
    expect(mayShowOverlay(ready, false, true)).toBe(false)
    expect(mayShowOverlay(ready, true, false)).toBe(false)
    expect(mayShowOverlay(ready, true, true)).toBe(true)
  })
})

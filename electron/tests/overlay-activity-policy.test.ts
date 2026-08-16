import { describe, expect, it } from 'vitest'
import { badgesAreLive, wantsOverlayContent, type OverlayActivity } from '../main/overlay/activity-policy'

const ACTIVE: OverlayActivity = {
  arenaFound: true,
  arenaFrontmost: true,
  overlayAvailable: true,
  calibrating: false,
  phase: 'active',
  cardCount: 14,
  badgesEnabled: true,
  hudEnabled: true
}

describe('main overlay activity policy', () => {
  it('requires Arena and user-visible content', () => {
    expect(wantsOverlayContent(ACTIVE)).toBe(true)
    expect(wantsOverlayContent({ ...ACTIVE, arenaFound: false })).toBe(false)
    expect(wantsOverlayContent({ ...ACTIVE, badgesEnabled: false, hudEnabled: false })).toBe(false)
    expect(wantsOverlayContent({ ...ACTIVE, phase: 'idle', badgesEnabled: true, hudEnabled: false })).toBe(false)
    expect(wantsOverlayContent({ ...ACTIVE, phase: 'idle', badgesEnabled: false, hudEnabled: true })).toBe(true)
    expect(wantsOverlayContent({ ...ACTIVE, phase: 'idle', badgesEnabled: false, hudEnabled: false, calibrating: true })).toBe(true)
  })

  it('runs badge activity only for a frontmost active pack', () => {
    expect(badgesAreLive(ACTIVE)).toBe(true)
    expect(badgesAreLive({ ...ACTIVE, overlayAvailable: false })).toBe(false)
    expect(badgesAreLive({ ...ACTIVE, arenaFrontmost: false })).toBe(false)
    expect(badgesAreLive({ ...ACTIVE, phase: 'complete' })).toBe(false)
    expect(badgesAreLive({ ...ACTIVE, cardCount: 0 })).toBe(false)
    expect(badgesAreLive({ ...ACTIVE, badgesEnabled: false })).toBe(false)
  })
})

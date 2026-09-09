import { describe, expect, it } from 'vitest'
import { badgesAreLive, isDraftScene, wantsOverlayContent, type OverlayActivity } from '../main/overlay/activity-policy'

const ACTIVE: OverlayActivity = {
  arenaFound: true,
  arenaFrontmost: true,
  overlayAvailable: true,
  calibrating: false,
  phase: 'active',
  cardCount: 14,
  badgesEnabled: true,
  hudEnabled: true,
  standAside: false,
  inDraftScene: true
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

  it('stays off the screens the draft is not on', () => {
    // A draft stays active while the drafter goes to Home or the store, so the
    // overlay drew a full pack grid over Arena's menus and swallowed clicks on
    // the buttons underneath.
    expect(wantsOverlayContent({ ...ACTIVE, inDraftScene: false })).toBe(false)
    expect(badgesAreLive({ ...ACTIVE, inDraftScene: false })).toBe(false)
    // Calibration is explicitly the drafter asking to see the grid.
    expect(wantsOverlayContent({ ...ACTIVE, inDraftScene: false, calibrating: true })).toBe(true)
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

describe('isDraftScene', () => {
  it('recognises the screens the overlay belongs on', () => {
    expect(isDraftScene('Draft')).toBe(true)
    expect(isDraftScene('DeckBuilder')).toBe(true)
    expect(isDraftScene('Home')).toBe(false)
    expect(isDraftScene('EventLanding')).toBe(false)
    expect(isDraftScene('TableDraftQueue')).toBe(false)
  })

  it('treats an unknown scene as showable', () => {
    // A session that starts mid-draft may never see a SceneChange. Going dark
    // because a log line is missing is worse than an occasional stray draw.
    expect(isDraftScene(null)).toBe(true)
    expect(isDraftScene(undefined)).toBe(true)
  })
})

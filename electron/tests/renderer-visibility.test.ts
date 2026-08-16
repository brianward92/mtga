import { describe, expect, it } from 'vitest'
import {
  badgesShouldRender,
  hudCornerForPhase,
  sheetShouldRender
} from '../renderer/overlay/visibility'

describe('overlay visibility outside drafts', () => {
  it('renders badges only for an active, non-empty pack', () => {
    expect(badgesShouldRender('active', 14, true, false, true)).toBe(true)
    expect(badgesShouldRender('idle', 14, true, false, true)).toBe(false)
    expect(badgesShouldRender('complete', 14, true, false, true)).toBe(false)
    expect(badgesShouldRender('active', 0, true, false, true)).toBe(false)
  })

  it('keeps preference, calibration, and layout gates intact', () => {
    expect(badgesShouldRender('active', 14, false, false, true)).toBe(false)
    expect(badgesShouldRender('active', 14, true, true, true)).toBe(false)
    expect(badgesShouldRender('active', 14, true, false, false)).toBe(false)
  })

  it('suppresses the sheet while idle but preserves active and complete rails', () => {
    expect(sheetShouldRender('idle', true)).toBe(false)
    expect(sheetShouldRender('active', true)).toBe(true)
    expect(sheetShouldRender('complete', true)).toBe(true)
    expect(sheetShouldRender('complete', false)).toBe(false)
  })

  it('pins only the idle glyph top-right', () => {
    expect(hudCornerForPhase('idle', 'bl')).toBe('tr')
    expect(hudCornerForPhase('active', 'bl')).toBe('bl')
    expect(hudCornerForPhase('complete', 'tl')).toBe('tl')
  })
})

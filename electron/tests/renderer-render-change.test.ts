import { describe, expect, it } from 'vitest'
import { DEFAULT_CALIBRATION } from '../shared/layout'
import {
  draftStateAdvanced,
  sameCalibrateState,
  sameLayerState,
  sameViewPrefs
} from '../renderer/overlay/render-change'

describe('renderer change detection', () => {
  it('rejects stale and duplicate draft snapshots', () => {
    expect(draftStateAdvanced(7, 8)).toBe(true)
    expect(draftStateAdvanced(7, 7)).toBe(false)
    expect(draftStateAdvanced(7, 6)).toBe(false)
  })

  it('recognizes equivalent normalized prefs', () => {
    const prefs = { badges: true, hud: true, hudCorner: 'tr' as const, layerDetection: false }
    expect(sameViewPrefs(prefs, { ...prefs })).toBe(true)
    expect(sameViewPrefs(prefs, { ...prefs, badges: false })).toBe(false)
  })

  it('recognizes equivalent layer arrays and regions', () => {
    const layer = {
      cells: [1, 3],
      regions: [{ x: 2, y: 4, width: 6, height: 8 }],
      selectedCell: 3,
      covered: false,
      hudCovered: true
    }
    expect(sameLayerState(layer, { ...layer, cells: [...layer.cells], regions: layer.regions.map(r => ({ ...r })) })).toBe(true)
    expect(sameLayerState(layer, { ...layer, cells: [1, 2] })).toBe(false)
    expect(sameLayerState(layer, { ...layer, selectedCell: null })).toBe(false)
  })

  it('recognizes equivalent calibration payloads', () => {
    const calibration = { active: false, count: 14, config: DEFAULT_CALIBRATION, arenaFound: true }
    expect(sameCalibrateState(calibration, { ...calibration, config: { ...DEFAULT_CALIBRATION } })).toBe(true)
    expect(sameCalibrateState(calibration, {
      ...calibration,
      config: { ...DEFAULT_CALIBRATION, badgeOffsetY: DEFAULT_CALIBRATION.badgeOffsetY + 0.01 }
    })).toBe(false)
  })
})

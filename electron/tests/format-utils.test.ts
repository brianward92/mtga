import { describe, it, expect } from 'vitest'
import { parseDraftEventName } from '../main/utils/format-utils'

describe('parseDraftEventName', () => {
  it.each([
    ['PremierDraft_LTR_20260825', 'LTR', 'PremierDraft'],
    ['TradDraft_LTR_20260825', 'LTR', 'TradDraft'],
    ['QuickDraft_SOS_20260831', 'SOS', 'QuickDraft'],
    ['PickTwoDraft_TMT_20260301', 'TMT', 'PickTwoDraft'],
    ['ContenderDraft_HOB_20260811', 'HOB', 'ContenderDraft'],
    ['Sealed_HOB_20260811', 'HOB', 'Sealed'],
    ['TradSealed_HOB_20260811', 'HOB', 'TradSealed'],
    ['ArenaDirect_OTJ_Sealed_20240726', 'OTJ', 'ArenaDirectSealed'],
  ])('%s → %s / %s', (name, set, format) => {
    expect(parseDraftEventName(name)).toEqual({ set, format })
  })

  it('rejects non-limited events', () => {
    expect(parseDraftEventName('Ladder')).toBeNull()
    expect(parseDraftEventName('Historic_Play')).toBeNull()
    expect(parseDraftEventName('')).toBeNull()
  })
})

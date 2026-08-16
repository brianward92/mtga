import { describe, expect, it } from 'vitest'
import { EMPTY_STATE, type DraftState } from '../shared/state'
import { draftLabel } from '../main/status-labels'

describe('tray draft status', () => {
  it('says Waiting for Arena whenever no Arena window is available', () => {
    const active: DraftState = {
      ...EMPTY_STATE,
      phase: 'active',
      set: 'DSK',
      format: 'QuickDraft',
      pack: 2,
      pick: 6
    }

    expect(draftLabel(EMPTY_STATE, false)).toBe('Waiting for Arena…')
    expect(draftLabel(active, false)).toBe('Waiting for Arena…')
  })

  it('shows draft state once Arena is available', () => {
    const active: DraftState = {
      ...EMPTY_STATE,
      phase: 'active',
      set: 'DSK',
      format: 'QuickDraft',
      pack: 2,
      pick: 6
    }

    expect(draftLabel(EMPTY_STATE, true)).toBe('No draft in progress')
    expect(draftLabel(active, true)).toBe('DSK QuickDraft P2P6')
  })
})

import { describe, expect, it, vi } from 'vitest'
import { DraftSessionSnapshot } from '../main/parser/draft-parser'
import { backfillCompletedDraftPick } from '../main/utils/draft-result-backfill'

function snapshot(picked = true): DraftSessionSnapshot {
  return {
    draftId: 'draft',
    eventName: 'event',
    set: 'SOS',
    format: 'PremierDraft',
    state: 'active',
    isBotDraft: true,
    currentPack: null,
    picks: picked
      ? [{ pack: 1, pick: 2, grpIds: [102], packGrpIds: [101, 102, 103] }]
      : [],
    pool: picked ? [102] : []
  }
}

describe('late score persistence', () => {
  it('backfills the matching pick after its score response arrives', () => {
    const persist = vi.fn()
    const session = snapshot()

    expect(backfillCompletedDraftPick(
      session,
      1,
      2,
      [103, 101, 102],
      persist
    )).toBe(true)
    expect(persist).toHaveBeenCalledWith(session, session.picks[0])
  })

  it('does not write when the pick has not landed or the pack differs', () => {
    const persist = vi.fn()

    expect(backfillCompletedDraftPick(snapshot(false), 1, 2, [101, 102, 103], persist)).toBe(false)
    expect(backfillCompletedDraftPick(snapshot(), 1, 2, [101, 102, 999], persist)).toBe(false)
    expect(persist).not.toHaveBeenCalled()
  })
})

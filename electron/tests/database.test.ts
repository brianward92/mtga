import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electronState = vi.hoisted(() => ({ userData: '' }))

vi.mock('electron', () => ({
  app: {
    getPath: () => electronState.userData
  }
}))

import {
  closeDatabase,
  getPlayDrawStats,
  initDatabase,
  insertMatch,
  recordDraftPick,
  updateMatchEnd,
  upsertDraft
} from '../main/data/database'

function match(
  id: string,
  result: 'win' | 'loss' | 'draw',
  onPlay: boolean,
  deckId: string | null = null
) {
  return {
    id,
    eventId: 'event',
    format: 'Standard',
    deckId,
    deckName: 'Deck',
    opponentName: 'Opponent',
    result,
    gameCount: 1,
    startedAt: new Date('2026-07-12T12:00:00Z'),
    onPlay,
    opponentPlatform: 'Mac'
  }
}

describe('result persistence', () => {
  beforeEach(() => {
    closeDatabase()
    electronState.userData = mkdtempSync(join(tmpdir(), 'mtga-db-test-'))
  })

  afterEach(() => {
    closeDatabase()
    rmSync(electronState.userData, { recursive: true, force: true })
  })

  it('aggregates play/draw stats without a deck filter', () => {
    insertMatch(match('play-win', 'win', true))
    insertMatch(match('play-loss', 'loss', true))
    insertMatch(match('draw-win', 'win', false))

    expect(getPlayDrawStats()).toEqual({
      onPlay: { wins: 1, losses: 1, winRate: 50 },
      onDraw: { wins: 1, losses: 0, winRate: 100 }
    })
  })

  it('still applies the optional deck filter', () => {
    insertMatch(match('deck-a', 'win', true, 'a'))
    insertMatch(match('deck-b', 'loss', true, 'b'))

    expect(getPlayDrawStats('a').onPlay).toEqual({ wins: 1, losses: 0, winRate: 100 })
  })

  it('does not let replayed placeholder data overwrite a completed match', () => {
    insertMatch(match('completed', 'win', true))
    updateMatchEnd('completed', 'win', 3, 'Damage', 12)

    insertMatch(match('completed', 'draw', false))
    updateMatchEnd('completed', 'draw', 1, 'Unknown', 0)

    const row = initDatabase().prepare(`
      SELECT result, game_count, on_play, win_condition, final_turn, ended_at
      FROM matches WHERE id = ?
    `).get('completed') as Record<string, unknown>

    expect(row.result).toBe('win')
    expect(row.game_count).toBe(3)
    expect(row.on_play).toBe(1)
    expect(row.win_condition).toBe('Damage')
    expect(row.final_turn).toBe(12)
    expect(row.ended_at).not.toBeNull()
  })

  it('fills model verdict fields when scores arrive after the pick', () => {
    upsertDraft({
      id: 'draft',
      eventName: 'event',
      setCode: 'SOS',
      format: 'PremierDraft'
    })
    const base = {
      draftId: 'draft',
      pack: 1,
      pick: 1,
      packGrpIds: [101, 102],
      pickedGrpIds: [102]
    }

    recordDraftPick({
      ...base,
      modelTopGrpId: null,
      modelEv: null,
      pickedEv: null
    })
    recordDraftPick({
      ...base,
      modelTopGrpId: 101,
      modelEv: 0.8,
      pickedEv: 0.3
    })

    const row = initDatabase().prepare(`
      SELECT model_top_grpid, model_ev, picked_ev
      FROM draft_picks WHERE draft_id = ? AND pack = 1 AND pick = 1
    `).get('draft') as Record<string, unknown>

    expect(row).toMatchObject({
      model_top_grpid: 101,
      model_ev: 0.8,
      picked_ev: 0.3
    })
  })
})

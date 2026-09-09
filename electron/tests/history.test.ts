import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { DraftHistory, historyKey, type HistoryEvent } from '../main/data/history'

let dir: string
let file: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'history-')); file = join(dir, 'draft-history.jsonl') })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const pick = (over: Partial<HistoryEvent> = {}): HistoryEvent => ({
  at: '2026-09-09T11:38:21.476Z', type: 'pick', draftId: null,
  eventName: 'QuickDraft_LCI_20260908', set: 'LCI', format: 'QuickDraft',
  pack: 1, pick: 1, grpId: 87285, name: 'Abrade',
  recommendedGrpId: 87285, recommendedName: 'Abrade', takenRank: 1, ev: 2.5, modelId: 'm', ...over
})

const lines = () => readFileSync(file, 'utf8').split('\n').filter(Boolean)

describe('DraftHistory deduplication', () => {
  it('writes an event once, however many times it is replayed', () => {
    // Replay runs on every app start, so an un-deduplicated append would grow
    // the file by a whole draft each launch.
    const h = new DraftHistory(file)
    expect(h.append(pick())).toBe(true)
    expect(h.append(pick())).toBe(false)
    expect(h.append(pick())).toBe(false)
    expect(lines()).toHaveLength(1)
  })

  it('keeps the richer live row when a replay re-derives the same pick', () => {
    // Replay does not score, so a replayed pick carries no model data. Keyed on
    // identity rather than content, it is recognised as already recorded and the
    // live row with its grades survives.
    const h = new DraftHistory(file)
    h.append(pick())
    expect(h.append(pick({ recommendedGrpId: null, recommendedName: null, takenRank: null, ev: null, modelId: null }))).toBe(false)
    expect(JSON.parse(lines()[0]).takenRank).toBe(1)
  })

  it('recognises events already on disk from an earlier run', () => {
    writeFileSync(file, JSON.stringify(pick()) + '\n')
    expect(new DraftHistory(file).append(pick())).toBe(false)
    expect(lines()).toHaveLength(1)
  })

  it('treats different positions and different cards as different events', () => {
    const h = new DraftHistory(file)
    h.append(pick())
    expect(h.append(pick({ pick: 2 }))).toBe(true)
    expect(h.append(pick({ pack: 2 }))).toBe(true)
    expect(h.append(pick({ grpId: 87383, name: 'Miner\'s Guidewing' }))).toBe(true)
    expect(lines()).toHaveLength(4)
  })

  it('survives a torn line from a half-written append', () => {
    writeFileSync(file, JSON.stringify(pick()) + '\n{"at":"2026-09-09","ty')
    const h = new DraftHistory(file)
    expect(h.append(pick())).toBe(false)
    expect(h.append(pick({ pick: 2 }))).toBe(true)
  })

  it('gives a draft one end row and one pool row, however it was reconstructed', () => {
    // A replay can recover a different number of picks than the live run saw,
    // so keying the end on its pick count wrote a second end row for the same
    // draft. The pool is its own event so it can be recorded later than the end
    // without rewriting an append-only file.
    const end = { ...pick(), type: 'draft-end' as const, picks: 45 }
    expect(historyKey(end)).toBe(historyKey({ ...end, picks: 30 }))
    const pool = { ...pick(), type: 'draft-pool' as const, pool: [1, 2, 3] }
    expect(historyKey(pool)).not.toBe(historyKey(end))
    const sub = { ...pick(), type: 'deck-submit' as const, mainCount: 40 }
    expect(historyKey(sub)).not.toBe(historyKey({ ...sub, mainCount: 41 }))
  })
})

describe('DraftHistory.lastDraft — the last line of defence', () => {
  const ev = (over: Partial<HistoryEvent>): HistoryEvent => ({ ...pick(), ...over })

  it('rebuilds the most recent draft from its picks and recorded pool', () => {
    const h = new DraftHistory(file)
    h.append(ev({ type: 'draft-start', at: '2026-09-09T10:00:00Z' }))
    h.append(ev({ at: '2026-09-09T10:01:00Z', pack: 1, pick: 1, grpId: 11, name: 'Abrade' }))
    h.append(ev({ at: '2026-09-09T10:02:00Z', pack: 1, pick: 2, grpId: 22, name: 'Plains' }))
    h.append(ev({ type: 'draft-end', at: '2026-09-09T10:03:00Z', picks: 2 }))
    h.append(ev({ type: 'draft-pool', at: '2026-09-09T10:03:00Z', pool: [11, 22, 33] }))

    const d = new DraftHistory(file).lastDraft()!
    expect(d.set).toBe('LCI')
    expect(d.format).toBe('QuickDraft')
    expect(d.complete).toBe(true)
    // The recorded pool wins: it holds cards the pick rows never mentioned.
    expect(d.pool).toEqual([11, 22, 33])
    expect(d.picks.map(p => p.grpId)).toEqual([11, 22])
  })

  it('falls back to the picks when a draft was cut off before its pool was recorded', () => {
    const h = new DraftHistory(file)
    h.append(ev({ at: '2026-09-09T10:01:00Z', pack: 1, pick: 1, grpId: 11 }))
    h.append(ev({ at: '2026-09-09T10:02:00Z', pack: 1, pick: 2, grpId: 22 }))
    const d = new DraftHistory(file).lastDraft()!
    expect(d.pool).toEqual([11, 22])
    expect(d.complete).toBe(false)
  })

  it('returns the newest draft, not the first in the file', () => {
    const h = new DraftHistory(file)
    h.append(ev({ eventName: 'QuickDraft_DSK_20260811', set: 'DSK', at: '2026-08-15T10:00:00Z', grpId: 1 }))
    h.append(ev({ at: '2026-09-09T10:00:00Z', grpId: 2 }))
    expect(new DraftHistory(file).lastDraft()!.set).toBe('LCI')
  })

  it('orders picks by pack and pick, whatever order they were written', () => {
    const h = new DraftHistory(file)
    h.append(ev({ pack: 2, pick: 1, grpId: 30 }))
    h.append(ev({ pack: 1, pick: 3, grpId: 20 }))
    h.append(ev({ pack: 1, pick: 1, grpId: 10 }))
    expect(new DraftHistory(file).lastDraft()!.picks.map(p => p.grpId)).toEqual([10, 20, 30])
  })

  it('is null when there is nothing to restore', () => {
    expect(new DraftHistory(file).lastDraft()).toBeNull()
    const h = new DraftHistory(file)
    h.append(ev({ type: 'draft-start' }))
    expect(new DraftHistory(file).lastDraft()).toBeNull()
  })
})

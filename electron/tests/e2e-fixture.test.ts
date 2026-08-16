import { describe, expect, it } from 'vitest'
import { spawnSync } from 'child_process'
import { join } from 'path'
import { DraftParser } from '../main/parser/draft-parser'

describe('synthetic draft log generator', () => {
  it('produces a full 42-pick bot draft the parser replays to completion', () => {
    const gen = spawnSync('node', [join(__dirname, 'e2e', 'gen-draft-log.mjs'), '--picks', '42', '--seed', '3'], { encoding: 'utf8' })
    expect(gen.status).toBe(0)
    const parser = new DraftParser()
    const events: string[] = []
    for (const ev of ['draft-start', 'draft-pack', 'draft-pick', 'draft-end'] as const) parser.on(ev, () => events.push(ev))
    for (const line of gen.stdout.split('\n')) parser.handleLine(line)
    const snap = parser.getSnapshot()!
    expect(snap.state).toBe('complete')
    expect(snap.set).toBe('DSK')
    expect(snap.format).toBe('QuickDraft')
    expect(snap.picks).toHaveLength(42)
    expect(snap.pool).toHaveLength(42)
    expect(events.filter(e => e === 'draft-pack')).toHaveLength(42)
    expect(events.filter(e => e === 'draft-pick')).toHaveLength(42)
    expect(events.at(-1)).toBe('draft-end')
    // 1-based snapshot contract: first pack pick is P1P1
    expect(snap.picks[0]).toMatchObject({ pack: 1, pick: 1 })
    expect(snap.picks[41]).toMatchObject({ pack: 3, pick: 14 })
  })
})

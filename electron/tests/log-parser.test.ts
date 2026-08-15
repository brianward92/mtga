/**
 * LogParser façade tests: it re-emits every DraftParser event unchanged,
 * exposes the snapshot, and does nothing else (no generic JSON parsing).
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { LogParser, DraftSessionSnapshot, DraftPickRecord } from '../main/parser/index'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

function fixtureLines(name: string): string[] {
  return readFileSync(join(FIXTURES, name), 'utf-8')
    .split('\n')
    .filter(line => line.length > 0)
}

describe('LogParser', () => {
  it('re-emits draft-start/pack/pick/end from DraftParser with identical payloads', () => {
    const parser = new LogParser()
    const seen: string[] = []
    let lastPick: DraftPickRecord | null = null
    parser.on('draft-start', () => seen.push('draft-start'))
    parser.on('draft-pack', () => seen.push('draft-pack'))
    parser.on('draft-pick', (_s: DraftSessionSnapshot, pick: DraftPickRecord) => {
      seen.push('draft-pick')
      lastPick = pick
    })
    parser.on('draft-end', () => seen.push('draft-end'))

    for (const line of fixtureLines('quick-draft-twoline.log')) parser.parseLine(line)

    expect(seen[0]).toBe('draft-start')
    expect(seen).toContain('draft-pack')
    expect(seen).toContain('draft-pick')
    expect(seen.at(-1)).toBe('draft-end')
    expect(lastPick).toMatchObject({ pack: 1, pick: 2, grpIds: [92301] })

    const snapshot = parser.getDraftSnapshot()!
    expect(snapshot.state).toBe('complete')
    expect(snapshot.pool).toEqual([92188, 92301])
  })

  it('emits detailed-logs for the Player.log sentinel', () => {
    const parser = new LogParser()
    const flags: boolean[] = []
    parser.on('detailed-logs', (d: { enabled: boolean }) => flags.push(d.enabled))
    for (const line of fixtureLines('detailed-logs-disabled.log')) parser.parseLine(line)
    parser.parseLine('DETAILED LOGS: ENABLED')
    expect(flags).toEqual([false, true])
  })

  it('has no draft snapshot before any draft line and ignores non-draft JSON', () => {
    const parser = new LogParser()
    parser.parseLine('[UnityCrossThreadLogger]<== PlayerInventory {"InventoryInfo":{"Gems":1}}')
    parser.parseLine('{"greToClientEvent":{"greToClientMessages":[]}}')
    parser.parseLine('{"matchGameRoomStateChangedEvent":{}}')
    expect(parser.getDraftSnapshot()).toBeNull()
  })
})

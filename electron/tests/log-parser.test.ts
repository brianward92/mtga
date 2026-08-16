/**
 * DraftParser integration tests for event order, snapshots, and log sentinels.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { DraftParser } from '../main/parser/draft-parser'
import type { DraftSessionSnapshot, DraftPickRecord } from '../main/parser/draft-session'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

function fixtureLines(name: string): string[] {
  return readFileSync(join(FIXTURES, name), 'utf-8')
    .split('\n')
    .filter(line => line.length > 0)
}

describe('DraftParser event integration', () => {
  it('emits draft-start/pack/pick/end in source order', () => {
    const parser = new DraftParser()
    const seen: string[] = []
    let lastPick: DraftPickRecord | null = null
    parser.on('draft-start', () => seen.push('draft-start'))
    parser.on('draft-pack', () => seen.push('draft-pack'))
    parser.on('draft-pick', (_s: DraftSessionSnapshot, pick: DraftPickRecord) => {
      seen.push('draft-pick')
      lastPick = pick
    })
    parser.on('draft-end', () => seen.push('draft-end'))

    for (const line of fixtureLines('quick-draft-twoline.log')) parser.handleLine(line)

    expect(seen).toEqual([
      'draft-start',
      'draft-pack',
      'draft-pick',
      'draft-pack',
      'draft-pick',
      'draft-end'
    ])
    expect(lastPick).toMatchObject({ pack: 1, pick: 2, grpIds: [92301] })

    const snapshot = parser.getSnapshot()!
    expect(snapshot.state).toBe('complete')
    expect(snapshot.pool).toEqual([92188, 92301])
  })

  it('emits detailed-logs for the Player.log sentinel', () => {
    const parser = new DraftParser()
    const flags: boolean[] = []
    parser.on('detailed-logs', (d: { enabled: boolean }) => flags.push(d.enabled))
    for (const line of fixtureLines('detailed-logs-disabled.log')) parser.handleLine(line)
    parser.handleLine('DETAILED LOGS: ENABLED')
    expect(flags).toEqual([false, true])
  })

  it('has no draft snapshot before any draft line and ignores non-draft JSON', () => {
    const parser = new DraftParser()
    parser.handleLine('[UnityCrossThreadLogger]<== PlayerInventory {"InventoryInfo":{"Gems":1}}')
    parser.handleLine('{"greToClientEvent":{"greToClientMessages":[]}}')
    parser.handleLine('{"matchGameRoomStateChangedEvent":{}}')
    expect(parser.getSnapshot()).toBeNull()
  })
})

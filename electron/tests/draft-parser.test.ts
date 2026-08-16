/**
 * Draft parser tests — every event shape from the verified 2026 log formats:
 * underscore and no-underscore names, 0- vs 1-indexed normalization, string
 * vs int card ids, string-escaped Payload parsing, human P1P1 backfill,
 * idempotent replay, and completion via both paths.
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

interface Captured {
  starts: DraftSessionSnapshot[]
  packs: DraftSessionSnapshot[]
  picks: Array<{ snapshot: DraftSessionSnapshot; pick: DraftPickRecord }>
  ends: DraftSessionSnapshot[]
  detailedLogs: Array<{ enabled: boolean }>
}

function capture(parser: DraftParser): Captured {
  const captured: Captured = { starts: [], packs: [], picks: [], ends: [], detailedLogs: [] }
  parser.on('draft-start', (snapshot: DraftSessionSnapshot) => captured.starts.push(snapshot))
  parser.on('draft-pack', (snapshot: DraftSessionSnapshot) => captured.packs.push(snapshot))
  parser.on('draft-pick', (snapshot: DraftSessionSnapshot, pick: DraftPickRecord) =>
    captured.picks.push({ snapshot, pick })
  )
  parser.on('draft-end', (snapshot: DraftSessionSnapshot) => captured.ends.push(snapshot))
  parser.on('detailed-logs', (data: { enabled: boolean }) => captured.detailedLogs.push(data))
  return captured
}

function feed(parser: DraftParser, lines: string[]): void {
  for (const line of lines) parser.handleLine(line)
}

describe('DraftParser — human Premier draft (modern names)', () => {
  it('parses the full flow: join, P1P1 backfill, Draft.Notify, picks, completion', () => {
    const parser = new DraftParser()
    const events = capture(parser)
    feed(parser, fixtureLines('premier-draft.log'))

    // Draft start from EventJoin, set/format parsed from the event name
    expect(events.starts.length).toBe(1)
    expect(events.starts[0].set).toBe('SOS')
    expect(events.starts[0].format).toBe('PremierDraft')
    expect(events.starts[0].isBotDraft).toBe(false)

    const final = parser.getSnapshot()!
    expect(final.state).toBe('complete')
    expect(final.draftId).toBe('c7d1a9e0-1111-2222-3333-444455556666')
    expect(final.eventName).toBe('PremierDraft_SOS_20260421')

    // Picks are 1-indexed ints with GrpIds arrays
    expect(final.picks.length).toBe(2)
    expect(final.picks[0]).toMatchObject({ pack: 1, pick: 1, grpIds: [90210] })
    expect(final.picks[1]).toMatchObject({ pack: 1, pick: 2, grpIds: [90355] })

    // Completion response CardPool is the authoritative final pool
    expect(final.pool).toEqual([90210, 90355])
    expect(final.currentPack).toBeNull()
    expect(events.ends.length).toBeGreaterThanOrEqual(1)
  })

  it('backfills the P1P1 pack from the double-escaped LogBusinessEvents payload', () => {
    const parser = new DraftParser()
    feed(parser, fixtureLines('premier-draft.log'))

    const final = parser.getSnapshot()!
    // (1,1) pack contents only ever appear in the LogBusinessEvents payload
    expect(final.picks[0].packGrpIds).toEqual([90210, 90355, 90114])
    // (1,2) pack recorded both from Draft.Notify and the direct-request form
    expect(final.picks[1].packGrpIds).toEqual([90355, 90114, 90500])
  })

  it('parses Draft.Notify comma-string PackCards, 1-indexed, into the current pack', () => {
    const parser = new DraftParser()
    const events = capture(parser)
    feed(parser, fixtureLines('premier-draft.log'))

    const notifyPack = events.packs.find(
      snapshot => snapshot.currentPack?.pack === 1 && snapshot.currentPack?.pick === 2
    )
    expect(notifyPack).toBeDefined()
    expect(notifyPack!.currentPack!.grpIds).toEqual([90355, 90114, 90500])
  })

  it('does not use LogBusinessEvents for live display (currentPack untouched)', () => {
    const parser = new DraftParser()
    const lines = fixtureLines('premier-draft.log')
    // Feed only through the P1P1 business event (join, pick, business event)
    feed(parser, lines.slice(0, 3))

    const snapshot = parser.getSnapshot()!
    expect(snapshot.currentPack).toBeNull()
    expect(snapshot.picks[0].packGrpIds).toEqual([90210, 90355, 90114])
  })

  it('replaying the same log twice converges to the same state', () => {
    const once = new DraftParser()
    feed(once, fixtureLines('premier-draft.log'))

    const twice = new DraftParser()
    feed(twice, fixtureLines('premier-draft.log'))
    feed(twice, fixtureLines('premier-draft.log'))

    expect(twice.getSnapshot()).toEqual(once.getSnapshot())
  })
})

describe('DraftParser — Quick (bot) draft', () => {
  it('normalizes 0-indexed PackNumber/PickNumber and string card ids', () => {
    const parser = new DraftParser()
    const events = capture(parser)
    feed(parser, fixtureLines('quick-draft.log'))

    expect(events.starts.length).toBe(1)
    expect(events.starts[0].set).toBe('ECL')
    expect(events.starts[0].format).toBe('QuickDraft')
    expect(events.starts[0].isBotDraft).toBe(true)

    // Bot P1P1 IS in the log (first PickNext), 0-indexed -> 1-indexed
    expect(events.packs[0].currentPack).toMatchObject({ pack: 1, pick: 1 })
    // DraftPack string ids -> ints
    expect(events.packs[0].currentPack!.grpIds).toEqual([98361, 98498, 98546])

    const final = parser.getSnapshot()!
    expect(final.picks[0]).toMatchObject({ pack: 1, pick: 1, grpIds: [98546] })
    expect(final.picks[1]).toMatchObject({ pack: 1, pick: 2, grpIds: [98361] })
  })

  it('uses PickedCards as the authoritative pool resync', () => {
    const parser = new DraftParser()
    const lines = fixtureLines('quick-draft.log')
    feed(parser, lines.slice(0, 3)) // status P1P1, pick, status P1P2

    // Pool comes from PickedCards in the second status, not accumulation
    expect(parser.getSnapshot()!.pool).toEqual([98546])
  })

  it('completes via DraftStatus "Completed" with the final PickedCards', () => {
    const parser = new DraftParser()
    const events = capture(parser)
    feed(parser, fixtureLines('quick-draft.log'))

    expect(events.ends.length).toBe(1)
    const final = parser.getSnapshot()!
    expect(final.state).toBe('complete')
    expect(final.pool).toEqual([98546, 98361])
    expect(final.currentPack).toBeNull()
  })

  it('replaying the same bot log twice converges to the same state', () => {
    const once = new DraftParser()
    feed(once, fixtureLines('quick-draft.log'))

    const twice = new DraftParser()
    feed(twice, fixtureLines('quick-draft.log'))
    feed(twice, fixtureLines('quick-draft.log'))

    expect(twice.getSnapshot()).toEqual(once.getSnapshot())
  })
})

describe('DraftParser — real two-line response shape ("<== Name(id)" then body)', () => {
  // Real 2026 Player.log puts a bare "<== BotDraftDraftStatus(guid)" marker on
  // one line and the JSON body on the NEXT line (verified against
  // Player-prev.log 2026-08-15, QuickDraft_DSK_20260811). Requests stay on
  // one line. The older one-line "<== Name {json}" fixtures above still pass.

  it('parses a real QuickDraft_DSK two-line status/pick sequence with noise lines', () => {
    const parser = new DraftParser()
    const events = capture(parser)
    feed(parser, fixtureLines('quick-draft-twoline.log'))

    expect(events.starts.length).toBe(1)
    expect(events.starts[0].set).toBe('DSK')
    expect(events.starts[0].format).toBe('QuickDraft')
    expect(events.starts[0].isBotDraft).toBe(true)

    // <== BotDraftDraftStatus(id) + body: P1P1 pack, real 14-card DSK pack
    expect(events.packs[0].currentPack).toMatchObject({ pack: 1, pick: 1 })
    expect(events.packs[0].currentPack!.grpIds).toEqual([
      92188, 92154, 92073, 92248, 92224, 92346, 92290, 92076, 92231, 92161, 92082, 92310, 92176, 92380
    ])

    // <== BotDraftDraftPick(id) + body: next pack, PickedCards resync
    expect(events.packs[1].currentPack).toMatchObject({ pack: 1, pick: 2 })
    expect(events.packs[1].currentPack!.grpIds.length).toBe(13)
    expect(events.packs[1].pool).toEqual([92188])

    const final = parser.getSnapshot()!
    expect(final.state).toBe('complete')
    expect(final.eventName).toBe('QuickDraft_DSK_20260811')
    expect(final.picks.map(p => ({ pack: p.pack, pick: p.pick, grpIds: p.grpIds }))).toEqual([
      { pack: 1, pick: 1, grpIds: [92188] },
      { pack: 1, pick: 2, grpIds: [92301] }
    ])
    expect(final.pool).toEqual([92188, 92301])
    expect(events.ends.length).toBe(1)
  })

  it('two-line human draft: MakePick response bodies are harmless, DraftCompleteDraft CardPool is picked up', () => {
    const parser = new DraftParser()
    const events = capture(parser)
    feed(parser, fixtureLines('premier-draft-twoline.log'))

    expect(events.starts.length).toBe(1)
    expect(events.starts[0].set).toBe('SOS')

    const final = parser.getSnapshot()!
    expect(final.state).toBe('complete')
    expect(final.draftId).toBe('c7d1a9e0-1111-2222-3333-444455556666')
    expect(final.picks.length).toBe(2)
    expect(final.picks[0]).toMatchObject({ pack: 1, pick: 1, grpIds: [90210] })
    expect(final.picks[0].packGrpIds).toEqual([90210, 90355, 90114])
    expect(final.picks[1]).toMatchObject({ pack: 1, pick: 2, grpIds: [90355] })
    expect(final.pool).toEqual([90210, 90355])
    // Completion via request line then response body — exactly one end
    expect(events.ends.length).toBe(1)
  })

  it('a two-line completion response whose body carries a LARGER CardPool is authoritative', () => {
    // Only reachable with two-line stitching: the body alone contains no
    // "CompleteDraft" substring.
    const parser = new DraftParser()
    parser.handleLine(
      '[UnityCrossThreadLogger]==> EventPlayerDraftMakePick ' +
        JSON.stringify({
          id: 'm1',
          request: JSON.stringify({ DraftId: 'two-line-pool', GrpIds: [105101], Pack: 1, Pick: 1 })
        })
    )
    parser.handleLine('[UnityCrossThreadLogger]8/15/2026 11:03:01 AM')
    parser.handleLine('<== DraftCompleteDraft(e1e1e1e1-0000-4000-8000-000000000009)')
    parser.handleLine(
      JSON.stringify({
        CourseId: 'c1',
        InternalEventName: 'PremierDraft_MSH_20260623',
        CardPool: [105101, 105102, 105103],
        DraftId: 'two-line-pool'
      })
    )

    const final = parser.getSnapshot()!
    expect(final.state).toBe('complete')
    expect(final.pool).toEqual([105101, 105102, 105103])
  })

  it('a marker line not followed by a JSON body does not swallow the next line', () => {
    const parser = new DraftParser()
    const events = capture(parser)
    parser.handleLine('<== SomeOtherResponse(abc)')
    // Next line is a normal one-line request, not a body: must still be handled
    parser.handleLine(
      '[UnityCrossThreadLogger]==> BotDraftDraftPick ' +
        JSON.stringify({
          id: 'b1',
          request: JSON.stringify({
            EventName: 'QuickDraft_DSK_20260811',
            PickInfo: { EventName: 'QuickDraft_DSK_20260811', CardIds: ['92188'], PackNumber: 0, PickNumber: 0 }
          })
        })
    )
    expect(events.picks.length).toBe(1)
    expect(events.picks[0].pick).toMatchObject({ pack: 1, pick: 1, grpIds: [92188] })
  })

  it('mid-draft attach (no EventJoin seen) still starts a session from the first two-line status', () => {
    const parser = new DraftParser()
    const events = capture(parser)
    const lines = fixtureLines('quick-draft-twoline.log')
    // Skip everything before the "<== BotDraftDraftStatus(id)" marker
    const markerIdx = lines.findIndex(l => l.startsWith('<== BotDraftDraftStatus('))
    expect(markerIdx).toBeGreaterThan(0)
    feed(parser, lines.slice(markerIdx))

    expect(events.starts.length).toBe(1)
    expect(events.starts[0].set).toBe('DSK')
    expect(events.packs[0].currentPack).toMatchObject({ pack: 1, pick: 1 })
    expect(parser.getSnapshot()!.state).toBe('complete')
  })

  it('replaying the two-line log twice converges', () => {
    const once = new DraftParser()
    feed(once, fixtureLines('quick-draft-twoline.log'))
    const twice = new DraftParser()
    feed(twice, fixtureLines('quick-draft-twoline.log'))
    feed(twice, fixtureLines('quick-draft-twoline.log'))
    expect(twice.getSnapshot()).toEqual(once.getSnapshot())
  })
})

describe('DraftParser — snapshot pack/pick indexing contract', () => {
  function botStatusBody(packNumber: number, pickNumber: number, draftPack: string[], picked: string[]): string {
    return JSON.stringify({
      CurrentModule: 'BotDraft',
      Payload: JSON.stringify({
        Result: 'Success',
        EventName: 'QuickDraft_DSK_20260811',
        DraftStatus: 'PickNext',
        PackNumber: packNumber,
        PickNumber: pickNumber,
        NumCardsToPick: 1,
        DraftPack: draftPack,
        PackStyles: [],
        PickedCards: picked,
        PickedStyles: []
      })
    })
  }

  it('snapshot pack/pick are 1-based: raw bot PackNumber/PickNumber 0/0 becomes {pack:1,pick:1}', () => {
    const parser = new DraftParser()
    const events = capture(parser)
    parser.handleLine('<== BotDraftDraftStatus(006528f2-67ab-4da5-b04a-88d36b803911)')
    parser.handleLine(botStatusBody(0, 0, ['92188', '92154'], []))
    expect(events.packs[0].currentPack).toEqual({ pack: 1, pick: 1, grpIds: [92188, 92154] })

    // Second pack of the draft, third pick: raw 1/2 -> 2/3
    parser.handleLine('<== BotDraftDraftStatus(006528f2-67ab-4da5-b04a-88d36b803912)')
    parser.handleLine(botStatusBody(1, 2, ['92301'], ['92188', '92154']))
    expect(events.packs[1].currentPack).toMatchObject({ pack: 2, pick: 3 })

    // Bot pick with raw PackNumber/PickNumber 1/2 lands on the same 1-based key
    parser.handleLine(
      '[UnityCrossThreadLogger]==> BotDraftDraftPick ' +
        JSON.stringify({
          id: 'b1',
          request: JSON.stringify({
            EventName: 'QuickDraft_DSK_20260811',
            PickInfo: { EventName: 'QuickDraft_DSK_20260811', CardIds: ['92301'], PackNumber: 1, PickNumber: 2 }
          })
        })
    )
    const final = parser.getSnapshot()!
    expect(final.picks.at(-1)).toMatchObject({ pack: 2, pick: 3, grpIds: [92301], packGrpIds: [92301] })
    // Nothing in a snapshot is ever 0-based
    for (const p of final.picks) {
      expect(p.pack).toBeGreaterThanOrEqual(1)
      expect(p.pick).toBeGreaterThanOrEqual(1)
    }
  })

  it('human events (already 1-based) pass through unchanged', () => {
    const parser = new DraftParser()
    parser.handleLine(
      '[UnityCrossThreadLogger]Draft.Notify {"draftId":"d1","SelfPick":1,"SelfPack":2,"PackCards":"1,2,3"}'
    )
    expect(parser.getSnapshot()!.currentPack).toMatchObject({ pack: 2, pick: 1 })
  })
})

describe('DraftParser — legacy event names (with underscores)', () => {
  it('handles Event_Join / Event_PlayerDraftMakePick / Draft_CompleteDraft', () => {
    const parser = new DraftParser()
    const events = capture(parser)
    feed(parser, fixtureLines('legacy-underscore.log'))

    expect(events.starts.length).toBe(1)
    expect(events.starts[0].set).toBe('MSH')

    const final = parser.getSnapshot()!
    expect(final.state).toBe('complete')
    expect(final.picks.length).toBe(2)
    expect(final.pool).toEqual([91001, 91002])
  })

  it('handles legacy BotDraft_DraftPick with single int CardId', () => {
    const parser = new DraftParser()
    feed(parser, fixtureLines('legacy-bot-pick.log'))

    const final = parser.getSnapshot()!
    expect(final.picks.length).toBe(1)
    expect(final.picks[0]).toMatchObject({ pack: 1, pick: 1, grpIds: [98361] })
  })
})

describe('DraftParser — edge cases', () => {
  it('emits detailed-logs disabled for the sentinel line', () => {
    const parser = new DraftParser()
    const events = capture(parser)
    feed(parser, fixtureLines('detailed-logs-disabled.log'))

    expect(events.detailedLogs).toEqual([{ enabled: false }])
  })

  it('emits detailed-logs enabled for the ENABLED sentinel (clears the warning)', () => {
    const parser = new DraftParser()
    const events = capture(parser)
    parser.handleLine('DETAILED LOGS: ENABLED')

    expect(events.detailedLogs).toEqual([{ enabled: true }])
  })

  it('normalizes a 0-indexed LogBusinessEvents variant to 1-indexed', () => {
    const parser = new DraftParser()
    const line =
      '[UnityCrossThreadLogger]==> LogBusinessEvents ' +
      JSON.stringify({
        id: 'x1',
        request: JSON.stringify({
          DraftId: 'zero-index-test',
          EventId: 'PremierDraft_SOS_20260421',
          PackNumber: 0,
          PickNumber: 0,
          CardsInPack: [1001, 1002],
          PickGrpId: 1001,
          AutoPick: false,
          TimeRemainingOnPick: 10
        })
      })
    parser.handleLine(line)

    const final = parser.getSnapshot()!
    expect(final.picks[0]).toMatchObject({ pack: 1, pick: 1, grpIds: [1001] })
    expect(final.picks[0].packGrpIds).toEqual([1001, 1002])
  })

  it('handles Pick-Two GrpIds arrays with two cards', () => {
    const parser = new DraftParser()
    const line =
      '[UnityCrossThreadLogger]==> EventPlayerDraftMakePick ' +
      JSON.stringify({
        id: 'p2',
        request: JSON.stringify({
          DraftId: 'pick-two-test',
          GrpIds: [90210, 90355],
          Pack: 1,
          Pick: 1
        })
      })
    parser.handleLine(line)

    const final = parser.getSnapshot()!
    expect(final.picks[0].grpIds).toEqual([90210, 90355])
    expect(final.pool).toEqual([90210, 90355])
  })

  it('completion via the request line alone still ends the draft (accumulated pool)', () => {
    const parser = new DraftParser()
    const events = capture(parser)
    const pick =
      '[UnityCrossThreadLogger]==> EventPlayerDraftMakePick ' +
      JSON.stringify({
        id: 'c1',
        request: JSON.stringify({ DraftId: 'req-complete', GrpIds: [777], Pack: 3, Pick: 14 })
      })
    const completeRequest =
      '[UnityCrossThreadLogger]==> DraftCompleteDraft ' +
      JSON.stringify({ id: 'c2', request: JSON.stringify({ DraftId: 'req-complete' }) })

    parser.handleLine(pick)
    parser.handleLine(completeRequest)

    expect(events.ends.length).toBe(1)
    const final = parser.getSnapshot()!
    expect(final.state).toBe('complete')
    expect(final.pool).toEqual([777])
  })

  it('ignores unrelated log lines without throwing', () => {
    const parser = new DraftParser()
    expect(() => {
      parser.handleLine('[UnityCrossThreadLogger]==> LogInfo {"messages":"hello"}')
      parser.handleLine('random non-json garbage } { ==>')
      parser.handleLine('[UnityCrossThreadLogger]Draft.Notify not-json-at-all')
      parser.handleLine('')
    }).not.toThrow()
    expect(parser.getSnapshot()).toBeNull()
  })

  it('a truncated completion CardPool does not clobber the accumulated pool', () => {
    // Observed live (MSH 2026-07-30): a finished 42-pick draft whose completion
    // payload carried only 4 ids, which overwrote the real pool in the DB.
    const parser = new DraftParser()
    const events = capture(parser)
    const draftId = 'a0c955f3-e726-4f74-8384-3d6edc5df92b'

    parser.handleLine(
      '[UnityCrossThreadLogger]==> EventJoin {"request":"{\\"EventName\\":\\"PremierDraft_MSH_20260623\\"}"}'
    )

    const picked: number[] = []
    for (let pack = 1; pack <= 3; pack++) {
      for (let pick = 1; pick <= 14; pick++) {
        const grpId = 105000 + pack * 100 + pick
        picked.push(grpId)
        const packCards = Array.from({ length: 15 - pick }, (_, i) => grpId + i).join(',')
        parser.handleLine(
          `[UnityCrossThreadLogger]Draft.Notify {"draftId":"${draftId}","SelfPick":${pick},` +
            `"SelfPack":${pack},"PackCards":"${packCards}"}`
        )
        parser.handleLine(
          `[UnityCrossThreadLogger]==> EventPlayerDraftMakePick {"id":"m${pack}-${pick}",` +
            `"request":"{\\"DraftId\\":\\"${draftId}\\",\\"GrpIds\\":[${grpId}],` +
            `\\"Pack\\":${pack},\\"Pick\\":${pick}}"}`
        )
      }
    }

    expect(parser.getSnapshot()!.pool.length).toBe(42)

    // Completion arrives carrying a partial CardPool (last pack's leftovers).
    parser.handleLine(
      `[UnityCrossThreadLogger]<== DraftCompleteDraft {"CourseId":"c1",` +
        `"InternalEventName":"PremierDraft_MSH_20260623","CardPool":[104980,105068,105057,105074],` +
        `"DraftId":"${draftId}"}`
    )

    const final = parser.getSnapshot()!
    expect(final.state).toBe('complete')
    expect(final.pool).toEqual(picked)
    expect(final.pool.length).toBe(42)
    expect(events.ends.length).toBe(1)
  })

  it('a completion CardPool at least as large as the pick stream is authoritative', () => {
    const parser = new DraftParser()
    const draftId = 'b1111111-2222-3333-4444-555555555555'
    parser.handleLine(
      '[UnityCrossThreadLogger]==> EventJoin {"request":"{\\"EventName\\":\\"PremierDraft_MSH_20260623\\"}"}'
    )
    parser.handleLine(
      `[UnityCrossThreadLogger]==> EventPlayerDraftMakePick {"id":"m1",` +
        `"request":"{\\"DraftId\\":\\"${draftId}\\",\\"GrpIds\\":[105101],\\"Pack\\":1,\\"Pick\\":1}"}`
    )
    // Arena's pool includes cards the pick stream missed (e.g. mid-draft attach).
    parser.handleLine(
      `[UnityCrossThreadLogger]<== DraftCompleteDraft {"CourseId":"c1",` +
        `"InternalEventName":"PremierDraft_MSH_20260623","CardPool":[105101,105102,105103],` +
        `"DraftId":"${draftId}"}`
    )

    expect(parser.getSnapshot()!.pool).toEqual([105101, 105102, 105103])
  })

  it('a second EventJoin for the same completed event does not restart the draft', () => {
    const parser = new DraftParser()
    const events = capture(parser)
    const lines = fixtureLines('premier-draft.log')
    feed(parser, lines)
    // Rejoin fires during post-draft deck building / matches
    parser.handleLine(lines[0])

    expect(events.starts.length).toBe(1)
    expect(parser.getSnapshot()!.state).toBe('complete')
  })
})

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
import { DraftParser, DraftSessionSnapshot, DraftPickRecord } from '../main/parser/draft-parser'

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

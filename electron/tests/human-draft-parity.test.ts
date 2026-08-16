import { EventEmitter } from 'events'
import { spawnSync } from 'child_process'
import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'
import { DraftCoordinator } from '../main/draft/coordinator'
import { DraftParser } from '../main/parser/draft-parser'
import { startDraftLogPipeline } from '../main/parser/pipeline'
import type { LogWatcher } from '../main/parser/watcher'
import type { DraftSessionSnapshot } from '../main/parser/draft-session'
import type { DraftState } from '../shared/state'

const FIXTURE = join(__dirname, 'fixtures', 'trad-draft-42-twoline.log')

interface ScoreCall {
  set: string
  format: string
  pack: number[]
  pool: number[]
  pack0: number
  pick0: number
}

// Same deterministic manager behavior as coordinator.test.ts: two known
// cards, grpId 2 preferred, and stable intrinsic/live grades.
function stubModels() {
  const bundle = {
    set: 'DSK', dir: '', assetsPath: '', picksPerPack: 14, manifestHash: 'x',
    cards: new Map([
      [1, { grpId: 1, name: 'Murder', rarity: 'common', colors: 'B', colorIdentity: 'B', manaCost: '{1}{B}{B}', manaValue: 3, type: 'Instant' }],
      [2, { grpId: 2, name: 'Funeral Room', rarity: 'mythic', colors: 'B', colorIdentity: 'WB', manaCost: '{2}{B}', manaValue: 3, type: 'Enchantment — Room' }]
    ]),
    scryfallUpdatedAt: '2026-08-15',
    names: ['Murder', 'Funeral Room']
  }
  const calls: ScoreCall[] = []
  return {
    calls,
    bundleFor: () => bundle,
    ensure: vi.fn(async () => ({})),
    modelTag: 'v',
    status: () => ({ state: 'ready' as const, modelId: '_foundation/v', modelTag: 'v', set: 'DSK', format: 'QuickDraft', message: null, sets: ['DSK'] }),
    intrinsic: (g: number) => (g === 2 ? { percentile: 0.97, grade: 'A' as const } : g === 1 ? { percentile: 0.4, grade: 'C' as const } : null),
    score: vi.fn(async (set: string, format: string, pack: number[], pool: number[], pack0: number, pick0: number) => {
      calls.push({ set, format, pack, pool, pack0, pick0 })
      const cards = pack.map(g => {
        const percentile = g === 2 ? 0.97 : g === 1 ? 0.4 : null
        const grade = g === 2 ? 'A' as const : g === 1 ? 'C' as const : null
        return {
          grpId: g,
          ev: g === 2 ? 2.5 : g === 1 ? 0.3 : null,
          prob: g === 2 ? 0.9 : g === 1 ? 0.1 : null,
          rank: g === 2 ? 1 : g === 1 ? 2 : 3,
          percentile,
          grade,
          setPercentile: percentile,
          setGrade: grade
        }
      })
      return { modelId: '_foundation/v', cards }
    })
  }
}

class FixtureWatcher extends EventEmitter {
  starts = 0
  async start(): Promise<void> { this.starts += 1 }
}

interface DrivenDraft {
  snapshot: DraftSessionSnapshot
  state: DraftState
  states: DraftState[]
  scoreCalls: ScoreCall[]
  events: { starts: number; packs: number; picks: number; ends: number }
  historyTypes: string[]
  watcherStarts: number
}

async function drive(lines: string[]): Promise<DrivenDraft> {
  const parser = new DraftParser()
  const models = stubModels()
  const historyTypes: string[] = []
  const coordinator = new DraftCoordinator(models as never, {
    append: vi.fn((event: { type: string }) => historyTypes.push(event.type))
  } as never)
  const watcher = new FixtureWatcher()
  const states: DraftState[] = []
  const events = { starts: 0, packs: 0, picks: 0, ends: 0 }
  parser.on('draft-start', () => { events.starts++ })
  parser.on('draft-pack', () => { events.packs++ })
  parser.on('draft-pick', () => { events.picks++ })
  parser.on('draft-end', () => { events.ends++ })
  coordinator.on('state', state => states.push(state))
  startDraftLogPipeline(coordinator, { parser, watcher: watcher as unknown as LogWatcher })

  for (const line of lines) {
    watcher.emit('line', line, false)
    // Let the coordinator's immediate async stub score settle before a pick
    // request can consume its recommendation.
    await Promise.resolve()
    await Promise.resolve()
  }

  const snapshot = parser.getSnapshot()
  if (!snapshot) throw new Error('fixture produced no draft snapshot')
  const result = {
    snapshot,
    state: coordinator.current,
    states: [...states],
    scoreCalls: [...models.calls],
    events: { ...events },
    historyTypes: [...historyTypes],
    watcherStarts: watcher.starts
  }
  coordinator.idle() // clear the completion linger timer
  return result
}

function quickDraftLines(): string[] {
  const generated = spawnSync('node', [join(__dirname, 'e2e', 'gen-draft-log.mjs'), '--picks', '42', '--seed', '3'], { encoding: 'utf8' })
  if (generated.status !== 0) throw new Error(generated.stderr || 'QuickDraft fixture generation failed')
  return generated.stdout.split('\n').filter(Boolean)
}

function snapshotCore(snapshot: DraftSessionSnapshot) {
  return {
    state: snapshot.state,
    currentPack: snapshot.currentPack,
    picks: snapshot.picks.map(({ pack, pick, grpIds, packGrpIds }) => ({ pack, pick, grpIds, packGrpIds })),
    pool: snapshot.pool
  }
}

function coordinatorCore(state: DraftState) {
  return {
    phase: state.phase,
    pack: state.pack,
    pick: state.pick,
    picksPerPack: state.picksPerPack,
    totalPicks: state.totalPicks,
    cards: state.cards.map(card => card.grpId),
    scoring: state.scoring,
    pool: state.pool.map(card => card.grpId),
    picks: state.picks.map(({ pack, pick, grpId }) => ({ pack, pick, grpId }))
  }
}

function scoreCallCore(call: ScoreCall) {
  return { set: call.set, pack: call.pack, pool: call.pool, pack0: call.pack0, pick0: call.pick0 }
}

function assertHumanTransitions(run: DrivenDraft): void {
  for (let n = 1; n <= 42; n++) {
    const expectedPack = Math.floor((n - 1) / 14) + 1
    const expectedPick = ((n - 1) % 14) + 1
    const afterPick = run.states.find(state =>
      state.phase === 'active' && state.picks.length === n && state.pool.length === n &&
      state.cards.length === 0 && !state.scoring
    )
    expect(afterPick, `human transition after pick ${n}`).toBeDefined()
    expect(afterPick!.picks.at(-1)).toMatchObject({ pack: expectedPack, pick: expectedPick })
    if (n === 1) {
      // Arena never sends Draft.Notify for human P1P1.
      expect({ pack: afterPick!.pack, pick: afterPick!.pick }).toEqual({ pack: null, pick: null })
    } else {
      expect({ pack: afterPick!.pack, pick: afterPick!.pick }).toEqual({ pack: expectedPack, pick: expectedPick })
    }
  }
}

describe('full human draft pipeline parity', () => {
  it('matches a 42-pick QuickDraft through parser, session, pipeline, and coordinator', async () => {
    const fixture = readFileSync(FIXTURE, 'utf8')
    const humanLines = fixture.split('\n').filter(Boolean)

    // The fallback fixture contains only sanitized draft protocol records.
    expect(fixture).not.toMatch(/"(?:AccountId|PlayerId|PersonaId|UserId|UserName|Email)"\s*:/i)
    expect(fixture).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i)
    expect(humanLines.filter(line => line.includes('Draft.Notify'))).toHaveLength(41)
    expect(humanLines.filter(line => line.includes('==> EventPlayerDraftMakePick'))).toHaveLength(42)
    expect(humanLines.filter(line => line.startsWith('<== EventPlayerDraftMakePick('))).toHaveLength(42)
    expect(humanLines.filter(line => line.startsWith('<== DraftCompleteDraft('))).toHaveLength(1)

    const premierLines = humanLines.map(line => line.replace(/TradDraft_DSK_20260811/g, 'PremierDraft_DSK_20260811'))
    const [trad, premier, quick] = await Promise.all([drive(humanLines), drive(premierLines), drive(quickDraftLines())])

    expect(trad.watcherStarts).toBe(1)
    expect(premier.watcherStarts).toBe(1)
    expect(quick.watcherStarts).toBe(1)
    expect(trad.snapshot).toMatchObject({ state: 'complete', set: 'DSK', format: 'TradDraft', isBotDraft: false, currentPack: null })
    expect(premier.snapshot).toMatchObject({ state: 'complete', set: 'DSK', format: 'PremierDraft', isBotDraft: false, currentPack: null })
    expect(quick.snapshot).toMatchObject({ state: 'complete', set: 'DSK', format: 'QuickDraft', isBotDraft: true, currentPack: null })
    expect(trad.snapshot.picks).toHaveLength(42)
    expect(trad.snapshot.pool).toHaveLength(42)
    expect(trad.snapshot.picks[0]).toMatchObject({ pack: 1, pick: 1 })
    expect(trad.snapshot.picks[41]).toMatchObject({ pack: 3, pick: 14 })
    expect(snapshotCore(trad.snapshot)).toEqual(snapshotCore(quick.snapshot))
    expect(snapshotCore(premier.snapshot)).toEqual(snapshotCore(quick.snapshot))

    expect(trad.state).toMatchObject({ phase: 'complete', set: 'DSK', format: 'TradDraft', isBotDraft: false, pack: 3, pick: 14 })
    expect(premier.state).toMatchObject({ phase: 'complete', set: 'DSK', format: 'PremierDraft', isBotDraft: false, pack: 3, pick: 14 })
    expect(quick.state).toMatchObject({ phase: 'complete', set: 'DSK', format: 'QuickDraft', isBotDraft: true, pack: 3, pick: 14 })
    expect(coordinatorCore(trad.state)).toEqual(coordinatorCore(quick.state))
    expect(coordinatorCore(premier.state)).toEqual(coordinatorCore(quick.state))
    expect(trad.states[0].phase).toBe('active')
    expect(trad.states.at(-1)?.phase).toBe('complete')
    assertHumanTransitions(trad)
    assertHumanTransitions(premier)

    expect(trad.events).toEqual({ starts: 1, packs: 41, picks: 42, ends: 1 })
    expect(premier.events).toEqual({ starts: 1, packs: 41, picks: 42, ends: 1 })
    expect(quick.events).toEqual({ starts: 1, packs: 42, picks: 42, ends: 1 })
    expect(trad.historyTypes.filter(type => type === 'pick')).toHaveLength(42)
    expect(premier.historyTypes.filter(type => type === 'pick')).toHaveLength(42)

    // Arena does not send Draft.Notify for human P1P1, hence 41 live pack
    // scores versus QuickDraft's 42. Both still finish at the same P3P14 pool.
    expect(trad.scoreCalls).toHaveLength(41)
    expect(premier.scoreCalls).toHaveLength(41)
    expect(quick.scoreCalls).toHaveLength(42)
    expect(trad.scoreCalls.every(call => call.format === 'TradDraft')).toBe(true)
    expect(premier.scoreCalls.every(call => call.format === 'PremierDraft')).toBe(true)
    expect(trad.scoreCalls.map(scoreCallCore)).toEqual(quick.scoreCalls.slice(1).map(scoreCallCore))
    expect(premier.scoreCalls.map(scoreCallCore)).toEqual(quick.scoreCalls.slice(1).map(scoreCallCore))
    expect(trad.scoreCalls.at(-1)).toMatchObject({ set: 'DSK', format: 'TradDraft', pack0: 2, pick0: 13 })
    expect(premier.scoreCalls.at(-1)).toMatchObject({ set: 'DSK', format: 'PremierDraft', pack0: 2, pick0: 13 })
    expect(quick.scoreCalls.at(-1)).toMatchObject({ set: 'DSK', format: 'QuickDraft', pack0: 2, pick0: 13 })
    expect(trad.scoreCalls.at(-1)?.pool).toHaveLength(41)
    expect(quick.scoreCalls.at(-1)?.pool).toHaveLength(41)

    // Bot status is authoritative and arrives before the next pick: after
    // picks 2..42, the active pool is one pick behind until that next status
    // (or the final Completed status) resynchronizes it.
    for (let n = 2; n <= 42; n++) {
      expect(quick.states.some(state =>
        state.phase === 'active' && state.picks.length === n && state.pool.length === n - 1 &&
        state.cards.length === 0 && !state.scoring
      ), `QuickDraft pool lag after pick ${n}`).toBe(true)
    }
    for (let n = 1; n < 42; n++) {
      expect(quick.states.some(state =>
        state.phase === 'active' && state.picks.length === n && state.pool.length === n
      ), `QuickDraft pool resync before pick ${n + 1}`).toBe(true)
    }
    expect(quick.state.pool).toHaveLength(42)
  })
})

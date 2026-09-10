import { describe, expect, it } from 'vitest'
import { gunzipSync } from 'node:zlib'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  applyMessage, battlefield, creatures, emptyGame, extractGreMessages,
  ourTurnToAct, openMana, replay, type GameState,
} from '../shared/gre'

/** A real recorded match. Everything asserted below actually happened. */
function fixture(): string[] {
  const raw = gunzipSync(readFileSync(join(__dirname, 'fixtures/gre-match.log.gz')))
  return raw.toString('utf8').split('\n').filter(Boolean)
}

/** Replay, stopping the first time `stop` is true, so a mid-game state can be inspected. */
function replayUntil(lines: string[], stop: (s: GameState) => boolean): GameState {
  let state = emptyGame()
  for (const line of lines) {
    for (const message of extractGreMessages(line)) {
      state = applyMessage(state, message)
      if (stop(state)) return state
    }
  }
  return state
}

describe('extractGreMessages', () => {
  it('ignores the 99% of the log that is not a GRE event', () => {
    expect(extractGreMessages('[UnityCrossThreadLogger]Client.SceneChange {"toSceneName":"Home"}')).toEqual([])
    expect(extractGreMessages('Input System module state changed to: Shutdown.')).toEqual([])
    expect(extractGreMessages('')).toEqual([])
  })

  it('does not throw on a line that starts like JSON and is not', () => {
    expect(extractGreMessages('{ "greToClientMessages": truncated…')).toEqual([])
  })

  it('finds every message in a real line', () => {
    const withBlockers = fixture().find(l => l.includes('DeclareBlockersReq'))!
    const types = extractGreMessages(withBlockers).map(m => m.type)
    expect(types).toContain('GREMessageType_DeclareBlockersReq')
  })
})

describe('replaying a recorded match', () => {
  const lines = fixture()

  it('learns which seat we are', () => {
    expect(replay(lines).seat).toBe(2)
  })

  it('tracks both life totals', () => {
    const state = replay(lines)
    expect(Object.keys(state.life).sort()).toEqual(['1', '2'])
    for (const life of Object.values(state.life)) {
      expect(life).toBeGreaterThanOrEqual(0)
      expect(life).toBeLessThanOrEqual(20)
    }
  })

  it('ends up with creatures on the battlefield, with real power and toughness', () => {
    const state = replay(lines)
    const mine = creatures(state, state.seat)
    expect(mine.length).toBeGreaterThan(0)
    for (const c of mine) {
      expect(typeof c.power).toBe('number')
      expect(typeof c.toughness).toBe('number')
    }
  })

  it('keeps power and toughness through a diff that does not mention them', () => {
    // The bug this guards: a diff carries only what changed, so replacing the
    // object instead of merging silently blanks a creature's stats the moment
    // anything else about it updates. A board with undefined power reads as a
    // legal move that loses the game.
    const state = replay(lines)
    const withStats = Object.values(state.objects).filter(
      o => o.cardTypes?.includes('CardType_Creature') && o.power !== undefined
    )
    expect(withStats.length).toBeGreaterThan(0)
  })
})

describe('the decision the GRE is waiting for', () => {
  const lines = fixture()

  it('surfaces a blocker request with the legal attackers already resolved', () => {
    const state = replayUntil(lines, s => s.decision?.kind === 'blockers')
    expect(state.decision?.kind).toBe('blockers')
    const decision = state.decision as Extract<GameState['decision'], { kind: 'blockers' }>
    expect(decision.blockers.length).toBeGreaterThan(0)
    for (const b of decision.blockers) {
      expect(typeof b.blockerInstanceId).toBe('number')
      // This is the whole point: legality comes from the GRE, so evasion,
      // menace and protection are already applied and nothing is re-derived.
      expect(Array.isArray(b.legalAttackers)).toBe(true)
      expect(b.legalAttackers.length).toBeGreaterThan(0)
    }
  })

  it('names a blocker that is actually a creature we control', () => {
    const state = replayUntil(lines, s => s.decision?.kind === 'blockers')
    const decision = state.decision as Extract<GameState['decision'], { kind: 'blockers' }>
    const ours = new Set(creatures(state, state.seat).map(c => c.instanceId))
    for (const b of decision.blockers) expect(ours.has(b.blockerInstanceId)).toBe(true)
  })

  it('reports blocks once they are declared', () => {
    const state = replayUntil(
      lines,
      s => s.decision?.kind === 'blockers' &&
           (s.decision as any).blockers.some((b: any) => b.declared.length > 0)
    )
    const decision = state.decision as Extract<GameState['decision'], { kind: 'blockers' }>
    expect(decision.blockers.some(b => b.declared.length > 0)).toBe(true)
  })

  it('knows when the question is ours to answer', () => {
    const state = replayUntil(lines, s => s.decision?.kind === 'blockers')
    expect(state.turn.decisionPlayer).toBe(state.seat)
    expect(ourTurnToAct(state)).toBe(true)
  })

  it('clears the decision once the next state arrives', () => {
    // A stale decision is worse than none: it would have the agent answer a
    // question the GRE already moved past.
    let seenDecision = false
    let clearedAfterwards = false
    let state = emptyGame()
    for (const line of lines) {
      for (const message of extractGreMessages(line)) {
        state = applyMessage(state, message)
        if (state.decision?.kind === 'blockers') seenDecision = true
        else if (seenDecision && state.decision === null) clearedAfterwards = true
      }
    }
    expect(seenDecision).toBe(true)
    expect(clearedAfterwards).toBe(true)
  })
})

describe('questions the play loop asks', () => {
  const lines = fixture()

  it('reads the running clock, not the five idle timers', () => {
    const state = replayUntil(lines, s => s.timerSeconds !== undefined)
    expect(state.timerSeconds).toBeGreaterThan(0)
    expect(state.timerSeconds).toBeLessThan(200)
  })

  it('counts the opponent untapped lands', () => {
    const state = replay(lines)
    const opponent = state.seat === 1 ? 2 : 1
    const open = openMana(state, opponent)
    expect(open).toBeGreaterThanOrEqual(0)
    expect(open).toBeLessThanOrEqual(battlefield(state, opponent).length)
  })

  it('separates the two battlefields', () => {
    const state = replay(lines)
    const mine = battlefield(state, state.seat).map(o => o.instanceId)
    const theirs = battlefield(state, state.seat === 1 ? 2 : 1).map(o => o.instanceId)
    expect(mine.filter(id => theirs.includes(id))).toEqual([])
  })
})

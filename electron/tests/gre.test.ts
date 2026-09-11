import { describe, expect, it } from 'vitest'
import { gunzipSync } from 'node:zlib'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  applyMessage, battlefield, creatures, emptyGame, extractGreMessages,
  ourTurnToAct, openMana, replay, bestAssignment, type GameState,
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

describe('damage assignment on a gang block', () => {
  function prompts(): string[] {
    const raw = gunzipSync(readFileSync(join(__dirname, 'fixtures/gre-prompts.log.gz')))
    return raw.toString('utf8').split('\n').filter(Boolean)
  }

  it('names the decision instead of calling it "other"', () => {
    // This is why a game silently stalls at combat damage. It went unlabelled
    // for a whole session and every occurrence meant grepping the log by hand.
    const seen = prompts().flatMap(l => extractGreMessages(l))
      .map(m => applyMessage(emptyGame(), m).decision?.kind)
      .filter(Boolean)
    expect(seen).toContain('assignDamage')
  })

  it('reports each blocker with the damage that kills it', () => {
    let found: any = null
    for (const line of prompts()) {
      for (const m of extractGreMessages(line)) {
        const d = applyMessage(emptyGame(), m).decision
        if (d?.kind === 'assignDamage' && d.assigners[0]?.targets.length > 1) found = d
      }
    }
    expect(found).not.toBeNull()
    const a = found.assigners[0]
    expect(a.total).toBeGreaterThan(0)
    for (const t of a.targets) {
      if (!t.isPlayer) expect(t.lethal).toBeGreaterThan(0)
    }
  })

  it('spends damage cheapest-first, so a gang block kills the most creatures', () => {
    // The real case from a practice game: a 4/4 blocked by a 2/1, a 2/2, a 1/1,
    // another 1/1 and a 2/3. Four damage, spent well, kills three of them.
    const plan = bestAssignment(4, [
      { instanceId: 293, lethal: 1 },
      { instanceId: 316, lethal: 2 },
      { instanceId: 333, lethal: 1 },
      { instanceId: 340, lethal: 1 },
      { instanceId: 351, lethal: 3 },
    ])
    expect(plan.filter(p => p.kills).length).toBe(3)
    expect(plan.reduce((n, p) => n + p.damage, 0)).toBe(4)
    // Never the single biggest blocker: that spends three damage for one kill.
    expect(plan.map(p => p.instanceId)).not.toContain(351)
  })

  it('trample: kills what it can, then sends the rest at the player', () => {
    const plan = bestAssignment(16, [
      { instanceId: 331, lethal: 5 },
      { instanceId: 354, lethal: 3 },
      { instanceId: 2, max: 8, isPlayer: true },
    ])
    expect(plan.find(p => p.instanceId === 2)?.damage).toBe(8)
    expect(plan.filter(p => p.kills).length).toBe(2)
  })

  it('assigns nothing it cannot afford', () => {
    const plan = bestAssignment(1, [{ instanceId: 1, lethal: 5 }, { instanceId: 2, lethal: 4 }])
    expect(plan).toEqual([])
  })
})

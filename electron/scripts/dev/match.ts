/** Print the live match state, read from Arena's log rather than the screen. */
import { readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { replay, creatures, battlefield, openMana, ourTurnToAct, bestAssignment } from '../../shared/gre'


const LOG = process.env.MTGA_LOG ?? join(homedir(), 'Library/Logs/Wizards of the Coast/MTGA/Player.log')
const state = replay(readFileSync(LOG, 'utf8').split('\n'))
const me = state.seat
const them = me === 1 ? 2 : 1

// Elapsed since the game started, so slowness is visible rather than felt.
let elapsed = ''
try {
  const t0 = Number(readFileSync('/tmp/game-start', 'utf8').trim())
  const secs = Math.round(Date.now() / 1000 - t0)
  elapsed = `  [${Math.floor(secs / 60)}m${String(secs % 60).padStart(2, '0')}s]`
} catch { /* no timer running */ }
console.log(`seat ${me ?? '?'}  ·  turn ${state.turn.turnNumber ?? '?'}  ${state.turn.phase ?? ''} ${state.turn.step ?? ''}`)
console.log(`life  me ${state.life[me!] ?? '?'}  ·  them ${state.life[them] ?? '?'}` +
            (state.timerSeconds !== undefined ? `  ·  clock ${state.timerSeconds}s` : ''))
if (state.finished) console.log(`FINISHED winner=${state.finished.winner} ${state.finished.reason ?? ''}`)

for (const [label, seat] of [['mine', me], ['theirs', them]] as const) {
  const cs = creatures(state, seat as number)
  console.log(`${label}: ${cs.length} creature(s)` + (cs.length ? ' — ' + cs.map(c =>
    `#${c.instanceId} ${c.power ?? '?'}/${c.toughness ?? '?'}${c.isTapped ? ' tapped' : ''}${c.hasSummoningSickness ? ' sick' : ''}`
  ).join(', ') : ''))
}
console.log(`their open mana: ${me ? openMana(state, them) : '?'} · their permanents: ${battlefield(state, them).length}`)
// The hand, by type. Enough to judge a mulligan without naming a single card:
// land count is the question, and the rest is curve.
const zoneOf = new Map(Object.values(state.zones).map(z => [z.zoneId, `${z.type}:${z.ownerSeatId ?? ''}`]))
const hand = Object.values(state.objects).filter(o => (zoneOf.get(o.zoneId!) ?? '').startsWith(`ZoneType_Hand:${me}`))
const kind = (o: typeof hand[number]) => o.cardTypes?.[0]?.replace('CardType_', '') ?? '?'
const tally = hand.reduce<Record<string, number>>((acc, o) => { acc[kind(o)] = (acc[kind(o)] ?? 0) + 1; return acc }, {})
console.log(`hand (${hand.length}): ` + Object.entries(tally).map(([k, n]) => `${n} ${k}`).join(', ') +
            (hand.length ? '  [' + hand.map(o => `#${o.instanceId}:${kind(o)[0]}`).join(' ') + ']' : ''))
const myLands = battlefield(state, me!).filter(o => o.cardTypes?.includes('CardType_Land'))
console.log(`my lands: ${myLands.length} (${myLands.filter(l => !l.isTapped).length} untapped)`)
console.log(`decision: ${state.decision ? state.decision.kind : 'none'}${ourTurnToAct(state) ? '  <-- OURS TO ANSWER' : ''}`)
if (state.decision?.kind === 'blockers') {
  for (const b of state.decision.blockers) {
    console.log(`  blocker #${b.blockerInstanceId} may block: ${b.legalAttackers.join(', ')}` +
                (b.declared.length ? `  (declared: ${b.declared.join(', ')})` : ''))
  }
}
if (state.decision?.kind === 'assignDamage') {
  // Print the plan, not just the prompt. This is the decision that stalls a
  // game when it goes unnoticed and wins one when it is taken well.
  for (const a of state.decision.assigners) {
    console.log(`  #${a.instanceId} divides ${a.total} damage:`)
    for (const t of a.targets) {
      console.log(`     #${t.instanceId}${t.isPlayer ? ' (player)' : ''} lethal=${t.lethal ?? '-'} assigned=${t.assigned ?? '-'}`)
    }
    const plan = bestAssignment(a.total, a.targets)
    console.log(`     best: ${plan.map(p => `${p.damage}->#${p.instanceId}`).join(' ')} ` +
                `(${plan.filter(p => p.kills).length} kill(s))`)
  }
}
if (state.decision?.kind === 'chooseN') {
  const d = state.decision
  console.log(`  choose ${d.min ?? '?'}-${d.max ?? '?'} of ${d.options.length} option(s)`)
}
if (state.decision?.kind === 'actions') {
  console.log(`  ${state.decision.actions.length} legal action(s): ` +
    state.decision.actions.slice(0, 8).map(a => `${a.actionType.replace('ActionType_','')}#${a.instanceId ?? ''}`).join(' '))
}

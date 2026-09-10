/**
 * Drive a match at speed.
 *
 * One long-running process rather than a fresh one per look: the state comes
 * from the log, and re-reading it costs a few milliseconds, while starting a
 * TypeScript runtime costs about a second. At a decision a turn that difference
 * is the whole budget.
 *
 * It advances anything mechanical on its own — passing priority, confirming a
 * step — and stops the moment a decision needs judgement, printing the board and
 * the legal options. Blocks and targets are never taken automatically: those are
 * the ones that lose games.
 */
import { execFileSync } from 'child_process'
import { readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { replay, creatures, openMana, battlefield, type GameState } from '../../shared/gre'

const LOG = join(homedir(), 'Library/Logs/Wizards of the Coast/MTGA/Player.log')
const ADVANCE = { x: 0.9250, y: 0.8890 }   // the bottom-right step button
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function state(): GameState {
  return replay(readFileSync(LOG, 'utf8').split('\n'))
}
function click(x: number, y: number): void {
  try { execFileSync('macctl', ['click', 'MTGA', String(x), String(y)], { stdio: 'ignore', timeout: 15000 }) } catch { /* refused is fine */ }
}
function line(s: GameState): string {
  const me = s.seat!, them = me === 1 ? 2 : 1
  const show = (seat: number) => creatures(s, seat).map(c => `${c.power}/${c.toughness}`).join(' ') || '-'
  return `t${s.turn.turnNumber} ${(s.turn.step ?? '').replace('Step_', '')} | ${s.life[me]}-${s.life[them]} | me ${show(me)} vs ${show(them)} | their mana ${openMana(s, them)}`
}

const NEEDS_JUDGEMENT = new Set(['blockers', 'targets', 'mulligan'])

async function main() {
  let last = ''
  for (let i = 0; i < Number(process.argv[2] ?? 60); i++) {
    const s = state()
    const now = line(s)
    if (now !== last) { console.log(now); last = now }
    if (s.finished) { console.log(`FINISHED winner=${s.finished.winner} ${s.finished.reason ?? ''}`); return }

    const d = s.decision
    const ours = d && s.turn.decisionPlayer === s.seat
    if (ours && NEEDS_JUDGEMENT.has(d!.kind)) {
      console.log(`STOP: ${d!.kind}`)
      if (d!.kind === 'blockers') for (const b of (d as any).blockers)
        console.log(`   blocker #${b.blockerInstanceId} may block ${b.legalAttackers.join(',') || '(none)'}` +
                    (b.declared.length ? ` declared:${b.declared.join(',')}` : ''))
      return
    }
    if (ours && d!.kind === 'attackers') { console.log('STOP: attackers'); return }
    // A main phase with something to deploy is NOT mechanical, and treating it
    // as such cost four turns and the whole board: the loop happily passed
    // priority through two of my own main phases with a creature and a land
    // drop in hand, while the opponent developed unopposed.
    // Only my own main phase is worth stopping for. Holding priority during
    // combat with an instant in hand is not a deployment decision, and treating
    // it as one halts the loop at every step of every combat.
    const myMain = s.turn.activePlayer === s.seat &&
      (s.turn.phase === 'Phase_Main1' || s.turn.phase === 'Phase_Main2')
    if (ours && myMain && d!.kind === 'actions') {
      // The engine's action list is NOT filtered by affordability: on turn one
      // with no lands it still lists every Cast in hand. So compare against the
      // mana actually available, or the loop stops every turn on spells that
      // cannot be cast and never advances.
      const untapped = battlefield(s, s.seat!).filter(
        o => o.cardTypes?.includes('CardType_Land') && !o.isTapped).length
      const cost = (a: any) => (a.manaCost ?? []).reduce((n: number, m: any) => n + (m.count ?? 0), 0)
      const deployable = (d as any).actions.filter((a: any) =>
        a.actionType === 'ActionType_Play' ||
        (a.actionType === 'ActionType_Cast' && cost(a) <= untapped))
      if (deployable.length) {
        console.log(`STOP: ${deployable.length} thing(s) to deploy — ` +
          deployable.map((a: any) => `${a.actionType.replace('ActionType_', '')}#${a.instanceId}`).join(' '))
        return
      }
    }
    // Anything else is mechanical: advance.
    click(ADVANCE.x, ADVANCE.y)
    await sleep(1200)
  }
  console.log('loop budget spent')
}
main()

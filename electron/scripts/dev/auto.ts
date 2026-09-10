/** Play a practice game on autopilot. Stops only for genuine choices. */
import { execFileSync } from 'child_process'
import { readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { replay, creatures, battlefield, type GameState } from '../../shared/gre'

const LOG = join(homedir(), 'Library/Logs/Wizards of the Coast/MTGA/Player.log')
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const state = () => replay(readFileSync(LOG, 'utf8').split('\n'))
function sh(cmd: string, args: string[]): string {
  try { return execFileSync(cmd, args, { encoding: 'utf8', timeout: 20000, stdio: ['ignore','pipe','ignore'] }) } catch { return '' }
}
const click = (x: number, y: number) => sh('macctl', ['click', 'MTGA', String(x), String(y)])
const key = (k: string) => sh('macctl', ['key', k])
const ADV: [number, number] = [0.9250, 0.8890]
const pt = (x: number, y: number): [number, number] => [(x - 152) / 1280, (y - 33) / 748]

/** Card positions in hand, by name, from one unmerged capture. */
function hand(): Array<{ x: number; y: number; name: string }> {
  const out = sh('macctl', ['read', 'MTGA', '--region', '0.05,0.78,0.90,0.22', '--boxes'])
  try {
    return (JSON.parse(out.trim().split('\n').pop()!).boxes ?? [])
      // The hand only ever occupies the middle of the bottom strip. The corners
      // hold the player name and the step button, and grabbing the username by
      // mistake produces a very visible drag from the bottom-left corner across
      // the whole screen, over and over.
      .filter((b: any) => b.text.trim().length > 3 && b.at[1] > 690 &&
                          b.at[0] > 420 && b.at[0] < 1240)
      .map((b: any) => ({ x: b.at[0], y: b.at[1], name: b.text.trim() }))
  } catch { return [] }
}

function line(s: GameState): string {
  const me = s.seat!, them = me === 1 ? 2 : 1
  const show = (q: number) => creatures(s, q).map(c => `${c.power}/${c.toughness}`).join(' ') || '-'
  return `t${s.turn.turnNumber} ${(s.turn.step ?? '').replace('Step_', '')} | ${s.life[me]}-${s.life[them]} | ${show(me)} vs ${show(them)}`
}

async function main() {
  let last = '', idle = 0
  for (let i = 0; i < Number(process.argv[2] ?? 120); i++) {
    const s = state()
    const now = line(s)
    if (now !== last) { console.log(now); last = now; idle = 0 } else if (++idle > 12) { console.log('stalled'); return }
    if (s.finished) { console.log(`FINISHED winner=${s.finished.winner}`); return }

    const d = s.decision
    const ours = d && s.turn.decisionPlayer === s.seat
    if (!ours) { await sleep(900); continue }

    if (d!.kind === 'targets' || d!.kind === 'mulligan' || d!.kind === 'other') { console.log(`STOP: ${d!.kind}`); return }

    if (d!.kind === 'blockers') {
      // Block only when it is clearly good: my blocker survives, or it kills
      // the attacker. Anything else takes the damage.
      const mine = new Map(creatures(s, s.seat!).map(c => [c.instanceId, c]))
      let blocked = false
      for (const b of (d as any).blockers) {
        const me2 = mine.get(b.blockerInstanceId); if (!me2) continue
        for (const aid of b.legalAttackers) {
          const a = s.objects[aid]; if (!a) continue
          const kills = (me2.power ?? 0) >= (a.toughness ?? 99)
          const survives = (a.power ?? 99) < (me2.toughness ?? 0)
          if (kills || survives) {
            console.log(`  block #${b.blockerInstanceId} -> #${aid}`)
            // Positions are unknown here; the click path is the caller's job.
            blocked = true; break
          }
        }
        if (blocked) break
      }
      if (!blocked) { click(...ADV); await sleep(1400); continue }
      console.log('STOP: a block is worth making'); return
    }

    if (d!.kind === 'attackers') { key('a'); await sleep(900); click(...ADV); await sleep(900); click(...ADV); await sleep(1600); continue }

    // actions: in my own main phase, deploy; otherwise pass.
    const myMain = s.turn.activePlayer === s.seat &&
      (s.turn.phase === 'Phase_Main1' || s.turn.phase === 'Phase_Main2')
    if (!myMain) { click(...ADV); await sleep(1100); continue }

    const untapped = battlefield(s, s.seat!).filter(o => o.cardTypes?.includes('CardType_Land') && !o.isTapped).length
    const acts = (d as any).actions as any[]
    const cost = (a: any) => (a.manaCost ?? []).reduce((n: number, m: any) => n + (m.count ?? 0), 0)
    const land = acts.find(a => a.actionType === 'ActionType_Play')
    const spell = acts.filter(a => a.actionType === 'ActionType_Cast' && cost(a) <= untapped)
      .filter(a => s.objects[a.instanceId]?.cardTypes?.includes('CardType_Creature'))
      .sort((a, b) => cost(b) - cost(a))[0]
    const want = land ? s.objects[land.instanceId] : spell ? s.objects[spell.instanceId] : null
    if (!want) { click(...ADV); await sleep(1100); continue }

    // Match the intended card to a name on screen by type, then drag it out.
    const isLand = want.cardTypes?.includes('CardType_Land')
    const cards = hand()
    const target = isLand
      ? cards.find(c => /forest|island|swamp|mountain|plains|wilds|passage|tunnel|cave/i.test(c.name))
      : cards.find(c => !/forest|island|swamp|mountain|plains|wilds|passage/i.test(c.name))
    if (!target) { click(...ADV); await sleep(1100); continue }
    console.log(`  play ${target.name}`)
    const [fx, fy] = pt(target.x, target.y + 20)
    const [gx, gy] = pt(660, 480)
    sh('macctl', ['drag', 'MTGA', String(fx), String(fy), String(gx), String(gy), '--steps', '26'])
    await sleep(2200)
  }
}
main()

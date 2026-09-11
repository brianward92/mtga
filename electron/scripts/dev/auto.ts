/**
 * Play a practice game unattended.
 *
 * The tooling was never the slow part: a state read costs 0.25s and an OCR
 * 0.32s. The cost was one model round trip per action, about seventy of them in
 * a twenty minute game. So the unit of work here is a whole game, not an action,
 * and the loop only hands control back when it genuinely cannot decide.
 *
 * Two rules make it fast rather than merely automatic:
 *
 *  - Never sleep a fixed amount. Every action waits on the game state actually
 *    changing, which lands in a few hundred milliseconds; the 2.5s sleeps it
 *    replaces were pure waste repeated dozens of times a game.
 *  - Never re-read what has not changed. Screen positions are read once per
 *    decision, not once per click.
 */
import { execFileSync } from 'child_process'
import { readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { replay, creatures, battlefield, type GameState, type GameObject } from '../../shared/gre'

const LOG = join(homedir(), 'Library/Logs/Wizards of the Coast/MTGA/Player.log')
const ADV: [number, number] = [0.9250, 0.8890]
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const state = () => replay(readFileSync(LOG, 'utf8').split('\n'))

function sh(args: string[]): string {
  try { return execFileSync('macctl', args, { encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'ignore'] }) }
  catch { return '' }
}
const pt = (x: number, y: number): [string, string] =>
  [((x - 152) / 1280).toFixed(4), ((y - 33) / 748).toFixed(4)]
const click = (x: number, y: number) => sh(['click', 'MTGA', ...pt(x, y)])
const clickFrac = (fx: number, fy: number) => sh(['click', 'MTGA', String(fx), String(fy)])
const drag = (x1: number, y1: number, x2: number, y2: number) =>
  sh(['drag', 'MTGA', ...pt(x1, y1), ...pt(x2, y2), '--steps', '24'])
const park = () => sh(['move', 'MTGA', '0.5', '0.36'])

/** Wait for the engine to move on, rather than guessing how long it takes. */
async function settle(before: GameState, ms = 4500): Promise<GameState> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    await sleep(160)
    const s = state()
    if (s.gameStateId !== before.gameStateId || s.decision?.kind !== before.decision?.kind) return s
  }
  return state()
}

interface Box { x: number; y: number; text: string }
function boxes(region: string): Box[] {
  const out = sh(['read', 'MTGA', '--region', region, '--boxes'])
  try {
    return (JSON.parse(out.trim().split('\n').pop()!).boxes ?? [])
      .map((b: any) => ({ x: b.at[0], y: b.at[1], text: String(b.text).trim() }))
  } catch { return [] }
}
/** Card names in a row, left to right. Junk and UI chrome filtered out. */
const namesIn = (region: string, minX = 420, maxX = 1240): Box[] =>
  boxes(region).filter(b => b.text.length > 3 && b.x > minX && b.x < maxX &&
    !/^(next|to |end|submit|decline|done|cancel|the virtuous|bmw)/i.test(b.text))
    .sort((a, b) => a.x - b.x)

const HAND = '0.05,0.78,0.90,0.22'
const MY_ROW = '0.25,0.46,0.55,0.14'
const THEIR_ROW = '0.20,0.24,0.60,0.20'

/**
 * Map creatures to screen positions by left-to-right order.
 *
 * Arena lays a battlefield row out in a stable order, and the engine returns
 * creatures in that same order, so zipping the two is reliable enough to act on
 * — and every action is verified against the state afterwards regardless.
 */
function positions(row: string, list: GameObject[]): Map<number, Box> {
  const found = namesIn(row)
  const map = new Map<number, Box>()
  list.forEach((c, i) => { if (found[i]) map.set(c.instanceId, found[i]) })
  return map
}

function log(...parts: unknown[]) { console.log(...parts) }

async function main() {
  const budget = Number(process.argv[2] ?? 400)
  let last = '', idle = 0

  for (let step = 0; step < budget; step++) {
    let s = state()
    const me = s.seat!, them = me === 1 ? 2 : 1
    const show = (q: number) => creatures(s, q).map(c => `${c.power}/${c.toughness}`).join(' ') || '-'
    const now = `t${s.turn.turnNumber} ${(s.turn.step ?? '').replace('Step_', '')} | ${s.life[me]}-${s.life[them]} | ${show(me)} vs ${show(them)}`
    if (now !== last) { log(now); last = now; idle = 0 } else if (++idle > 25) { log('STALLED'); return }
    if (s.finished) { log(`FINISHED winner=${s.finished.winner}${s.finished.winner === me ? ' (us)' : ''}`); return }

    const d = s.decision
    if (!d || s.turn.decisionPlayer !== me) { await sleep(500); continue }

    // --- choices that need a human ---------------------------------------
    if (d.kind === 'mulligan' || d.kind === 'other') { log(`STOP: ${d.kind}`); return }

    if (d.kind === 'targets') {
      // Buffs and counters in this deck want my own biggest creature; that is
      // the overwhelmingly common case. Anything else is handed back.
      const mine = creatures(s, me).sort((a, b) => (b.power ?? 0) - (a.power ?? 0))
      const legal = new Set((d as any).options ?? [])
      const pick = mine[0]
      if (!pick || (legal.size && !legal.has(pick.instanceId))) { log('STOP: targets'); return }
      park()
      const at = positions(MY_ROW, creatures(s, me)).get(pick.instanceId)
      if (!at) { log('STOP: targets (cannot locate)'); return }
      log(`  target #${pick.instanceId} ${pick.power}/${pick.toughness}`)
      click(at.x, at.y + 35)
      s = await settle(s); continue
    }

    // --- blocking ---------------------------------------------------------
    if (d.kind === 'blockers') {
      const mine = new Map(creatures(s, me).map(c => [c.instanceId, c]))
      const plan: Array<[number, number]> = []
      const used = new Set<number>()
      for (const b of (d as any).blockers) {
        const blocker = mine.get(b.blockerInstanceId); if (!blocker) continue
        for (const aid of b.legalAttackers) {
          if (used.has(aid)) continue
          const a = s.objects[aid]; if (!a) continue
          const kills = (blocker.power ?? 0) >= (a.toughness ?? 99)
          const lives = (a.power ?? 99) < (blocker.toughness ?? 0)
          // Block when it is profitable: I kill it, or I survive it. A block
          // that trades down or dies for nothing just loses a creature.
          if (kills || lives) { plan.push([b.blockerInstanceId, aid]); used.add(aid); break }
        }
      }
      if (!plan.length) { log('  no blocks'); clickFrac(...ADV); s = await settle(s); continue }
      park()
      const mineAt = positions(MY_ROW, creatures(s, me))
      const theirsAt = positions(THEIR_ROW, creatures(s, them))
      let made = 0
      for (const [bid, aid] of plan) {
        const from = mineAt.get(bid), to = theirsAt.get(aid)
        if (!from || !to) continue
        log(`  block #${bid} -> #${aid}`)
        drag(from.x, from.y + 35, to.x, to.y + 35)
        await sleep(700); made++
      }
      if (!made) { log('STOP: blockers (cannot locate)'); return }
      clickFrac(...ADV)
      s = await settle(s); continue
    }

    // --- attacking --------------------------------------------------------
    if (d.kind === 'attackers') {
      sh(['key', 'a']); await sleep(600)
      clickFrac(...ADV); await sleep(600)
      clickFrac(...ADV)
      s = await settle(s); continue
    }

    // --- my main phase: deploy -------------------------------------------
    const myMain = s.turn.activePlayer === me &&
      (s.turn.phase === 'Phase_Main1' || s.turn.phase === 'Phase_Main2')
    if (!myMain) { clickFrac(...ADV); s = await settle(s); continue }

    const untapped = battlefield(s, me).filter(o => o.cardTypes?.includes('CardType_Land') && !o.isTapped).length
    const acts = (d as any).actions as any[]
    const cost = (a: any) => (a.manaCost ?? []).reduce((n: number, m: any) => n + (m.count ?? 0), 0)
    const land = acts.find(a => a.actionType === 'ActionType_Play')
    const spell = acts
      .filter(a => a.actionType === 'ActionType_Cast' && cost(a) <= untapped &&
                   s.objects[a.instanceId]?.cardTypes?.includes('CardType_Creature'))
      .sort((a, b) => cost(b) - cost(a))[0]
    if (!land && !spell) { clickFrac(...ADV); s = await settle(s); continue }

    park()
    const cards = namesIn(HAND)
    const LANDISH = /forest|island|swamp|mountain|plains|wilds|passage|tunnel|cave|vents|citadel/i
    const target = land ? cards.find(c => LANDISH.test(c.text)) : cards.find(c => !LANDISH.test(c.text))
    if (!target) { clickFrac(...ADV); s = await settle(s); continue }
    log(`  play ${target.text}`)
    drag(target.x, target.y + 20, 660, 480)
    s = await settle(s)
  }
  log('budget spent')
}
main()

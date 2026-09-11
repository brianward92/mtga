/**
 * Keep the match alive when nobody is driving it.
 *
 * Everything else here reads the game from Arena's log and clicks through the
 * UI, and every one of those clicks waits on a model. When the model is absent
 * — compaction, a long think, a crash — nothing answers, and three consecutive
 * rope expiries end the match. That is exactly how game 3 of the LCI draft was
 * lost: the board was 17-18 and winnable, the clock was not.
 *
 * So this process answers when no one else will. Its defaults are deliberately
 * dumb, because the goal is survival, not play: a wasted turn is recoverable
 * and a timeout is not. Every prompt it answers resets Arena's timeout count,
 * which buys the model back as many turns as it needs.
 *
 * It also replaces the polling watcher. That one spawned a fresh `tsx match.ts`
 * every 1.2s, and each spawn re-read and re-replayed the whole 16MB log — about
 * 600ms of work to learn nothing had changed. This keeps one state in memory
 * and applies only the bytes that arrived since the last look.
 *
 *   tsx guard.ts                 watch and defend, 35s patience
 *   tsx guard.ts --idle 20       shorter fuse
 *   tsx guard.ts --watch-only    report, never click
 */
import { readFileSync, statSync, openSync, readSync, closeSync, appendFileSync } from 'fs'
import { execFileSync } from 'child_process'
import { homedir } from 'os'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { replay, emptyGame, creatures, ourTurnToAct, type GameState } from '../../shared/gre'

const HERE = dirname(fileURLToPath(import.meta.url))
const LOG = process.env.MTGA_LOG ?? join(homedir(), 'Library/Logs/Wizards of the Coast/MTGA/Player.log')
const JOURNAL = process.env.GUARD_JOURNAL ?? '/tmp/mtga-guard.log'
const argv = process.argv.slice(2)
const IDLE_MS = Number(argv[argv.indexOf('--idle') + 1] ?? 35) * 1000
const WATCH_ONLY = argv.includes('--watch-only')

const say = (m: string) => {
  const line = `${new Date().toISOString().slice(11, 19)} ${m}`
  console.log(line)
  try { appendFileSync(JOURNAL, line + '\n') } catch { /* journal is a courtesy */ }
}

/**
 * Read only what arrived since last time.
 *
 * The log is append-only until Arena rotates it, which shows up as the file
 * being shorter than our offset. On rotation, start over from an empty game
 * rather than applying the new file's bytes to the old file's state.
 */
let offset = 0
let state: GameState = emptyGame()
let carry = ''
function pump(): GameState {
  let size: number
  try { size = statSync(LOG).size } catch { return state }
  if (size < offset) { offset = 0; carry = ''; state = emptyGame(); say('log rotated; state reset') }
  if (size === offset) return state
  const fd = openSync(LOG, 'r')
  const buf = Buffer.allocUnsafe(size - offset)
  readSync(fd, buf, 0, buf.length, offset)
  closeSync(fd)
  offset = size
  const text = carry + buf.toString('utf8')
  const lines = text.split('\n')
  carry = lines.pop() ?? ''            // a trailing partial line completes next pump
  state = replay(lines, state)
  return state
}

/** The bottom-right step button's label, unmerged. Arena's only reliable tell. */
function button(): string {
  try {
    const out = execFileSync('macctl', ['read', 'MTGA', '--region', '0.78,0.83,0.22,0.15', '--boxes'],
      { encoding: 'utf8', timeout: 8000 })
    return (JSON.parse(out).boxes ?? []).map((b: any) => String(b.text).trim()).join(' / ')
  } catch { return '' }
}

/**
 * Is somebody else driving? If so, stand down.
 *
 * Two signals, because neither alone is enough. A helper script running is the
 * obvious one, but it misses the gap that matters most: the model has decided
 * what to do and is between commands, which is exactly when a fixed idle timer
 * expires. So anything driving this game touches a lock file first, and a
 * fresh lock means hands off.
 *
 * The first version of this guard had only the pgrep, and it cost a turn in
 * its very first game: it passed priority three times while the model was
 * diagnosing something with ad-hoc macctl calls, which moved us out of the
 * main phase and quietly made every land drop illegal. The failure looked
 * exactly like "drags do not work".
 */
const LOCK = process.env.GUARD_LOCK ?? '/tmp/mtga-acting'
const LOCK_GRACE_MS = Number(process.env.GUARD_LOCK_GRACE ?? 25) * 1000
function someoneDriving(): boolean {
  try {
    const age = Date.now() - statSync(LOCK).mtimeMs
    if (age < LOCK_GRACE_MS) return true
  } catch { /* no lock file is not a reason to stand down */ }
  try {
    execFileSync('pgrep', ['-f', 'scripts/dev/(act|step|btn|play-card|attacker|deckbuild)\\.(sh|ts)'],
      { encoding: 'utf8', timeout: 3000 })
    return true
  } catch { return false }
}

const sh = (script: string, args: string[] = []) => {
  try { return execFileSync('bash', [join(HERE, script), ...args], { encoding: 'utf8', timeout: 25000 }) }
  catch (e: any) { return String(e.stdout ?? '') + String(e.stderr ?? '') }
}

/**
 * Incoming damage if we block nothing. The one number that decides whether the
 * safe default (take it) is actually safe.
 */
function incoming(s: GameState): number {
  const them = s.seat === 1 ? 2 : 1
  return creatures(s, them).filter(c => (c.attacking?.length ?? 0) > 0).reduce((n, c) => n + (c.power ?? 0), 0)
}

/**
 * Answer the prompt the cheapest safe way.
 *
 * Never attacks and never blocks: both commit material, both are how the two
 * earlier games were actually lost, and neither is needed to stay alive. The
 * one exception is lethal on the table, where not blocking loses immediately —
 * there we shout rather than guess, because a blind block drag is how game 1
 * went wrong and an unanswered prompt at least leaves the model something to
 * come back to.
 */
function defend(s: GameState) {
  const kind = s.decision?.kind ?? 'none'
  const label = button()
  const refuse = /Al+ Attack|[0-9]+ (Attacker|Blocker)/i.test(label)
  switch (kind) {
    case 'mulligan':
      say(`DEFAULT keep (mulligan) [${label}]`); sh('btn.sh', ['Keep']); return
    case 'attackers':
      say(`DEFAULT no attacks [${label}]`); sh('btn.sh', ['No Attack']); return
    case 'blockers': {
      const dmg = incoming(s), life = s.life[s.seat!] ?? 20
      if (dmg >= life) { say(`ALERT lethal on board (${dmg} into ${life}) — refusing to guess a block [${label}]`); return }
      say(`DEFAULT no blocks (${dmg} into ${life}) [${label}]`); sh('btn.sh', ['No Block']); return
    }
    case 'actions':
      if (refuse) { say(`ALERT button is '${label}' — will not auto-declare`); return }
      say(`DEFAULT pass priority [${label}]`); sh('step.sh', [label.split(' / ')[0] || 'advance']); return
    default:
      // targets, chooseN, assignDamage, confirm: anything that commits a real
      // choice. Click only a plainly neutral confirm; otherwise say so loudly.
      if (/Submit|Resolve|OK|Done|Continue|Take Action/i.test(label) && !refuse) {
        say(`DEFAULT confirm '${label}' (${kind})`); sh('step.sh', [label.split(' / ')[0]]); return
      }
      say(`ALERT ${kind} needs a real answer [${label}]`)
  }
}

let sinceKey = '', sinceAt = Date.now(), lastPrint = ''
say(`guard up: idle=${IDLE_MS / 1000}s watchOnly=${WATCH_ONLY} log=${LOG}`)
setInterval(() => {
  const s = pump()
  const ours = ourTurnToAct(s)
  const key = `${s.gameStateId}:${s.decision?.kind ?? 'none'}:${ours}`
  if (key !== sinceKey) { sinceKey = key; sinceAt = Date.now() }

  const line = `seat ${s.seat ?? '?'} turn ${s.turn.turnNumber ?? '?'} ${s.turn.phase ?? ''} ` +
    `life ${s.life[s.seat!] ?? '?'}-${s.life[s.seat === 1 ? 2 : 1] ?? '?'} ` +
    (s.timerSeconds !== undefined ? `clock ${s.timerSeconds}s ` : '') +
    `decision ${s.decision?.kind ?? 'none'}${ours ? ' <-- OURS' : ''}` +
    (s.finished ? ` FINISHED winner=${s.finished.winner} ${s.finished.reason ?? ''}` : '')
  if (line !== lastPrint) { say(line); lastPrint = line }

  if (!ours || s.finished || WATCH_ONLY) return
  // Arena only penalises us when its own clock runs out, so a short rope beats
  // the idle timer: act at 12s left however recently the decision arrived.
  const roped = s.timerSeconds !== undefined && s.timerSeconds <= 12
  if (!roped && Date.now() - sinceAt < IDLE_MS) return
  if (someoneDriving()) { sinceAt = Date.now(); return }
  defend(s)
  sinceAt = Date.now()                 // one attempt per idle window
}, 900)

// Usage: npx tsx scripts/dev/deckbuild.ts <stateFile> [--dry-run] [--read] [--no-lands] [--verify [seconds]]
//
// Builds the advisor's deck in Arena's Limited deckbuilder by clicking the
// deck-list rail. Arena logs nothing between clicks, so the rail is read by
// OCR (scripts/dev/ocr.swift) before every batch: rows are located by their
// recognised text, not by assumed indices, and the sort model in
// shared/deck-layout.ts is only a cross-check. Spells are cut bottom-up so
// rows above the click stay put; lands are set last because touching them
// disables Arena's Suggest Lands. Done is never clicked: pressing it is the
// player's act, and the EventSetDeckV3 it logs is what --verify compares to.
import { readFileSync } from 'fs'
import { execFileSync } from 'child_process'
import { tmpdir } from 'os'
import { join } from 'path'
import { buildDeck } from '../../renderer/overlay/deckbuild'
import type { CardRow } from '../../shared/state'
import { DECK_RAIL, LAND_PICKER, at, railRegion, deckRows, parseRailLine, parseDeckCount, namesMatch, type Rect } from '../../shared/deck-layout'

const [stateFile, ...flags] = process.argv.slice(2)
if (!stateFile) { console.error('usage: deckbuild.ts <stateFile> [--dry-run] [--read] [--no-lands] [--verify [seconds]]'); process.exit(2) }
const DRY = flags.includes('--dry-run')
const READ_ONLY = flags.includes('--read')
const NO_LANDS = flags.includes('--no-lands')
const VERIFY = flags.includes('--verify')
const VERIFY_SECONDS = Number(flags[flags.indexOf('--verify') + 1]) || 600

const BIN = join(process.cwd(), 'build', 'dev')
const BASIC_COLOR: Record<string, 'W' | 'U' | 'B' | 'R' | 'G'> = { Plains: 'W', Island: 'U', Swamp: 'B', Mountain: 'R', Forest: 'G' }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function loadState(): { pool: CardRow[]; rect: Rect; phase: string; submittedDeck?: { main: Array<{ grpId: number; quantity: number }>; mainCount: number } | null } {
  const s = JSON.parse(readFileSync(stateFile, 'utf8'))
  if (!s.arena && !DRY && !VERIFY) throw new Error('state has no Arena rect: is Arena running and the app mirroring state?')
  return { pool: s.pool, rect: s.arena ?? { x: 0, y: 0, width: 1280, height: 748 }, phase: s.phase, submittedDeck: s.submittedDeck }
}

// ---- desktop primitives -----------------------------------------------------
function run(cmd: string, args: string[]): string {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })
}
function activate(): void { run('osascript', ['-e', 'tell application "MTGA" to activate']) }
function click(p: { x: number; y: number }): void { run(join(BIN, 'click'), [String(p.x), String(p.y)]) }
function move(p: { x: number; y: number }): void { run(join(BIN, 'move-mouse'), [String(p.x), String(p.y)]) }
function scroll(p: { x: number; y: number }, lines: number): void { run(join(BIN, 'scroll'), [String(p.x), String(p.y), String(lines)]) }
function park(rect: Rect): void { move(at(rect, 0.55, 0.985)) }

interface RailRow { count: number; name: string; y: number }
interface RailRead { rows: RailRow[]; deckCount: number | null; raw: string[] }

/** Screenshot the rail region and OCR it into rows with screen-point y centres. */
function readRail(rect: Rect): RailRead {
  const region = railRegion(rect, { ...DECK_RAIL, railTop: 0.165 })
  const png = join(tmpdir(), `arena-rail-${process.pid}.png`)
  run('screencapture', ['-x', '-tpng', `-R${region.x},${region.y},${region.width},${region.height}`, png])
  const out = run(join(BIN, 'ocr'), [png])
  const tokens = out.split('\n').filter(Boolean).map(l => JSON.parse(l) as { text: string; x: number; y: number; w: number; h: number })
  // Vision returns "3x" and the name as separate boxes on the same line: merge by y.
  tokens.sort((a, b) => a.y - b.y || a.x - b.x)
  const lines: Array<{ y: number; parts: Array<{ x: number; text: string }> }> = []
  for (const t of tokens) {
    const cy = t.y + t.h / 2
    const line = lines.find(l => Math.abs(l.y - cy) < 0.012)
    if (line) line.parts.push({ x: t.x, text: t.text }); else lines.push({ y: cy, parts: [{ x: t.x, text: t.text }] })
  }
  const raw = lines.map(l => l.parts.sort((a, b) => a.x - b.x).map(p => p.text).join(' '))
  const rows: RailRow[] = []
  let deckCount: number | null = null
  lines.forEach((l, i) => {
    const text = raw[i]
    const dc = parseDeckCount(text)
    if (dc !== null) { deckCount = dc; return }
    const r = parseRailLine(text.replace(/^\(/, ''))
    if (r) rows.push({ ...r, y: Math.round(region.y + l.y * region.height) })
  })
  return { rows, deckCount, raw }
}

// ---- the plan ---------------------------------------------------------------
const { pool, rect, phase } = loadState()
const plan = buildDeck(pool)
const target = new Map<string, number>()
for (const e of plan.spells) target.set(e.name, e.count)
for (const e of plan.nonbasicLands) target.set(e.name, e.count)
const basicsTarget: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 }
for (const b of plan.basics) basicsTarget[b.color] = b.count
const isBasicName = (n: string) => n in BASIC_COLOR
const wanted = (name: string) => isBasicName(name) ? basicsTarget[BASIC_COLOR[name]] : (target.get(name) ?? 0)

console.log(`plan: ${plan.laneLabel} · ${plan.spellCount} spells + ${plan.landCount} lands = ${plan.total} · basics ${plan.basics.map(b => `${b.count}${b.color}`).join(' ')}`)
const modelRows = deckRows(pool.map(c => ({ ...c, rarity: c.rarity })))
console.log(`initial rail model (${modelRows.length} rows, from the pool + Arena's sort): ` + modelRows.map(r => `${r.count}x ${r.name}`).join(' | '))

async function main(): Promise<void> {
  if (VERIFY) return verify()
  if (phase !== 'complete' && !DRY) { console.error(`phase is ${phase}, not complete: nothing to build`); process.exit(3) }
  if (DRY) {
    const cuts = modelRows.filter(r => !isBasicName(r.name) && wanted(r.name) < r.count).map(r => `${r.count - wanted(r.name)}x ${r.name}`)
    console.log(`would cut: ${cuts.join(' | ')}`)
    console.log(`would set basics to: ${JSON.stringify(basicsTarget)}`)
    return
  }
  activate(); await sleep(400); park(rect); await sleep(300)
  if (READ_ONLY) { const r = readRail(rect); console.log(`deck ${r.deckCount}/40`); for (const row of r.rows) console.log(`${row.y} ${row.count}x ${row.name}`); return }

  // 1. Cut spells (and unwanted nonbasics), bottom-up, re-reading after every row.
  const railPoint = at(rect, DECK_RAIL.rowX, (DECK_RAIL.firstRowY + DECK_RAIL.lastRowY) / 2)
  let scrolledDown = false
  for (let iter = 0; iter < 80; iter++) {
    let read = readRail(rect)
    let cut = read.rows.filter(r => !isBasicName(r.name) && (excess(r) > 0)).sort((a, b) => b.y - a.y)
    if (cut.length === 0) {
      if (!scrolledDown) { scroll(railPoint, -40); scrolledDown = true; await sleep(700); park(rect); await sleep(300); continue }
      // scrolled to the bottom and nothing left there either: check the top once more
      scroll(railPoint, 40); await sleep(700); park(rect); await sleep(300)
      read = readRail(rect)
      cut = read.rows.filter(r => !isBasicName(r.name) && (excess(r) > 0)).sort((a, b) => b.y - a.y)
      if (cut.length === 0) break
      scrolledDown = false
    }
    const row = cut[0]
    const n = excess(row)
    console.log(`cut ${n}x ${row.name} (y=${row.y}, deck ${read.deckCount ?? '?'}/40)`)
    for (let i = 0; i < n; i++) { click({ x: railPoint.x, y: row.y }); await sleep(650) }
    park(rect); await sleep(350)
  }

  // 2. Lands: remove excess basics from the rail, add deficits via the land filter.
  if (!NO_LANDS) {
    scroll(railPoint, -40); await sleep(700); park(rect); await sleep(300)
    let read = readRail(rect)
    const have: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 }
    for (const r of read.rows.filter(r => isBasicName(r.name)).sort((a, b) => b.y - a.y)) {
      const col = BASIC_COLOR[r.name]; have[col] = r.count
      const over = r.count - basicsTarget[col]
      if (over > 0) {
        console.log(`remove ${over}x ${r.name}`)
        for (let i = 0; i < over; i++) { click({ x: railPoint.x, y: r.y }); await sleep(650) }
        have[col] = basicsTarget[col]; park(rect); await sleep(350)
      }
    }
    const deficits = (Object.keys(basicsTarget) as Array<'W' | 'U' | 'B' | 'R' | 'G'>).filter(c => basicsTarget[c] > have[c])
    if (deficits.length > 0) {
      click(at(rect, LAND_PICKER.filter.x, LAND_PICKER.filter.y)); await sleep(900)
      for (const c of deficits) {
        const n = basicsTarget[c] - have[c]
        console.log(`add ${n}x ${c} basic`)
        for (let i = 0; i < n; i++) { click(at(rect, LAND_PICKER.tiles[c].x, LAND_PICKER.tiles[c].y)); await sleep(650) }
      }
      click(at(rect, LAND_PICKER.filter.x, LAND_PICKER.filter.y)); await sleep(700)
    }
    park(rect); await sleep(400)
    read = readRail(rect)
    console.log(`deck ${read.deckCount ?? '?'}/40 after lands: ` + read.rows.map(r => `${r.count}x ${r.name}`).join(' | '))
  }

  // 3. Final checkpoint against the plan, from the rail (top + bottom).
  scroll(railPoint, 40); await sleep(700); park(rect); await sleep(300)
  const top = readRail(rect)
  scroll(railPoint, -40); await sleep(700); park(rect); await sleep(300)
  const bottom = readRail(rect)
  const seen = new Map<string, number>()
  for (const r of [...top.rows, ...bottom.rows]) seen.set(r.name, r.count)
  const problems: string[] = []
  for (const [name, n] of target) if ((seen.get(matchKey(seen, name)) ?? 0) !== n) problems.push(`${name}: want ${n}, rail shows ${seen.get(matchKey(seen, name)) ?? 0}`)
  for (const [name, n] of seen) if (!isBasicName(name) && wanted(matchTarget(name)) === 0) problems.push(`${name}: still in deck`)
  console.log(`RESULT deck ${bottom.deckCount ?? top.deckCount ?? '?'}/40 · ${problems.length === 0 ? 'matches the plan' : 'MISMATCH: ' + problems.join('; ')}`)
  console.log('Done is yours to press. Then: arena.sh build --verify')

  function excess(r: RailRow): number { return r.count - wanted(matchTarget(r.name)) }
  function matchTarget(ocrName: string): string {
    for (const name of target.keys()) if (namesMatch(ocrName, name)) return name
    for (const row of modelRows) if (namesMatch(ocrName, row.name)) return row.name
    return ocrName
  }
  function matchKey(m: Map<string, number>, name: string): string {
    for (const k of m.keys()) if (namesMatch(k, name)) return k
    return name
  }
}

/** Wait for Arena's own EventSetDeckV3 (mirrored as state.submittedDeck) and diff it against the plan. */
async function verify(): Promise<void> {
  const byGrp = new Map<number, string>(); for (const c of pool) byGrp.set(c.grpId, c.name)
  const deadline = Date.now() + VERIFY_SECONDS * 1000
  let sub = loadState().submittedDeck
  while (!sub && Date.now() < deadline) { await sleep(2000); sub = loadState().submittedDeck }
  if (!sub) { console.log(`no deck submission seen in ${VERIFY_SECONDS}s (press Done in Arena)`); process.exit(4) }
  const got = new Map<string, number>()
  for (const e of sub.main) { const n = byGrp.get(e.grpId) ?? `#${e.grpId}`; got.set(n, (got.get(n) ?? 0) + e.quantity) }
  const want = new Map<string, number>(target)
  for (const b of plan.basics) if (b.count > 0) want.set({ W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' }[b.color], b.count)
  const diffs: string[] = []
  for (const [n, q] of want) if ((got.get(n) ?? 0) !== q) diffs.push(`${n}: want ${q}, submitted ${got.get(n) ?? 0}`)
  for (const [n, q] of got) if (!want.has(n)) diffs.push(`${n}: submitted ${q}, not in plan`)
  console.log(`submitted ${sub.mainCount} cards · ${diffs.length === 0 ? 'EXACTLY the plan' : 'differs: ' + diffs.join('; ')}`)
  process.exit(diffs.length === 0 ? 0 : 1)
}

main().catch(e => { console.error(e); process.exit(1) })

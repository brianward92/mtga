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
import { buildDeck } from '../../shared/deck-plan'
import type { CardRow } from '../../shared/state'
import { BASIC_LAND_COLOR as BASIC_COLOR, isBasicLandName } from '../../shared/cards'
import { activate, click, move, scroll, park, keystroke, selectAll, overlayApp, hideOverlayAndConfirm, readTextLines, sleep } from './lib/desktop'
import { builderCalibrationFor, assertSafeRailClick, at, railRegion, deckRows, parseRailLine, parseDeckCount, namesMatch, type Rect } from '../../shared/deck-layout'

const [stateFile, ...flags] = process.argv.slice(2)
if (!stateFile) { console.error('usage: deckbuild.ts <stateFile> [--dry-run] [--read] [--no-lands] [--verify [seconds]]'); process.exit(2) }
const DRY = flags.includes('--dry-run')
const READ_ONLY = flags.includes('--read')
const NO_LANDS = flags.includes('--no-lands')
const VERIFY = flags.includes('--verify')
const VERIFY_SECONDS = Number(flags[flags.indexOf('--verify') + 1]) || 600


function loadState(): { pool: CardRow[]; rect: Rect; phase: string; submittedDeck?: { main: Array<{ grpId: number; quantity: number }>; mainCount: number } | null } {
  const s = JSON.parse(readFileSync(stateFile, 'utf8'))
  if (!s.arena && !DRY && !VERIFY) throw new Error('state has no Arena rect: is Arena running and the app mirroring state?')
  return { pool: s.pool, rect: s.arena ?? { x: 0, y: 0, width: 1280, height: 748 }, phase: s.phase, submittedDeck: s.submittedDeck }
}

// ---- desktop primitives (shared/dev lib: scripts/dev/lib/desktop.ts) --------
/** Put one card name in the pool's search box, leaving it alone in cell one. */
function searchPool(rect: Rect, name: string): void {
  click(at(rect, POOL.search.x, POOL.search.y))
  selectAll()
  keystroke(name)
}
function clearSearch(rect: Rect): void {
  click(at(rect, POOL.clearSearch.x, POOL.clearSearch.y))
}

interface RailRow { count: number; name: string; y: number }
interface RailRead { rows: RailRow[]; deckCount: number | null; raw: string[] }

/** Screenshot the rail region and OCR it into rows with screen-point y centres. */
function readRail(rect: Rect): RailRead {
  const region = railRegion(rect, DECK_RAIL)
  const lines = readTextLines(region)
  const raw = lines.map(l => l.text)
  const rows: RailRow[] = []
  let deckCount: number | null = null
  for (const l of lines) {
    const dc = parseDeckCount(l.text)
    if (dc !== null) { deckCount = dc; continue }
    const r = parseRailLine(l.text.replace(/^\(/, ''))
    if (r) rows.push({ ...r, y: l.y })
  }
  return { rows, deckCount, raw }
}

/** Scroll the rail top and bottom and merge both reads into name -> count. */
async function readWholeRail(rect: Rect, railPoint: { x: number; y: number }): Promise<{ counts: Map<string, number>; deckCount: number | null }> {
  const sleepMs = sleep
  scroll(railPoint, 40); await sleepMs(700); park(rect); await sleepMs(300)
  const top = readRail(rect)
  scroll(railPoint, -40); await sleepMs(700); park(rect); await sleepMs(300)
  const bottom = readRail(rect)
  const counts = new Map<string, number>()
  for (const r of [...top.rows, ...bottom.rows]) counts.set(r.name, r.count)
  return { counts, deckCount: bottom.deckCount ?? top.deckCount }
}

// ---- the plan ---------------------------------------------------------------
const { pool, rect, phase } = loadState()
// Geometry for THIS window shape. An unmeasured shape is announced rather than
// silently used: clicks that land on nothing still read as successful, which is
// how a land phase once "added" two Plains that never arrived.
const { calibration: BUILDER, bucket: BUCKET, measured: MEASURED } = builderCalibrationFor(rect)
const { rail: DECK_RAIL, landPicker: LAND_PICKER, pool: POOL } = BUILDER
if (!MEASURED) {
  // Not a warning any more: the clearance below Done is a property of the
  // measured fractions, and on an unmeasured shape it is unknown.
  console.log(`REFUSING: no builder geometry measured for a ${rect.width}x${rect.height} window (nearest bucket ${BUCKET}).`)
  console.log('Measure this window before building: arena.sh build --read, then compare against arena.sh shot.')
  process.exit(4)
}
const plan = buildDeck(pool)
const target = new Map<string, number>()
for (const e of plan.spells) target.set(e.name, e.count)
for (const e of plan.nonbasicLands) target.set(e.name, e.count)
const basicsTarget: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 }
for (const b of plan.basics) basicsTarget[b.color] = b.count
const isBasicName = isBasicLandName
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
  const unmatched = new Set<string>()
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
    assertSafeRailClick(rect, row.y, DECK_RAIL, MEASURED)
    for (let i = 0; i < n; i++) { click({ x: railPoint.x, y: row.y }); await sleep(650) }
    park(rect); await sleep(350)
  }

  // 2. Lands: remove excess basics from the rail, add deficits via the land filter.
  //    The overlay's deckbuild sidebar is mirrored to the left, over the filter
  //    bar and the first pool columns, and it swallows the clicks: the land
  //    tiles read as pressed but nothing was added. Take it down for the rest
  //    of the run and put it back at the end.
  let overlayDown = false
  const hideOverlay = async () => {
    if (overlayDown) return
    await hideOverlayAndConfirm()
    overlayDown = true
    activate(); await sleep(600)
  }
  if (!NO_LANDS) {
    await hideOverlay()
    scroll(railPoint, -40); await sleep(700); park(rect); await sleep(300)
    let read = readRail(rect)
    const have: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 }
    for (const r of read.rows.filter(r => isBasicName(r.name)).sort((a, b) => b.y - a.y)) {
      const col = BASIC_COLOR[r.name]; have[col] = r.count
      const over = r.count - basicsTarget[col]
      if (over > 0) {
        console.log(`remove ${over}x ${r.name}`)
        assertSafeRailClick(rect, r.y, DECK_RAIL, MEASURED)
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

  // 3. Add back anything the deck is short of. A pack can be over-cut (and was:
  //    a mis-read row once cost three copies of a wanted card), and Arena also
  //    drops the deck back to the raw pool after a reconnect.
  let seen = (await readWholeRail(rect, railPoint)).counts
  const deficits: Array<[string, number]> = []
  for (const [name, want] of target) {
    const have = seen.get(matchKey(seen, name)) ?? 0
    if (have < want) deficits.push([name, want - have])
  }
  if (deficits.length > 0) {
    console.log(`adding back: ${deficits.map(([n, c]) => `${c}x ${n}`).join(' | ')}`)
    await hideOverlay()
    for (const [name, count] of deficits) {
      searchPool(rect, name); await sleep(1400)
      for (let i = 0; i < count; i++) { click(at(rect, POOL.firstCell.x, POOL.firstCell.y)); await sleep(700) }
      park(rect); await sleep(400)
    }
    clearSearch(rect); await sleep(800); park(rect); await sleep(400)
  }

  // 4. Final checkpoint against the plan, from the rail (top + bottom).
  const final = await readWholeRail(rect, railPoint)
  seen = final.counts
  const top = { deckCount: final.deckCount }
  const bottom = { deckCount: final.deckCount }
  const problems: string[] = []
  for (const [name, n] of target) if ((seen.get(matchKey(seen, name)) ?? 0) !== n) problems.push(`${name}: want ${n}, rail shows ${seen.get(matchKey(seen, name)) ?? 0}`)
  for (const [name] of seen) {
    if (isBasicName(name)) continue
    // A row we cannot identify is reported, never acted on: `unmatched` below
    // already carries it, and treating unknown text as "not in the plan" is
    // what once cut three copies of a wanted card.
    const known = matchTarget(name)
    if (known !== null && wanted(known) === 0) problems.push(`${name}: still in deck`)
  }
  // Basics are not in `target` (they come from the land picker, not the pool),
  // so check them separately or a deck short on lands reports as clean.
  if (!NO_LANDS) {
    for (const [name, col] of Object.entries(BASIC_COLOR)) {
      const want = basicsTarget[col]
      const have = seen.get(name) ?? 0
      if (have !== want) problems.push(`${name}: want ${want}, rail shows ${have}`)
    }
  }
  if (unmatched.size > 0) {
    console.log(`NOTE ${unmatched.size} rail row(s) were left alone because the OCR text matched no known card: ${[...unmatched].join(' | ')}`)
  }
  console.log(`RESULT deck ${bottom.deckCount ?? top.deckCount ?? '?'}/40 · ${problems.length === 0 ? 'matches the plan' : 'MISMATCH: ' + problems.join('; ')}`)
  // Put the overlay back if any phase took it down.
  if (overlayDown) overlayApp('launch')
  console.log('Done is yours to press. Then: arena.sh build --verify')

  /**
   * How many copies of this row to cut. Zero for anything we cannot identify.
   *
   * This used to fall back to the raw OCR text, which resolved to "not in the
   * plan" and therefore "cut every copy". One mis-read row — OCR had merged the
   * next row's count onto the name, giving "Volatile Wanderglyph 1" — silently
   * cut all three copies of a card the plan wanted. Never remove a card on the
   * strength of text we failed to match.
   */
  function excess(r: RailRow): number {
    const name = matchTarget(r.name)
    if (name === null) { unmatched.add(r.name); return 0 }
    return r.count - wanted(name)
  }
  function matchTarget(ocrName: string): string | null {
    for (const name of target.keys()) if (namesMatch(ocrName, name)) return name
    for (const row of modelRows) if (namesMatch(ocrName, row.name)) return row.name
    return null
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

// Usage: npx tsx pick.ts <stateFile> <arenaRectJson> [grpId|top|list|confirm]
// Prints screen-point coordinates for a card's cell centre (and the pack table).
import { readFileSync } from 'fs'
import { arenaContentBox, calibrationFor, packLayout } from '../../shared/layout'
import { arenaDisplayOrder } from '../../shared/display-order'
import { loadPrefs } from '../../main/prefs'
import type { CardRow } from '../../shared/state'

const [stateFile, rectJson, what = 'top'] = process.argv.slice(2)
const state = JSON.parse(readFileSync(stateFile, 'utf8'))
// The app mirrors the Arena rect it is actually using; trust that over the
// caller's guess (AX reports nonsense while Arena is full screen).
const rect = state.arena ?? JSON.parse(rectJson)
const cards = state.cards as CardRow[]
// Same calibration the overlay draws badges with. Using the defaults here
// instead would click where the badge is not, for anyone who has calibrated.
const layout = packLayout({ width: rect.width, height: rect.height }, cards.length, calibrationFor(loadPrefs().calibrations, rect))
const order = arenaDisplayOrder(cards)
const cellOf = new Map<number, number>()
order.forEach((cardIdx, cell) => cellOf.set(cards[cardIdx].grpId, cell))

if (what === 'confirm') {
  // Arena's "Confirm Pick" button, measured in the centred content box:
  // x 65.3% of the box, y 94% of the window height (safely above the Dock).
  const box = arenaContentBox({ width: rect.width, height: rect.height })
  console.log(`${Math.round(rect.x + box.x + box.width * 0.6528)} ${Math.round(rect.y + rect.height * 0.94)} confirm`)
} else if (what === 'list') {
  for (const c of [...cards].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))) {
    const mark = c.unresolved ? ' UNRESOLVED' : ''
    console.log(`${String(c.rank ?? '-').padStart(2)} ${(c.grade ?? '-').padEnd(2)} ev=${c.ev === null ? '  -  ' : c.ev.toFixed(2).padStart(5)} p=${c.prob === null ? '-' : (c.prob * 100).toFixed(0).padStart(2) + '%'} ${c.name} [${c.colors}] ${c.rarity}${mark}`)
  }
  console.log(`P${state.pack}P${state.pick} scoring=${state.scoring} model=${state.model.state} pool=${state.pool.length}`)
} else {
  // Cells are matched to cards by position, so one card we cannot identify
  // moves every card after it by a cell and the click lands on a neighbour.
  // Refuse rather than pick something the model never recommended.
  const unknown = cards.filter(c => c.unresolved)
  if (unknown.length > 0) {
    console.error(`REFUSING: ${unknown.length} card(s) in this pack are unidentified (${unknown.map(c => c.grpId).join(', ')}); the grid order cannot be trusted. Regenerate resources/draftfm/arena-cards.json with scripts/build_arena_mapping.py --emit-app-cards`)
    process.exit(5)
  }
  const target = what === 'top' ? cards.find(c => c.rank === 1) : cards.find(c => c.grpId === Number(what))
  if (!target) { console.log('NONE'); process.exit(1) }
  const cell = cellOf.get(target.grpId)!
  const r = layout.cards[cell].card
  console.log(`${Math.round(rect.x + r.x + r.width / 2)} ${Math.round(rect.y + r.y + r.height / 2)} ${target.grpId} ${target.name}`)
}

// Usage: npx tsx pick.ts <stateFile> <arenaRectJson> [grpId|top|list|confirm|verify GRPID]
// Prints screen-point coordinates for a card's cell centre (and the pack table).
import { readFileSync } from 'fs'
import { arenaContentBox, calibrationFor, packLayout } from '../../shared/layout'
import { arenaDisplayOrder } from '../../shared/display-order'
import { loadPrefs } from '../../main/prefs'
import type { CardRow } from '../../shared/state'
import { namesMatch } from '../../shared/cards'
import { readTextLines } from './lib/desktop'

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
} else if (what === 'verify') {
  // Read the card Arena is actually drawing in the target cell, and compare it
  // to the card we mean to take.
  //
  // Cells are matched to cards positionally, so every ordering bug in this
  // codebase has the same symptom: the click lands on the neighbour and the
  // draft records a card the model never recommended. That happened for real
  // on P1P10. Checking the screen costs one capture and catches the whole
  // class, including causes we have not found yet.
  const target = cards.find(c => c.grpId === Number(process.argv[5]))
  if (!target) { console.error('verify: no such card in this pack'); process.exit(2) }
  const cell = cellOf.get(target.grpId)!
  const r = layout.cards[cell].card
  // Arena prints the title in a band across the top of the card frame.
  //
  // Inset from the card's edges. An ordering error moves a card by exactly ONE
  // cell, into a band that touches this one, so a full-width read would happily
  // accept the neighbour's title bleeding in. The inset keeps the read inside
  // this card, and the band is cropped BEFORE recognition, so nothing outside
  // this cell can appear in the result at all.
  //
  // That is what makes "any line in the band" safe, and it has to be any line:
  // the cell also contains stray short tokens — a "1" sat on the title row of
  // pick 14 of a live draft — and choosing the line nearest the centre picked
  // the "1", compared it to Burning Sun Cavalry, and refused a card that was
  // plainly there.
  // Asymmetric on purpose. A 12% inset on the left clipped the first glyph of
  // four different titles in one draft ("hupacabra", "Valk", "kawalli",
  // "nafical Offering"), and each became a matcher patch. The title starts
  // near the card's left edge; the right edge is where the pip sits, and that
  // is the side worth staying away from.
  const insetL = r.width * 0.05
  const insetR = r.width * 0.12
  const band = {
    x: Math.round(rect.x + r.x + insetL),
    y: Math.round(rect.y + r.y + r.height * 0.04),
    width: Math.round(r.width - insetL - insetR),
    height: Math.round(r.height * 0.14)
  }
  const lines = readTextLines(band).filter(l => l.text.trim())
  const seen = lines.map(l => l.text)
  const centre = rect.y + r.y + r.height * 0.04 + r.height * 0.07
  const nearest = lines.length > 0
    ? lines.reduce((best, l) => Math.abs(l.y - centre) < Math.abs(best.y - centre) ? l : best)
    : null
  const matched = lines.find(l => namesMatch(l.text, target.name)) ?? null
  const ok = matched !== null
  const shown = matched ?? nearest
  console.log(`${ok ? 'MATCH' : 'MISMATCH'} expected="${target.name}" read="${shown?.text ?? '(nothing)'}" all="${seen.join(' / ') || '(nothing)'}"`)
  process.exit(ok ? 0 : 6)
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

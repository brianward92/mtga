// Usage: npx tsx pick.ts <stateFile> <arenaRectJson> [grpId|top|list]
// Prints screen-point coordinates for a card's cell centre (and the pack table).
import { readFileSync } from 'fs'
import { packLayout, DEFAULT_CALIBRATION } from '../../shared/layout'
import { arenaDisplayOrder } from '../../shared/display-order'
const [stateFile, rectJson, what = 'top'] = process.argv.slice(2)
const state = JSON.parse(readFileSync(stateFile, 'utf8'))
const rect = JSON.parse(rectJson)
const cards = state.cards as Array<{ grpId: number; name: string; rarity: string; colors: string; type: string; ev: number | null; rank: number | null; grade: string | null; prob: number | null }>
const layout = packLayout({ width: rect.width, height: rect.height }, cards.length, DEFAULT_CALIBRATION)
const order = arenaDisplayOrder(cards)
const cellOf = new Map<number, number>()
order.forEach((cardIdx, cell) => cellOf.set(cards[cardIdx].grpId, cell))
if (what === 'list') {
  for (const c of [...cards].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))) {
    console.log(`${String(c.rank ?? '-').padStart(2)} ${(c.grade ?? '-').padEnd(2)} ev=${c.ev === null ? '  -  ' : c.ev.toFixed(2).padStart(5)} p=${c.prob === null ? '-' : (c.prob * 100).toFixed(0).padStart(2) + '%'} ${c.name} [${c.colors}] ${c.rarity}`)
  }
  console.log(`P${state.pack}P${state.pick} scoring=${state.scoring} model=${state.model.state} pool=${state.pool.length}`)
} else {
  const target = what === 'top' ? cards.find(c => c.rank === 1) : cards.find(c => c.grpId === Number(what))
  if (!target) { console.log('NONE'); process.exit(1) }
  const cell = cellOf.get(target.grpId)!
  const r = layout.cards[cell].card
  console.log(`${Math.round(rect.x + r.x + r.width / 2)} ${Math.round(rect.y + r.y + r.height / 2)} ${target.grpId} ${target.name}`)
}

// Usage: npx tsx scripts/dev/state.ts <stateFile> <pos|rect|json|cards|pool|forced|basic GRPID>
//
// Queries over the overlay's mirrored DraftState, for shell callers.
//
// This replaces statecheck.py, which existed only because bash cannot read
// JSON. Two implementations of "is this a basic land?" drifted apart: the
// Python one tested `type.startswith("Basic Land")` while the app used a
// word-boundary regex, so the picker and the overlay could disagree about the
// same card. There is one answer now, in shared/cards.ts.
import { readFileSync } from 'fs'
import { isBasicLand } from '../../shared/cards'
import type { CardRow } from '../../shared/state'

const [stateFile, what = 'pos', arg] = process.argv.slice(2)
if (!stateFile) { console.error('usage: state.ts <stateFile> <pos|rect|json|cards|pool|forced|basic GRPID>'); process.exit(2) }
const s = JSON.parse(readFileSync(stateFile, 'utf8'))
const cards: CardRow[] = s.cards ?? []

function rows(list: CardRow[], byRank: boolean): void {
  const sorted = [...list].sort(byRank ? (a, b) => (a.rank ?? 99) - (b.rank ?? 99) : (a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
  for (const c of sorted) {
    const p = typeof c.prob === 'number' ? `${(c.prob * 100).toFixed(0).padStart(3)}%` : '  - '
    console.log(`${String(c.rank ?? '-').padStart(2)} ${(c.grade ?? '-').padEnd(2)} ${p} ${c.name} [${c.colors ?? ''}]${c.unresolved ? ' UNRESOLVED' : ''}`)
  }
}

switch (what) {
  case 'pos':
    console.log(`P${s.pack}P${s.pick} phase=${s.phase} set=${s.set} fmt=${s.format} cards=${cards.length} pool=${(s.pool ?? []).length} model=${s.model?.state}`)
    break
  // The compact form the picker compares before and after a click, to be sure
  // the pack has not advanced underneath it.
  case 'packpick': console.log(`${s.pack}-${s.pick}`); break
  case 'rect': {
    const a = s.arena
    if (!a) process.exit(1)
    console.log(`${a.x},${a.y},${a.width},${a.height}`)
    break
  }
  case 'json': console.log(JSON.stringify(s)); break
  case 'cards': rows(cards, true); break
  case 'pool': rows(s.pool ?? [], false); break
  case 'basic': {
    const c = cards.find(c => c.grpId === Number(arg))
    process.exit(c && isBasicLand(c) ? 0 : 1)
  }
  // Exit 0 when there is nothing to protect the drafter from: one card left, or
  // a pack of nothing but basics. The last pick of an Arena pack is always
  // forced, so refusing it there does not save anyone, it stalls the draft.
  case 'forced':
    process.exit(cards.length <= 1 || (cards.length > 0 && cards.every(isBasicLand)) ? 0 : 1)
  default:
    console.error(`unknown query: ${what}`); process.exit(2)
}

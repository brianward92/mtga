// Usage: npx tsx scripts/dev/verify-ids.ts <arena-cards.tsv> [--list] [SET ...]
//
// Diffs every bundled set's grpId -> card name against Arena's own card
// database (dumped from Raw_CardDatabase_*.mtga). Our bundles are built from
// Scryfall's `arena_id`, a third-party mapping onto Arena's ids, so this is
// the only way to know whether it is right.
//
// A mislabel is not cosmetic: the pack grid is ordered by card identity, so a
// wrong name (or an unresolvable id) reorders the badge grid and can make the
// picker click a different card than the one it recommended.
//
// Two classes of noise are excluded deliberately:
//   * Arena wraps hyphenated names in <nobr> markup ("<nobr>Cat-Gator</nobr>").
//   * Back faces of DFCs/Adventures ("Squeak By") carry their own grpId and
//     never appear in a pack list; only primary, draftable cards matter.
import { readFileSync } from 'fs'
import { findBundleRoot, readBundleIndex, loadSetBundle } from '../../main/data/bundle'

const args = process.argv.slice(2)
const LIST = args.includes('--list')
const [tsv, ...only] = args.filter(a => a !== '--list')
if (!tsv) { console.error('usage: verify-ids.ts <arena-cards.tsv> [--list] [SET ...]'); process.exit(2) }

const BASICS = new Set(['plains', 'island', 'swamp', 'mountain', 'forest', 'wastes'])
interface Arena { name: string; set: string; token: boolean; primary: boolean; face: number; draftable: boolean; rebalanced: boolean }

/** Arena's localized titles carry presentation markup; the name is the text. */
function clean(s: string): string {
  return s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
}
function key(s: string): string {
  return clean(s).toLowerCase().replace(/[^a-z0-9/]/g, '')
}

const arena = new Map<number, Arena>()
for (const line of readFileSync(tsv, 'utf8').split('\n')) {
  if (!line) continue
  const [id, name, set, , isToken, isPrimary, face, draft, rebal] = line.split('\t')
  const g = Number(id)
  if (Number.isFinite(g)) arena.set(g, { name: clean(name), set, token: isToken === '1', primary: isPrimary === '1', face: Number(face), draftable: draft === '1', rebalanced: rebal === '1' })
}

/** Our names carry both faces ("A // B"); Arena names one face at a time. */
function same(ours: string, theirs: string): boolean {
  const a = key(ours), b = key(theirs)
  if (a === b) return true
  return a.split('//').includes(b) || b.split('//').includes(a)
}

const root = findBundleRoot()
if (!root) { console.error('no bundle root'); process.exit(1) }
const index = readBundleIndex(root)
if (!index) { console.error('no bundle index'); process.exit(1) }
const sets = (only.length > 0 ? only : Object.keys(index.sets)).sort()

let checked = 0, basicWrong = 0, otherWrong = 0, missingDraftable = 0, missingOther = 0
const basicIds = new Map<number, string>()   // grpId -> "we say X, Arena says Y"
const otherRows: string[] = []
const missingRows: string[] = []

for (const set of sets) {
  const bundle = loadSetBundle(root, set)
  if (!bundle) { console.log(`${set}: no bundle`); continue }

  let setBasic = 0, setOther = 0
  for (const [grpId, card] of bundle.cards) {
    const a = arena.get(grpId)
    if (!a) continue
    checked++
    if (same(card.name, a.name)) continue
    const isBasic = BASICS.has(key(card.name)) || BASICS.has(key(a.name))
    if (isBasic) { setBasic++; basicIds.set(grpId, `${grpId}: we say "${card.name}", Arena says "${a.name}"`) }
    else { setOther++; otherRows.push(`${set} ${grpId}: we say "${card.name}", Arena says "${a.name}"`) }
  }

  // Cards Arena files in this set that our bundle cannot resolve at all.
  let setMissingDraft = 0, setMissingOther = 0
  for (const [grpId, a] of arena) {
    if (a.set !== set || a.token || bundle.cards.has(grpId)) continue
    // Alchemy rebalances share the set code but only appear in Alchemy events,
    // never in a Limited pack, so they are not a gap for drafting.
    if (a.primary && a.draftable && a.face === 0 && !a.rebalanced) { setMissingDraft++; missingRows.push(`${set} ${grpId} ${a.name}`) }
    else setMissingOther++
  }

  basicWrong += setBasic; otherWrong += setOther
  missingDraftable += setMissingDraft; missingOther += setMissingOther
  const flag = setOther > 0 || setMissingDraft > 0 ? '  <== REAL' : ''
  console.log(`${set}: ${bundle.cards.size} ids · basics wrong ${setBasic} · other wrong ${setOther} · missing draftable ${setMissingDraft} · missing back-face/non-draft ${setMissingOther}${flag}`)
}

console.log('')
console.log(`${checked} ids checked against Arena's database`)
console.log(`  basic lands mislabelled : ${basicWrong} (${basicIds.size} distinct ids, shared across sets)`)
console.log(`  other cards mislabelled : ${otherWrong}`)
console.log(`  draftable cards our bundle cannot resolve : ${missingDraftable}`)
console.log(`  back faces / non-draft ids not in bundle  : ${missingOther} (expected: they never appear in a pack)`)
if (LIST) {
  console.log('\ndistinct mislabelled basic-land ids:')
  for (const row of [...basicIds.values()].sort()) console.log('  ' + row)
  if (otherRows.length) { console.log('\nnon-basic mislabels:'); for (const r of otherRows.slice(0, 40)) console.log('  ' + r) }
  if (missingRows.length) { console.log('\nmissing draftable:'); for (const r of missingRows.slice(0, 40)) console.log('  ' + r) }
}

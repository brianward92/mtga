// Usage: npx tsx scripts/dev/whatcard.ts <SET> [grpId ...]
// Print what the bundled set assets believe a grpId is. With no ids, lists
// every basic land in the set — the group most likely to be mis-mapped, since
// basics carry many printings per name.
import { findBundleRoot, loadSetBundle, readAssetsIdentity } from '../../main/data/bundle'
import { join } from 'path'

const [set, ...ids] = process.argv.slice(2)
if (!set) { console.error('usage: whatcard.ts <SET> [grpId ...]'); process.exit(2) }
const root = findBundleRoot()
if (!root) { console.error('no bundle root'); process.exit(1) }
const bundle = loadSetBundle(root, set)
if (!bundle) { console.error(`no bundle for ${set}`); process.exit(1) }

if (ids.length > 0) {
  for (const raw of ids) {
    const g = Number(raw)
    const c = bundle.cards.get(g)
    console.log(c ? `${g}: ${c.name} · ${c.type} · ${c.rarity} · colors="${c.colors}" identity="${c.colorIdentity}" · scryfall=${c.scryfallId}` : `${g}: NOT IN BUNDLE`)
  }
} else {
  const identity = readAssetsIdentity(join(bundle.dir, 'assets.npz'))
  for (const [name, grpIds] of Object.entries(identity.grpIds)) {
    if (!/^(Plains|Island|Swamp|Mountain|Forest)$/.test(name)) continue
    console.log(`${name}: ${grpIds.join(', ')}`)
  }
}

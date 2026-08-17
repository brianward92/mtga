import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { ModelManager } from '../main/model/manager'
import { parseNpz } from '../main/model/npz'
import { buildDeck } from '../renderer/overlay/deckbuild'
import { BASIC_LAND_NAMES } from '../renderer/overlay/deckbuild'
import type { CardRow } from '../shared/state'

const ROOT = join(__dirname, '..', 'resources', 'draftfm')

/**
 * A real drafted pool: HOB Premier, 2026-08-16, read from Arena's completion
 * CardPool. Pins the deckbuild advice end to end against a pool a human
 * actually drafted, which is the only way to catch advice that is well-typed
 * and still wrong.
 */
const POOL = [
  103531, 103454, 103521, 103522, 103453, 103520, 103513, 103497, 103479, 103513,
  103479, 103567, 103410, 103421, 103453, 103523, 103515, 103507, 103500, 103456,
  103508, 103515, 103508, 103370, 103553, 103369, 103507, 103387, 103539, 103508,
  103441, 103457, 103448, 103565, 103513, 103515, 103441, 103522, 103377, 103369,
  103421, 103580
]

interface BundleCard {
  rarity: string; colors: string; colorIdentity: string
  manaCost: string; manaValue: number; type: string; scryfallId: string
}

describe('deckbuild on a real HOB pool', () => {
  it('proposes the Golgari 40 and cuts the off-colour cards', async () => {
    const cache = mkdtempSync(join(tmpdir(), 'hobdeck-'))
    try {
      const mgr = new ModelManager(cache, ROOT)
      const uniq = [...new Set(POOL)]
      const res = await mgr.score('HOB', 'PremierDraft', uniq, POOL, 2, 13)
      expect(res).not.toBeNull()
      const scored = new Map(res!.cards.map(c => [c.grpId, c]))

      const bundle = JSON.parse(
        readFileSync(join(ROOT, 'sets', 'HOB', 'cards.json'), 'utf8')
      ) as { cards: Record<string, BundleCard> }
      // grpId -> name comes from the bundle's own alias table.
      const npz = parseNpz(readFileSync(join(ROOT, 'sets', 'HOB', 'assets.npz')))
      const aliases = JSON.parse(
        (npz.grp_ids.data as unknown as string[])[0] ?? String(npz.grp_ids.data)
      ) as Record<string, number[]>
      const grpToName = new Map<number, string>()
      for (const [name, ids] of Object.entries(aliases)) for (const g of ids) grpToName.set(g, name)

      const pool: CardRow[] = POOL.flatMap(grpId => {
        const name = grpToName.get(grpId)
        if (!name) return []
        const meta = bundle.cards[name]
        const s = scored.get(grpId)
        return [{
          grpId, name, rarity: meta.rarity, colors: meta.colors,
          colorIdentity: meta.colorIdentity, manaCost: meta.manaCost,
          manaValue: meta.manaValue, type: meta.type, scryfallId: meta.scryfallId,
          imageUrl: null, ev: s?.ev ?? null, prob: null, rank: null,
          percentile: s?.percentile ?? null, grade: s?.grade ?? null,
          setPercentile: s?.setPercentile ?? null, setGrade: s?.setGrade ?? null
        }]
      })

      const plan = buildDeck(pool)
      console.log('lane', plan.laneLabel, 'cut', JSON.stringify(plan.cut))
      console.log('spells', plan.spells.map(s => `${s.count}x ${s.name} (${s.grade})`).join('\n  '))
      console.log('lands', plan.basics.map(b => `${b.count} ${BASIC_LAND_NAMES[b.color]}`).join(' · '),
        '+', plan.nonbasicLands.map(l => l.name).join(' · '))
      console.log('close', plan.close.map(c => c.name).join(' · '))

      expect(plan.laneLabel).toBe('G/B')
      expect(plan.total).toBe(40)
      // Blue, white and red were all drafted but none is a lane.
      expect(plan.cut.map(c => c.color).sort()).toEqual(['R', 'U', 'W'])
      const names = plan.spells.map(s => s.name)
      expect(names).toContain("Chief Warg's Company")
      expect(names).not.toContain('Mirkwood Meditator')
      expect(names).not.toContain('Gundabad Opportunist')
      // Goblin-town is a BR land: colourless to cast, but it serves red.
      expect(plan.nonbasicLands.map(l => l.name)).toEqual(['Elven Passage'])
    } finally {
      rmSync(cache, { recursive: true, force: true })
    }
  }, 120_000)
})

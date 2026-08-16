import { describe, expect, it } from 'vitest'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { loadSetBundle, readAssetsIdentity, readBundleIndex } from '../main/data/bundle'
import { ModelManager } from '../main/model/manager'

const ROOT = join(__dirname, '..', 'resources', 'draftfm')
const DSK_ASSETS = join(ROOT, 'sets', 'DSK', 'assets.npz')
const have = existsSync(DSK_ASSETS)

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value))
}

describe('set bundle', () => {
  it.skipIf(!have)('reads name order and grpId aliases from assets.npz', () => {
    const identity = readAssetsIdentity(DSK_ASSETS)
    expect(identity.names).toContain('Murder')
    expect(identity.grpIds.Murder).toEqual(expect.arrayContaining([92188, 67900]))
    // The raw Scryfall snapshot publishes the Arena front-face id; legacy
    // card-store-only aliases are intentionally absent.
    expect(identity.grpIds['Funeral Room // Awakening Hall']).toEqual([92176])
  })

  it.skipIf(!have)('fans name-keyed Scryfall identity across grpIds without ratings or art', () => {
    const root = mkdtempSync(join(tmpdir(), 'draftfm-bundle-'))
    const modelDir = join(root, 'model', 'v-test')
    const setDir = join(root, 'sets', 'DSK')
    mkdirSync(modelDir, { recursive: true })
    mkdirSync(setDir, { recursive: true })
    writeFileSync(join(modelDir, 'scorer.onnx'), '')
    writeJson(join(modelDir, 'meta.json'), { model_id: '_foundation/from-meta', manifest_hash: 'meta-hash' })
    copyFileSync(DSK_ASSETS, join(setDir, 'assets.npz'))
    writeJson(join(setDir, 'cards.json'), {
      set: 'DSK',
      scryfall_updated_at: '2026-08-15T12:34:56Z',
      built_at: '2026-08-15T13:00:00Z',
      cards: {
        Murder: { rarity: 'common', colors: 'B', colorIdentity: 'B', manaCost: '{1}{B}{B}', manaValue: 3, type: 'Instant' },
        'Funeral Room // Awakening Hall': { rarity: 'mythic', colors: 'B', colorIdentity: 'WB', manaCost: '{2}{B}', manaValue: 3, type: 'Enchantment — Room' }
      }
    })
    // A stale file must have no effect on the Scryfall-only bundle contract.
    writeJson(join(setDir, 'ratings.json'), { attribution: 'stale', formats: { QuickDraft: { Murder: { gih_wr: 1 } } } })
    writeJson(join(root, 'sets', 'index.json'), {
      model_id: '_foundation/v-test',
      model_manifest_hash: 'manifest-hash',
      scryfall_updated_at: '2026-08-15T12:34:56Z',
      built_at: '2026-08-15T13:00:00Z',
      sets: { DSK: { picks_per_pack: 15, manifest_hash: 'set-hash', cards: 333, grp_ids: 1566, text_missing: 0 } }
    })

    const idx = readBundleIndex(root)!
    expect(idx).toMatchObject({
      modelTag: 'v-test',
      modelId: '_foundation/v-test',
      modelManifestHash: 'manifest-hash',
      scryfallUpdatedAt: '2026-08-15T12:34:56Z',
      builtAt: '2026-08-15T13:00:00Z'
    })
    expect(idx.sets.DSK).toMatchObject({ picks_per_pack: 15, cards: 333, grp_ids: 1566 })

    const bundle = loadSetBundle(root, 'DSK')!
    expect(bundle.picksPerPack).toBe(15)
    expect(bundle.manifestHash).toBe('set-hash')
    expect(bundle.scryfallUpdatedAt).toBe('2026-08-15T12:34:56Z')
    expect(bundle.names).toContain('Murder')
    expect(bundle.cards.get(92188)).toEqual({
      grpId: 92188,
      name: 'Murder',
      rarity: 'common',
      colors: 'B',
      colorIdentity: 'B',
      manaCost: '{1}{B}{B}',
      manaValue: 3,
      type: 'Instant'
    })
    expect(bundle.cards.get(67900)?.name).toBe('Murder')
    expect(bundle.cards.get(92176)).toMatchObject({ colors: 'B', colorIdentity: 'WB' })
    expect(bundle.cards.get(92188)).not.toHaveProperty('imageSmall')
    expect(bundle.cards.get(92188)).not.toHaveProperty('setCode')
    expect(bundle).not.toHaveProperty('ratings')
    expect(bundle).not.toHaveProperty('attribution')
  })

  it.skipIf(!have)('warns loudly when a legacy per-grpId cards file is loaded', () => {
    const root = mkdtempSync(join(tmpdir(), 'draftfm-legacy-bundle-'))
    const modelDir = join(root, 'model', 'v-test')
    const setDir = join(root, 'sets', 'DSK')
    mkdirSync(modelDir, { recursive: true })
    mkdirSync(setDir, { recursive: true })
    writeFileSync(join(modelDir, 'scorer.onnx'), '')
    copyFileSync(DSK_ASSETS, join(setDir, 'assets.npz'))
    writeJson(join(setDir, 'cards.json'), [{ grpId: 92188, name: 'Murder', rarity: 'common' }])

    const previous = console.warn
    const warnings: string[] = []
    console.warn = (message?: unknown) => { warnings.push(String(message)) }
    try {
      loadSetBundle(root, 'DSK')
    } finally {
      console.warn = previous
    }
    expect(warnings).toEqual([
      '[Bundle] DSK cards.json is missing the name-keyed cards object; rebuild the shipped set bundles'
    ])
  })

  it.skipIf(!have)('ModelManager scores a real pack with grades and caches the P1P1 curve', async () => {
    const cache = mkdtempSync(join(tmpdir(), 'p1p1-'))
    const m = new ModelManager(cache, ROOT)
    expect(m.sets).toContain('DSK')
    const r = await m.score('DSK', 'QuickDraft', [92188, 92176, 92380], [], 0, 0)
    expect(r?.cards[0].grpId).toBe(92176)
    expect(r?.cards[0].grade).toMatch(/^[AB]/)
    expect(m.intrinsic(92176)?.percentile).toBeGreaterThan(0.75)
    expect(m.status('DSK', 'QuickDraft').state).toBe('ready')
    expect(m.status('XYZ', 'QuickDraft').state).toBe('no-set')
    // second manager reuses the on-disk curve
    const m2 = new ModelManager(cache, ROOT)
    const r2 = await m2.score('DSK', 'QuickDraft', [92188, 92176], [], 0, 0)
    expect(r2?.cards[0].grade).toBe(r?.cards[0].grade)
  }, 30000)
})

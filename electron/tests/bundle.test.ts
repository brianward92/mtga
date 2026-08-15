import { describe, expect, it } from 'vitest'
import { join } from 'path'
import { existsSync } from 'fs'
import { readBundleIndex, loadSetBundle, ratingsFor } from '../main/data/bundle'
import { ModelManager } from '../main/model/manager'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'

const ROOT = join(__dirname, '..', 'resources', 'draftfm')
const have = existsSync(join(ROOT, 'sets', 'DSK', 'assets.npz'))

describe('set bundle', () => {
  it.skipIf(!have)('index lists the shipped sets and the model dir', () => {
    const idx = readBundleIndex(ROOT)!
    expect(idx.modelTag).toBe('v20260809_final_d256')
    expect(Object.keys(idx.sets)).toEqual(expect.arrayContaining(['DSK', 'HOB']))
  })
  it.skipIf(!have)('loads DSK identity + ratings', () => {
    const b = loadSetBundle(ROOT, 'DSK')!
    expect(b.picksPerPack).toBe(14)
    const funeral = b.cards.get(92176)!
    expect(funeral.name).toBe('Funeral Room // Awakening Hall')
    expect(funeral.rarity).toBe('mythic')
    expect(funeral.imageSmall).toMatch(/^https:\/\/cards\.scryfall\.io/)
    const r = ratingsFor(b, 'QuickDraft')!
    expect(r.size).toBeGreaterThan(200)
    expect(r.get(92188)).toBeDefined() // Murder
    expect(b.attribution).toContain('17Lands')
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

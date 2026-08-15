import { describe, expect, it } from 'vitest'
import { join } from 'path'
import { existsSync, readFileSync } from 'fs'
import { DraftFM, positionFeatures, rankScores } from '../main/model/draftfm'
import { parseNpz } from '../main/model/npz'

const ROOT = join(__dirname, '..', 'resources', 'draftfm')
const MODEL = join(ROOT, 'model', 'v20260809_final_d256')
const DSK = join(ROOT, 'sets', 'DSK', 'assets.npz')
const FIX = join(__dirname, 'fixtures', 'draftfm-reference-DSK.json')
const have = existsSync(MODEL) && existsSync(DSK) && existsSync(FIX)

describe('npz reader', () => {
  it.skipIf(!have)('parses the DSK set assets', () => {
    const z = parseNpz(readFileSync(DSK))
    expect(z.features.kind).toBe('f16')
    expect(z.features.shape[1]).toBe(775)
    expect(z.names.kind).toBe('str')
    expect((z.names.data as string[]).length).toBe(z.features.shape[0])
    expect(JSON.parse((z.grp_ids.data as string[])[0])['Murder']).toContain(92188)
  })
})

describe('DraftFM helpers', () => {
  it('position features match the python twin', () => {
    expect(Array.from(positionFeatures(0, 0, 14))).toEqual(Array.from(Float32Array.from([1, 0, 0, 0, 13 / 14, 0, 0])))
    const p = positionFeatures(2, 11, 14)
    expect(p[2]).toBe(1)
    expect(p[5]).toBeCloseTo((2 * 14 + 11) / 45, 6)
    expect(p[6]).toBeCloseTo(Math.min((2 * 14 + 11) / 42, 1), 6)
  })
  it('rankScores: unknown last, softmax over known', () => {
    const r = rankScores([1, 2, 3], [0.5, null, 1.5])
    expect(r.map(s => s.grpId)).toEqual([3, 1, 2])
    expect(r[0].rank).toBe(1)
    expect(r[2].ev).toBeNull()
    expect(r[0].prob! + r[1].prob!).toBeCloseTo(1, 9)
  })
})

describe('DraftFM (bundled v1.0 + DSK assets)', () => {
  it.skipIf(!have)('reproduces the python reference scores', async () => {
    const fix = JSON.parse(readFileSync(FIX, 'utf8'))
    const model = await DraftFM.load(MODEL, 'DSK', 'QuickDraft', DSK)
    expect(model.modelId).toBe(fix.model_id)
    for (const c of fix.cases) {
      const got = await model.scorePack(c.pack, c.pool, c.pack_number, c.pick_number)
      expect(got.map(s => s.grpId)).toEqual(c.scores.map((s: { grp_id: number }) => s.grp_id))
      c.scores.forEach((ref: { ev: number | null; prob: number | null; rank: number }, i: number) => {
        expect(got[i].rank).toBe(ref.rank)
        if (ref.ev === null) { expect(got[i].ev).toBeNull(); return }
        expect(got[i].ev!).toBeCloseTo(ref.ev, 3)
        expect(got[i].prob!).toBeCloseTo(ref.prob!, 4)
      })
    }
    const curve = Array.from(await model.p1p1Logits()).sort((a, b) => a - b)
    expect(curve.length).toBeGreaterThan(300)
    for (let i = 1; i < curve.length; i++) expect(curve[i]).toBeGreaterThanOrEqual(curve[i - 1])
    await model.release()
  }, 30000)

  it.skipIf(!have)('scores a pack in well under 5 ms once warm', async () => {
    const model = await DraftFM.load(MODEL, 'DSK', 'QuickDraft', DSK)
    const pack = [92188, 92154, 92073, 92248, 92224, 92346, 92290, 92076, 92231, 92161, 92082, 92310, 92176, 92380]
    await model.scorePack(pack, [], 0, 0)
    const t = performance.now()
    for (let i = 0; i < 20; i++) await model.scorePack(pack, [92176, 92231], 0, 2)
    const per = (performance.now() - t) / 20
    expect(per).toBeLessThan(5)
    await model.release()
  }, 30000)
})

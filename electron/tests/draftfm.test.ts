import { describe, expect, it } from 'vitest'
import { join } from 'path'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { createHash } from 'crypto'
import { DraftFM, positionFeatures, rankScores } from '../main/model/draftfm'
import { parseNpz } from '../main/model/npz'
import { gradeForPercentile, gradeOrdinal, percentileOf } from '../shared/grades'
import { ModelManager } from '../main/model/manager'

const ROOT = join(__dirname, '..', 'resources', 'draftfm')
const MODEL = join(ROOT, 'model', 'v20260809_final_d256')
const DSK = join(ROOT, 'sets', 'DSK', 'assets.npz')
const DSK_CARDS = join(ROOT, 'sets', 'DSK', 'cards.json')
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
    const cards = JSON.parse(readFileSync(DSK_CARDS, 'utf8'))
    expect(fix.scryfall_updated_at).toBe(cards.scryfall_updated_at)
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
    const curve = Array.from(await model.setLogits([], 0, 0)).sort((a, b) => a - b)
    expect(curve.length).toBe(Object.keys(cards.cards).length)
    expect(curve.length).toBe(286) // curated DSK oracle-name universe
    for (let i = 1; i < curve.length; i++) expect(curve[i]).toBeGreaterThanOrEqual(curve[i - 1])
    await model.release()
  }, 30000)

  it.skipIf(!have)('matches the python pool-conditioned whole-set curve and grade ladder', async () => {
    const fix = JSON.parse(readFileSync(FIX, 'utf8'))
    const ref = fix.conditioned_whole_set
    // Python first resolved DSK/QuickDraft against the rebuild data root to
    // pin the model/serving constants, then ran that OnnxDraftFMModel with the
    // shipped 286-row assets override used here (not the rebuild's 333 rows).
    expect(ref.reference_source.fixture_rows).toBe(286)
    expect(ref.reference_source.resolver_rows).toBe(333)

    const meta = JSON.parse(readFileSync(join(MODEL, 'meta.json'), 'utf8'))
    const assets = parseNpz(readFileSync(DSK))
    const names = assets.names.data as string[]
    expect(fix).toMatchObject({ model_id: meta.model_id, manifest_hash: meta.manifest_hash, set: 'DSK', format: 'QuickDraft' })
    expect((assets.manifest_hash.data as string[])[0]).toBe(fix.manifest_hash)
    expect(names).toHaveLength(ref.reference_source.fixture_rows)
    expect(createHash('sha256').update(names.join('\n')).digest('hex')).toBe(ref.reference_source.asset_names_sha256)
    expect(names[ref.grade_probe.asset_row]).toBe(ref.grade_probe.name)

    const model = await DraftFM.load(MODEL, 'DSK', 'QuickDraft', DSK)
    const started = performance.now()
    const logits = await model.setLogits(ref.pool, ref.pack_number, ref.pick_number)
    const runtimeMs = performance.now() - started

    expect(logits).toHaveLength(ref.logits.length)
    expect(logits).toHaveLength(ref.percentile_denominator)
    const maxAbsDiff = logits.reduce((max, value, row) => Math.max(max, Math.abs(value - ref.logits[row])), 0)
    expect(maxAbsDiff).toBeLessThanOrEqual(1e-3)
    expect(runtimeMs).toBeLessThan(5000)

    const sorted = Float32Array.from(logits).sort()
    const percentileRanks = Array.from(logits, value => Math.round(percentileOf(value, sorted) * sorted.length))
    expect(percentileRanks).toEqual(ref.percentile_ranks)
    const gradeOrdinals = Array.from(logits, value => gradeOrdinal(gradeForPercentile(percentileOf(value, sorted))))
    expect(gradeOrdinals).toEqual(ref.grade_ordinals)

    // ModelManager calls this second curve the setGrade: empty-pool P1P1.
    // The live-pool grade must be genuinely conditioned, not a relabelled raw grade.
    const p1p1 = await model.setLogits([], 0, 0)
    const p1p1Sorted = Float32Array.from(p1p1).sort()
    const setGradeOrdinals = Array.from(p1p1, value => gradeOrdinal(gradeForPercentile(percentileOf(value, p1p1Sorted))))
    const changed = gradeOrdinals.filter((grade, row) => grade !== setGradeOrdinals[row]).length
    expect(changed).toBe(ref.changed_from_p1p1)
    expect(changed).toBeGreaterThan(0)
    await model.release()
  }, 30000)

  it.skipIf(!have)('exposes distinct pool and set grades through ModelManager', async () => {
    const fix = JSON.parse(readFileSync(FIX, 'utf8'))
    const ref = fix.conditioned_whole_set
    const probe = ref.grade_probe
    const cache = mkdtempSync(join(tmpdir(), 'draftfm-conditioned-'))
    try {
      const manager = new ModelManager(cache, ROOT)
      const result = await manager.score(fix.set, fix.format, [probe.grp_id], ref.pool, ref.pack_number, ref.pick_number)
      expect(result?.modelId).toBe(fix.model_id)
      const card = result?.cards.find(({ grpId }) => grpId === probe.grp_id)
      expect(card).toMatchObject({ grade: 'B+', setGrade: 'B-' })
      expect(card?.percentile).toBe(ref.percentile_ranks[probe.asset_row] / ref.percentile_denominator)
      expect(gradeOrdinal(card!.grade!)).toBe(probe.conditioned_grade_ordinal)
      expect(gradeOrdinal(card!.setGrade!)).toBe(probe.p1p1_grade_ordinal)
      expect(card!.grade).not.toBe(card!.setGrade)
    } finally {
      rmSync(cache, { recursive: true, force: true })
    }
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

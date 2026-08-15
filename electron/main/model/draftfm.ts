/**
 * DraftFM zero-shot pick model, served in-process (onnxruntime-node).
 *
 * Port of mtga/models/draftfm.py (OnnxDraftFMModel) — the paper's foundation
 * model exported as ONNX: card_encoder.onnx (features → card_emb) run ONCE per
 * set to build a table, then scorer.onnx per pick over gathered rows.
 *
 * Bundle layout (electron resources/draftfm/):
 *   model/<tag>/{card_encoder.onnx,card_encoder.onnx.data,scorer.onnx,
 *                scorer.onnx.data,constants.npz,meta.json}
 *   sets/<SET>.npz          per-set assets from scripts/build_set_assets.py
 *
 * Numeric contract (kept identical to Python so fixtures cross-check):
 *   features float32 [N,775] (fp16 in assets, widened) → card_emb [N,d]
 *   scorer inputs: pool_emb f32 [1,P,d], pool_counts i64 [1,P],
 *     pool_mask bool [1,P], pack_emb f32 [1,K,d], pack_mask bool [1,K],
 *     wr_id/games_id/format_id i64 [1], position f32 [1,7],
 *     set_scalars f32 [1,4] (+ set_summary when the export has one)
 *   → logits f32 [1,K]; probs = softmax over known cards.
 */
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import * as ort from 'onnxruntime-node'
import { parseNpz, halfArrayToFloat32, type NpyData } from './npz'

export const POOL_COUNT_CAP = 8
const FORMAT_IDS: Record<string, number> = { PremierDraft: 0, TradDraft: 1 }
export const OTHER_FORMAT_ID = 2
const DEFAULT_PICKS_PER_PACK = 14

export interface CardScore {
  grpId: number
  /** Model logit; null when the card is unknown to the set assets. */
  ev: number | null
  /** Softmax over the pack's known cards; null when unknown. */
  prob: number | null
  /** 1-based rank (unknown cards sort last, keeping input order). */
  rank: number
}

export interface DraftFMMeta {
  model_id: string
  kind: string
  manifest_hash?: string
  serving?: { wr_id?: number; games_id?: number }
  feat_dim?: number
  d_model?: number
  [k: string]: unknown
}

export interface SetAssets {
  set: string
  features: Float32Array // [N, featDim] row-major
  n: number
  featDim: number
  rarityIds: Uint8Array
  names: string[]
  /** name -> grpIds */
  grpIds: Record<string, number[]>
  manifestHash: string
  picksPerPack: number
}

/** Numpy twin of mtga.foundation.model.position_features for one pick. */
export function positionFeatures(packNumber: number, pickNumber: number, picksPerPack: number): Float32Array {
  const ppp = picksPerPack
  const poolSize = packNumber * ppp + pickNumber
  return Float32Array.from([
    packNumber === 0 ? 1 : 0,
    packNumber === 1 ? 1 : 0,
    packNumber === 2 ? 1 : 0,
    pickNumber / ppp,
    Math.max(ppp - 1 - pickNumber, 0) / ppp,
    poolSize / 45,
    Math.min(poolSize / (3 * ppp), 1)
  ])
}

function scalarString(a: NpyData | undefined): string {
  if (!a) return ''
  if (a.kind === 'str') return a.data[0] ?? ''
  return String((a.data as ArrayLike<number | bigint>)[0] ?? '')
}

/** Load per-set assets from a build_set_assets.py npz. */
export function loadSetAssets(path: string): SetAssets {
  if (!existsSync(path)) throw new Error(`no DraftFM set assets at ${path}`)
  const z = parseNpz(readFileSync(path))
  const f = z.features
  if (!f || f.shape.length !== 2) throw new Error('set assets: features must be [N, F]')
  const features = f.kind === 'f16' ? halfArrayToFloat32(f.data)
    : f.kind === 'f32' ? f.data
    : f.kind === 'f64' ? Float32Array.from(f.data)
    : null
  if (!features) throw new Error(`set assets: unsupported features dtype ${f.kind}`)
  const rar = z.rarity_ids
  const rarityIds = rar && rar.kind === 'u8' ? rar.data : Uint8Array.from((rar?.data as ArrayLike<number>) ?? [])
  const names = z.names?.kind === 'str' ? z.names.data : []
  const grpIds = JSON.parse(scalarString(z.grp_ids) || '{}') as Record<string, number[]>
  const ppp = Number(scalarString(z.picks_per_pack)) || DEFAULT_PICKS_PER_PACK
  return {
    set: scalarString(z.set),
    features,
    n: f.shape[0],
    featDim: f.shape[1],
    rarityIds,
    names,
    grpIds,
    manifestHash: scalarString(z.manifest_hash),
    picksPerPack: ppp
  }
}

/** Shared ranking helper: mirrors mtga.models.base.rank_scores. */
export function rankScores(grpIds: number[], evs: Array<number | null>): CardScore[] {
  const known = grpIds.map((g, i) => [g, evs[i]] as const).filter(([, e]) => e !== null) as Array<[number, number]>
  // Softmax over known EVs keyed by grpId (a duplicated grpId contributes
  // once, matching the Python dict comprehension).
  let exps: Map<number, number> | null = null
  let total = 0
  if (known.length) {
    const peak = Math.max(...known.map(([, e]) => e))
    exps = new Map()
    for (const [g, e] of known) exps.set(g, Math.exp(e - peak))
    for (const v of exps.values()) total += v
  }
  const ordered = grpIds.map((g, i) => ({ g, e: evs[i], i }))
    .sort((a, b) => {
      const an = a.e === null ? 1 : 0, bn = b.e === null ? 1 : 0
      if (an !== bn) return an - bn
      const d = -((a.e ?? 0) - (b.e ?? 0))
      if (d !== 0) return d
      return a.i - b.i
    })
  return ordered.map((o, idx) => ({
    grpId: o.g,
    ev: o.e,
    prob: o.e !== null && exps ? (exps.get(o.g)! / total) : null,
    rank: idx + 1
  }))
}

export class DraftFM {
  readonly meta: DraftFMMeta
  readonly modelId: string
  readonly setCode: string
  readonly limitedType: string
  private scorer!: ort.InferenceSession
  private table!: Float32Array // [N, d]
  private d!: number
  private setSummary: Float32Array | null = null
  private poolNull!: Float32Array
  private grpToRow = new Map<number, number>()
  private wrId = 33
  private gamesId = 6
  private formatId = OTHER_FORMAT_ID
  picksPerPack = DEFAULT_PICKS_PER_PACK
  private setScalars!: Float32Array
  private ready: Promise<void>

  private constructor(versionDir: string, setCode: string, limitedType: string, private assets: SetAssets) {
    this.meta = JSON.parse(readFileSync(join(versionDir, 'meta.json'), 'utf8')) as DraftFMMeta
    this.modelId = this.meta.model_id
    this.setCode = setCode
    this.limitedType = limitedType
    const expected = this.meta.manifest_hash
    if (expected && assets.manifestHash && expected !== assets.manifestHash) {
      throw new Error(`featurizer manifest mismatch for ${setCode}: model ${expected.slice(0, 12)} vs assets ${assets.manifestHash.slice(0, 12)}`)
    }
    this.ready = this.init(versionDir)
  }

  /** Construct + warm (card table encoded once). */
  static async load(versionDir: string, setCode: string, limitedType: string, assetsPath: string): Promise<DraftFM> {
    const assets = loadSetAssets(assetsPath)
    const m = new DraftFM(versionDir, setCode, limitedType, assets)
    await m.ready
    return m
  }

  private async init(versionDir: string): Promise<void> {
    const a = this.assets
    const featDim = this.meta.feat_dim
    let features = a.features
    let width = a.featDim
    if (featDim && a.featDim > featDim) {
      // No-text exports use 391 of the 775 dims: slice each row.
      features = new Float32Array(a.n * featDim)
      for (let r = 0; r < a.n; r++) features.set(a.features.subarray(r * a.featDim, r * a.featDim + featDim), r * featDim)
      width = featDim
    }
    const opts: ort.InferenceSession.SessionOptions = { executionProviders: ['cpu'], graphOptimizationLevel: 'all', intraOpNumThreads: 2 }
    const encoder = await ort.InferenceSession.create(join(versionDir, 'card_encoder.onnx'), opts)
    const enc = await encoder.run({ features: new ort.Tensor('float32', features, [a.n, width]) })
    const emb = enc.card_emb
    this.d = emb.dims[1]
    this.table = new Float32Array(emb.data as Float32Array)
    await encoder.release()

    this.scorer = await ort.InferenceSession.create(join(versionDir, 'scorer.onnx'), opts)
    const setEncPath = join(versionDir, 'set_encoder.onnx')
    if (existsSync(setEncPath)) {
      const setEnc = await ort.InferenceSession.create(setEncPath, opts)
      const out = await setEnc.run({
        card_emb: new ort.Tensor('float32', this.table, [a.n, this.d]),
        rarity_ids: new ort.Tensor('int64', BigInt64Array.from(Array.from(a.rarityIds, v => BigInt(v))), [a.n])
      })
      this.setSummary = new Float32Array(out.set_summary.data as Float32Array)
      await setEnc.release()
    }
    const consts = parseNpz(readFileSync(join(versionDir, 'constants.npz')))
    const pn = consts.pool_null_input
    this.poolNull = pn.kind === 'f32' ? pn.data : pn.kind === 'f16' ? halfArrayToFloat32(pn.data) : Float32Array.from(pn.data as ArrayLike<number>)

    a.names.forEach((name, row) => {
      for (const g of a.grpIds[name] ?? []) if (!this.grpToRow.has(g)) this.grpToRow.set(g, row)
    })
    this.wrId = Number(this.meta.serving?.wr_id ?? 33)
    this.gamesId = Number(this.meta.serving?.games_id ?? 6)
    this.formatId = FORMAT_IDS[this.limitedType] ?? OTHER_FORMAT_ID
    this.picksPerPack = a.picksPerPack || DEFAULT_PICKS_PER_PACK
    const ppp = this.picksPerPack
    this.setScalars = Float32Array.from([a.names.length / 400, ppp === 13 ? 1 : 0, ppp === 14 ? 1 : 0, ppp === 15 ? 1 : 0])
  }

  /** Whether the set assets know this grpId. */
  knows(grpId: number): boolean { return this.grpToRow.has(grpId) }

  private gather(rows: number[]): Float32Array {
    const out = new Float32Array(rows.length * this.d)
    rows.forEach((r, i) => out.set(this.table.subarray(r * this.d, (r + 1) * this.d), i * this.d))
    return out
  }

  private poolInputs(poolGrpIds: number[]): { emb: Float32Array; counts: BigInt64Array; p: number } {
    const rows = poolGrpIds.map(g => this.grpToRow.get(g)).filter((r): r is number => r !== undefined)
    if (!rows.length) return { emb: this.poolNull, counts: BigInt64Array.from([0n]), p: 1 }
    const counts = new Map<number, number>()
    for (const r of rows) counts.set(r, (counts.get(r) ?? 0) + 1)
    const uniq = [...counts.keys()].sort((x, y) => x - y)
    return {
      emb: this.gather(uniq),
      counts: BigInt64Array.from(uniq.map(r => BigInt(Math.min(counts.get(r)!, POOL_COUNT_CAP)))),
      p: uniq.length
    }
  }

  private feedsFor(pool: { emb: Float32Array; counts: BigInt64Array; p: number }, packRows: number[], position: Float32Array): Record<string, ort.Tensor> {
    const feeds: Record<string, ort.Tensor> = {
      pool_emb: new ort.Tensor('float32', pool.emb, [1, pool.p, this.d]),
      pool_counts: new ort.Tensor('int64', pool.counts, [1, pool.p]),
      pool_mask: new ort.Tensor('bool', new Uint8Array(pool.p), [1, pool.p]),
      pack_emb: new ort.Tensor('float32', this.gather(packRows), [1, packRows.length, this.d]),
      pack_mask: new ort.Tensor('bool', new Uint8Array(packRows.length), [1, packRows.length]),
      wr_id: new ort.Tensor('int64', BigInt64Array.from([BigInt(this.wrId)]), [1]),
      games_id: new ort.Tensor('int64', BigInt64Array.from([BigInt(this.gamesId)]), [1]),
      format_id: new ort.Tensor('int64', BigInt64Array.from([BigInt(this.formatId)]), [1]),
      position: new ort.Tensor('float32', position, [1, 7]),
      set_scalars: new ort.Tensor('float32', this.setScalars, [1, 4])
    }
    if (this.setSummary) feeds.set_summary = new ort.Tensor('float32', this.setSummary, [this.setSummary.length])
    return feeds
  }

  async scorePack(packGrpIds: number[], poolGrpIds: number[], packNumber?: number, pickNumber?: number): Promise<CardScore[]> {
    const rows = packGrpIds.map(g => this.grpToRow.get(g) ?? null)
    const known = [...new Set(rows.filter((r): r is number => r !== null))].sort((x, y) => x - y)
    if (!known.length) return rankScores(packGrpIds, packGrpIds.map(() => null))

    const pool = this.poolInputs(poolGrpIds)
    if (packNumber === undefined || pickNumber === undefined) {
      const poolSize = poolGrpIds.length
      packNumber = Math.floor(poolSize / this.picksPerPack)
      pickNumber = poolSize % this.picksPerPack
    }
    const out = await this.scorer.run(this.feedsFor(pool, known, positionFeatures(packNumber, pickNumber, this.picksPerPack)))
    const logits = out.logits.data as Float32Array
    const byRow = new Map<number, number>()
    known.forEach((r, i) => byRow.set(r, logits[i]))
    return rankScores(packGrpIds, rows.map(r => (r === null ? null : byRow.get(r)!)))
  }

  /**
   * Set-relative P1P1 curve: every card's logit at pack 1 pick 1 with an empty
   * pool, sorted ascending — powers percentile grades without any server.
   */
  /** Unsorted P1P1 logits, one per asset row (row order = assets.names). */
  async p1p1Logits(): Promise<Float32Array> {
    const n = this.assets.n
    const rows = Array.from({ length: n }, (_, i) => i)
    const res = await this.scorer.run(this.feedsFor(this.poolInputs([]), rows, positionFeatures(0, 0, this.picksPerPack)))
    return new Float32Array(res.logits.data as Float32Array)
  }

  /** Number of asset rows (unique card names). */
  get setSize(): number { return this.assets.n }

  /** grpId -> asset row, for every alias the set knows. */
  grpRows(): IterableIterator<[number, number]> { return this.grpToRow.entries() }

  async release(): Promise<void> {
    await this.scorer.release()
  }
}

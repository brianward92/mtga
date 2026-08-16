/**
 * Owns the bundled DraftFM model: one loaded scorer per (set, format), the
 * per-set P1P1 curve for percentile grades (computed once, cached on disk),
 * and a status the UI can show. All local — no network.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { DraftFM, type CardScore } from './draftfm'
import { findBundleRoot, readBundleIndex, loadSetBundle, type BundleIndex, type SetBundle } from '../data/bundle'
import { gradeForPercentile, percentileOf, type Grade } from '../../shared/grades'

/** Model availability shown by the draft UI. */
type ModelState = 'ready' | 'loading' | 'no-bundle' | 'no-set' | 'error'

/** Load/status metadata for the currently requested set and format. */
interface ModelStatus {
  state: ModelState
  modelId: string | null
  modelTag: string | null
  set: string | null
  format: string | null
  message: string | null
  /** Sets the bundle can score. */
  sets: string[]
}

/** One scored card enriched with pool-relative and set-relative grades. */
export interface ScoredCard extends CardScore {
  /** "For your pool": set-relative percentile of the card's pool-conditioned score. */
  percentile: number | null
  grade: Grade | null
  /** Raw set rating: P1P1 / empty-pool percentile (the paper's forecast scale). */
  setPercentile: number | null
  setGrade: Grade | null
}

interface Loaded {
  key: string
  model: DraftFM
  curve: Float32Array
  /** grpId -> P1P1 logit, for per-card percentile lookups */
  p1p1ByGrp: Map<number, number>
  /** grpId -> asset row */
  rowByGrp: Map<number, number>
}

/** Loads and caches the one local DraftFM scorer needed by the live draft. */
export class ModelManager {
  private root: string | null
  private index: BundleIndex | null
  private loaded: Loaded | null = null
  private loading: Promise<Loaded | null> | null = null
  private lastError: string | null = null

  constructor(private cacheDir: string, rootOverride?: string) {
    this.root = rootOverride ?? findBundleRoot()
    this.index = this.root ? readBundleIndex(this.root) : null
  }

  /** Shipped model version tag, or null when no bundle is available. */
  get modelTag(): string | null { return this.index?.modelTag ?? null }
  /** Shipped set codes in stable display order. */
  get sets(): string[] { return this.index ? Object.keys(this.index.sets).sort() : [] }
  /** Whether a set has both index metadata and model assets. */
  hasSet(set: string): boolean { return !!this.index && !!this.index.sets[set] && !!this.root && existsSync(join(this.root, 'sets', set, 'assets.npz')) }
  /** Load static card metadata for a set without loading ONNX sessions. */
  bundleFor(set: string): SetBundle | null { return this.root ? loadSetBundle(this.root, set) : null }

  /** Report model readiness for a requested set and format. */
  status(set: string | null, format: string | null): ModelStatus {
    const base = { modelId: this.loaded?.model.modelId ?? null, modelTag: this.index?.modelTag ?? null, set, format, sets: this.sets, message: null as string | null }
    if (!this.index) return { ...base, state: 'no-bundle', message: 'model bundle missing' }
    if (!set) return { ...base, state: 'ready' }
    if (!this.hasSet(set)) return { ...base, state: 'no-set', message: `${set} not in bundle` }
    if (this.loaded && this.loaded.key === `${set}:${format}`) return { ...base, state: 'ready' }
    if (this.lastError) return { ...base, state: 'error', message: this.lastError }
    return { ...base, state: 'loading' }
  }

  /** Load (or reuse) the scorer for a set/format. Null when not scoreable. */
  async ensure(set: string, format: string): Promise<Loaded | null> {
    const key = `${set}:${format}`
    if (this.loaded?.key === key) return this.loaded
    if (this.loading) { const l = await this.loading; if (l?.key === key) return l }
    if (!this.root || !this.index || !this.hasSet(set)) return null
    const bundle = loadSetBundle(this.root, set)
    if (!bundle) return null
    this.loading = (async () => {
      try {
        const old = this.loaded
        const model = await DraftFM.load(this.index!.modelDir, set, format, bundle.assetsPath)
        const curveInfo = await this.curveFor(model, set, format)
        this.loaded = { key, model, curve: curveInfo.curve, p1p1ByGrp: curveInfo.byGrp, rowByGrp: new Map(model.grpRows()) }
        this.lastError = null
        if (old) void old.model.release()
        return this.loaded
      } catch (err) {
        this.lastError = err instanceof Error ? err.message : String(err)
        console.error('[Model] load failed:', this.lastError)
        return null
      } finally {
        this.loading = null
      }
    })()
    return this.loading
  }

  /**
   * P1P1 curve: every card in the set scored at pack 1 pick 1 with an empty
   * pool (the paper's forecast recipe). Cached per (model tag, set, format).
   */
  private async curveFor(model: DraftFM, set: string, format: string): Promise<{ curve: Float32Array; byGrp: Map<number, number> }> {
    const tag = this.index!.modelTag
    const file = join(this.cacheDir, `p1p1-${tag}-${set}-${format}.json`)
    let logits: number[] | null = null
    if (existsSync(file)) {
      try { logits = JSON.parse(readFileSync(file, 'utf8')) as number[] } catch { logits = null }
    }
    if (!logits || logits.length !== model.setSize) {
      const raw = await model.setLogits([], 0, 0)
      logits = Array.from(raw)
      try { mkdirSync(this.cacheDir, { recursive: true }); writeFileSync(file, JSON.stringify(logits)) } catch { /* cache is best-effort */ }
    }
    const byGrp = new Map<number, number>()
    for (const [grpId, row] of model.grpRows()) byGrp.set(grpId, logits[row])
    return { curve: Float32Array.from(logits).sort(), byGrp }
  }

  /** Score a pack; pack/pick numbers are 0-based (model convention). */
  async score(set: string, format: string, pack: number[], pool: number[], pack0: number, pick0: number): Promise<{ modelId: string; cards: ScoredCard[] } | null> {
    const l = await this.ensure(set, format)
    if (!l) return null
    const scores = await l.model.scorePack(pack, pool, pack0, pick0)
    // "For your pool": the whole set scored under the live pool/position, so a
    // card's letter reflects what it is worth to THIS draft; the raw set
    // grade (empty pool, P1P1) is kept alongside for reference.
    const poolCurve = pool.length ? await l.model.setLogits(pool, pack0, pick0) : null
    const poolByRow = poolCurve ? poolCurve : null
    const poolSorted = poolCurve ? Float32Array.from(poolCurve).sort() : null
    return {
      modelId: l.model.modelId,
      cards: scores.map(s => {
        const p1 = l.p1p1ByGrp.get(s.grpId)
        const setPercentile = p1 === undefined ? null : percentileOf(p1, l.curve)
        const setGrade = setPercentile === null ? null : gradeForPercentile(setPercentile)
        let percentile = setPercentile
        let grade = setGrade
        const row = l.rowByGrp.get(s.grpId)
        if (poolByRow && poolSorted && row !== undefined) {
          percentile = percentileOf(poolByRow[row], poolSorted)
          grade = gradeForPercentile(percentile)
        }
        return { ...s, percentile, grade, setPercentile, setGrade }
      })
    }
  }

  /** Intrinsic (P1P1) grade for a card, if the set is loaded. */
  intrinsic(grpId: number): { percentile: number; grade: Grade } | null {
    const l = this.loaded
    if (!l) return null
    const p1 = l.p1p1ByGrp.get(grpId)
    if (p1 === undefined) return null
    const percentile = percentileOf(p1, l.curve)
    return { percentile, grade: gradeForPercentile(percentile) }
  }
}

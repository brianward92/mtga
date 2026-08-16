/**
 * Draft coordinator: turns DraftParser events into DraftState snapshots for
 * the overlay, scoring each pack locally with the bundled DraftFM model.
 *
 * Responsibilities: session lifecycle (start/pack/pick/end + linger),
 * card identity from the set bundle, async scoring (0-based pack/pick — the
 * model convention), grades from the set's P1P1 curve, pool + pick history,
 * and JSONL persistence. It knows nothing about windows.
 */
import { EventEmitter } from 'events'
import type { DraftSessionSnapshot, DraftPickRecord } from '../parser/draft-session'
import { ModelManager, type ScoredCard } from '../model/manager'
import { type SetBundle, type CardInfo } from '../data/bundle'
import { DraftHistory } from '../data/history'
import { EMPTY_STATE, type CardRow, type DraftState, type PickRecord } from '../../shared/state'
import { COMPLETE_LINGER_MS } from './completion'

/** Converts parser snapshots into renderer-ready draft state and history. */
export class DraftCoordinator extends EventEmitter {
  private state: DraftState = { ...EMPTY_STATE }
  private snapshot: DraftSessionSnapshot | null = null
  private bundle: SetBundle | null = null
  private scoreToken = 0
  private lastScores: { pack: number; pick: number; cards: ScoredCard[]; modelId: string } | null = null
  private endTimer: NodeJS.Timeout | null = null
  private replaying = false
  /** Bumped whenever the draft changes; in-flight backfills check it and abort. */
  private draftToken = 0

  constructor(private models: ModelManager, private history: DraftHistory) {
    super()
  }

  /** Current snapshot for late-attaching renderers. */
  get current(): DraftState { return this.state }

  /** During log replay nothing is scored/persisted; state is rebuilt silently. */
  setReplaying(on: boolean): void { this.replaying = on }

  // ---- parser events ------------------------------------------------------

  onDraftStart(snap: DraftSessionSnapshot): void {
    this.clearEndTimer()
    this.draftToken++
    this.snapshot = snap
    this.bundle = snap.set ? this.models.bundleFor(snap.set) : null
    this.lastScores = null
    const ppp = this.bundle?.picksPerPack ?? 14
    this.state = {
      ...EMPTY_STATE,
      phase: 'active',
      set: snap.set, format: snap.format, eventName: snap.eventName, isBotDraft: snap.isBotDraft,
      picksPerPack: ppp, totalPicks: 3 * ppp,
      pool: this.rows(snap.pool),
      picks: [],
      model: this.modelInfo(snap),
      snapshot: { scryfall: this.bundle?.scryfallUpdatedAt ?? null, model: this.models.modelTag },
      seq: this.state.seq + 1
    }
    if (!this.replaying) this.history.append({ at: new Date().toISOString(), type: 'draft-start', draftId: snap.draftId, eventName: snap.eventName, set: snap.set, format: snap.format })
    this.publish()
    if (!this.replaying && snap.set && snap.format) void this.models.ensure(snap.set, snap.format).then(() => this.refreshModelInfo())
  }

  onDraftPack(snap: DraftSessionSnapshot): void {
    if (this.state.phase !== 'active' || !this.snapshot) this.onDraftStart(snap)
    this.snapshot = snap
    const cur = snap.currentPack
    if (!cur) return
    this.state = {
      ...this.state,
      pack: cur.pack, pick: cur.pick,
      cards: this.rows(cur.grpIds),
      pool: this.rows(snap.pool),
      scoring: !this.replaying,
      seq: this.state.seq + 1
    }
    this.publish()
    if (!this.replaying) void this.score(snap)
  }

  onDraftPick(snap: DraftSessionSnapshot, pick: DraftPickRecord): void {
    this.snapshot = snap
    const takenGrp = pick.grpIds[0]
    const scores = this.lastScores && this.lastScores.pack === pick.pack && this.lastScores.pick === pick.pick ? this.lastScores : null
    const rec = scores?.cards.find(c => c.rank === 1) ?? null
    const taken = scores?.cards.find(c => c.grpId === takenGrp) ?? null
    const record: PickRecord = {
      pack: pick.pack, pick: pick.pick,
      grpId: takenGrp, name: this.card(takenGrp)?.name ?? `#${takenGrp}`,
      recommendedGrpId: rec?.grpId ?? null,
      recommendedName: rec ? (this.card(rec.grpId)?.name ?? null) : null,
      takenRank: taken?.rank ?? null,
      ev: taken?.ev ?? null
    }
    const picks = [...this.state.picks.filter(p => !(p.pack === pick.pack && p.pick === pick.pick)), record]
      .sort((a, b) => a.pack - b.pack || a.pick - b.pick)
    // The pack is stale once picked: drop its rows until the next pack lands.
    this.state = { ...this.state, picks, pool: this.rows(snap.pool), cards: [], scoring: false, seq: this.state.seq + 1 }
    this.publish()
    if (!this.replaying) {
      this.history.append({ at: new Date().toISOString(), type: 'pick', draftId: snap.draftId, eventName: snap.eventName, set: snap.set, format: snap.format, ...record, modelId: scores?.modelId ?? null })
    }
  }

  onDraftEnd(snap: DraftSessionSnapshot): void {
    this.snapshot = snap
    this.state = { ...this.state, phase: 'complete', cards: [], scoring: false, pool: this.rows(snap.pool), seq: this.state.seq + 1 }
    this.publish()
    if (!this.replaying) this.history.append({ at: new Date().toISOString(), type: 'draft-end', draftId: snap.draftId, eventName: snap.eventName, set: snap.set, format: snap.format, picks: this.state.picks.length })
    this.clearEndTimer()
    this.endTimer = setTimeout(() => { this.endTimer = null; this.idle() }, COMPLETE_LINGER_MS)
  }

  /**
   * Replay finished: if a draft is mid-flight, score its live pack now and
   * backfill model comparisons for picks made while the app was not running.
   */
  resumeAfterReplay(): void {
    this.replaying = false
    const snap = this.snapshot
    if (!snap || snap.state !== 'active') return
    if (snap.set && snap.format) void this.models.ensure(snap.set, snap.format).then(() => this.refreshModelInfo())
    if (snap.currentPack) {
      this.state = { ...this.state, scoring: true, seq: this.state.seq + 1 }
      this.publish()
      void this.score(snap)
    }
    void this.backfillPicks(snap)
  }

  /** Surface (or clear) a setup warning without touching draft state. */
  setWarning(warning: string | null): void {
    if (this.state.warning === warning) return
    this.state = { ...this.state, warning, seq: this.state.seq + 1 }
    this.publish()
  }

  /** User dismissed / timer: back to idle. */
  idle(): void {
    this.clearEndTimer()
    this.draftToken++
    this.snapshot = null
    this.lastScores = null
    this.state = { ...EMPTY_STATE, model: this.models.status(null, null), warning: this.state.warning, seq: this.state.seq + 1 }
    this.publish()
  }

  // ---- internals ----------------------------------------------------------

  private async score(snap: DraftSessionSnapshot): Promise<void> {
    const cur = snap.currentPack
    if (!cur || !snap.set) { this.state = { ...this.state, scoring: false, seq: this.state.seq + 1 }; this.publish(); return }
    const token = ++this.scoreToken
    const format = snap.format ?? 'PremierDraft'
    // Model convention: 0-based pack/pick (parser exposes 1-based).
    const result = await this.models.score(snap.set, format, cur.grpIds, snap.pool, cur.pack - 1, cur.pick - 1)
    if (token !== this.scoreToken) return // a newer pack superseded this one
    const live = this.snapshot?.currentPack
    if (!live || live.pack !== cur.pack || live.pick !== cur.pick) return
    if (!result) {
      this.state = { ...this.state, scoring: false, model: this.modelInfo(snap), seq: this.state.seq + 1 }
      this.publish()
      return
    }
    this.lastScores = { pack: cur.pack, pick: cur.pick, cards: result.cards, modelId: result.modelId }
    const byGrp = new Map(result.cards.map(c => [c.grpId, c]))
    this.state = {
      ...this.state,
      cards: this.state.cards.map(row => {
        const s = byGrp.get(row.grpId)
        return s ? { ...row, ev: s.ev, prob: s.prob, rank: s.rank, percentile: s.percentile, grade: s.grade, setPercentile: s.setPercentile, setGrade: s.setGrade } : row
      }),
      scoring: false,
      model: this.modelInfo(snap),
      pool: this.rows(snap.pool),
      seq: this.state.seq + 1
    }
    this.publish()
  }

  /**
   * Replayed picks carry no model comparison (nothing was scored while the app
   * was down). Re-score each such pack against the pool as it stood at the
   * time and fill the in-memory records; the JSONL history is left untouched
   * since those picks were never appended live. Publishes once at the end.
   */
  private async backfillPicks(snap: DraftSessionSnapshot): Promise<void> {
    if (!snap.set) return
    const format = snap.format ?? 'PremierDraft'
    const token = this.draftToken
    const missing = this.state.picks.filter(p => p.recommendedGrpId === null)
    if (missing.length === 0) return
    const filled = new Map<string, PickRecord>()
    const pool: number[] = []
    for (const pick of snap.picks) {
      const key = `${pick.pack}-${pick.pick}`
      const record = missing.find(p => p.pack === pick.pack && p.pick === pick.pick)
      if (record && pick.packGrpIds.length) {
        // Model convention: 0-based pack/pick (parser exposes 1-based).
        const result = await this.models.score(snap.set, format, pick.packGrpIds, [...pool], pick.pack - 1, pick.pick - 1)
        if (token !== this.draftToken) return // a newer draft started mid-backfill
        if (result) {
          const rec = result.cards.find(c => c.rank === 1) ?? null
          const taken = result.cards.find(c => c.grpId === record.grpId) ?? null
          filled.set(key, {
            ...record,
            recommendedGrpId: rec?.grpId ?? null,
            recommendedName: rec ? (this.card(rec.grpId)?.name ?? null) : null,
            takenRank: taken?.rank ?? null,
            ev: taken?.ev ?? null
          })
        }
      }
      pool.push(...pick.grpIds)
    }
    if (filled.size === 0) return
    this.state = {
      ...this.state,
      picks: this.state.picks.map(p => filled.get(`${p.pack}-${p.pick}`) ?? p),
      seq: this.state.seq + 1
    }
    this.publish()
  }

  /** Model (re)loaded: refresh model info and re-grade the pool rows (built before load). */
  private refreshModelInfo(): void {
    if (!this.snapshot) return
    this.state = { ...this.state, model: this.modelInfo(this.snapshot), pool: this.rows(this.snapshot.pool), seq: this.state.seq + 1 }
    this.publish()
  }

  private modelInfo(snap: DraftSessionSnapshot): DraftState['model'] {
    const s = this.models.status(snap.set, snap.format)
    return { state: s.state, modelId: s.modelId, message: s.message }
  }

  private card(grpId: number): CardInfo | undefined { return this.bundle?.cards.get(grpId) }

  private rows(grpIds: number[]): CardRow[] {
    return grpIds.map(grpId => {
      const c = this.card(grpId)
      const intrinsic = this.models.intrinsic(grpId)
      return {
        grpId,
        name: c?.name ?? `Card #${grpId}`,
        rarity: c?.rarity ?? 'common',
        colors: c?.colors ?? '',
        colorIdentity: c?.colorIdentity ?? '',
        manaCost: c?.manaCost ?? '',
        manaValue: c?.manaValue ?? null,
        type: c?.type ?? '',
        imageUrl: null,
        ev: null, prob: null, rank: null,
        percentile: intrinsic?.percentile ?? null,
        grade: intrinsic?.grade ?? null,
        setPercentile: intrinsic?.percentile ?? null,
        setGrade: intrinsic?.grade ?? null
      }
    })
  }

  private clearEndTimer(): void {
    if (this.endTimer) { clearTimeout(this.endTimer); this.endTimer = null }
  }

  private publish(): void {
    this.emit('state', this.state)
  }
}

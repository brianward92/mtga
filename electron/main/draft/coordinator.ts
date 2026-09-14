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
import type { DraftSessionSnapshot, DraftPickRecord, SubmittedDeck } from '../parser/draft-session'
import { ModelManager, type ScoredCard } from '../model/manager'
import { type SetBundle, type CardInfo } from '../data/bundle'
import { resolveFromArenaDb } from '../data/arena-card-db'
import { DraftHistory, type RecordedDraft } from '../data/history'
import { EMPTY_STATE, type CardRow, type DraftState, type PickRecord } from '../../shared/state'
import { COMPLETE_LINGER_MS, RESTORE_MAX_AGE_MS } from './completion'

/** Converts parser snapshots into renderer-ready draft state and history. */
export class DraftCoordinator extends EventEmitter {
  private state: DraftState = { ...EMPTY_STATE }
  private snapshot: DraftSessionSnapshot | null = null
  private bundle: SetBundle | null = null
  private scoreToken = 0
  lastSubmittedDeck: SubmittedDeck | null = null
  private lastScores: { pack: number; pick: number; cards: ScoredCard[]; modelId: string } | null = null
  private endTimer: NodeJS.Timeout | null = null
  private replaying = false
  /** Bumped whenever the draft changes; in-flight backfills check it and abort. */
  private draftToken = 0
  /** Cards taken per pick — more than one in a Pick-Two event. */
  private cardsPerPick = 1

  constructor(private models: ModelManager, private history: DraftHistory) {
    super()
  }

  /** Current snapshot for late-attaching renderers. */
  get current(): DraftState { return this.state }

  /** During log replay nothing is scored/persisted; state is rebuilt silently. */
  setReplaying(on: boolean): void { this.replaying = on }

  // ---- parser events ------------------------------------------------------

  /** Fill in set/format when the replayed log lacked the EventJoin line. */
  private fill(snap: DraftSessionSnapshot): DraftSessionSnapshot {
    if (snap.set) return snap
    const ids = snap.currentPack?.grpIds ?? snap.pool
    const set = this.models.setForGrpIds(ids)
    if (!set) return snap
    const filled = { ...snap, set, format: snap.format ?? (snap.isBotDraft ? 'QuickDraft' : 'PremierDraft') }
    // Draft start may already have run without a set: adopt the bundle now.
    if (!this.bundle && this.state.phase === 'active') {
      this.bundle = this.models.bundleFor(set)
      const ppp = this.bundle?.picksPerPack ?? 14
      this.state = { ...this.state, set, format: filled.format, picksPerPack: ppp, totalPicks: 3 * ppp,
        snapshot: { scryfall: this.bundle?.scryfallUpdatedAt ?? null, model: this.models.modelTag } }
      if (!this.replaying) void this.models.ensure(set, filled.format!).then(() => this.refreshModelInfo())
    }
    return filled
  }

  onDraftStart(snap: DraftSessionSnapshot): void {
    snap = this.fill(snap)
    this.clearEndTimer()
    this.draftToken++
    this.snapshot = snap
    this.bundle = snap.set ? this.models.bundleFor(snap.set) : null
    this.lastScores = null
    // Per draft, not per session: one Pick-Two event otherwise pinned every
    // later draft to the bundle's guess for picks per pack.
    this.cardsPerPick = 1
    const ppp = this.bundle?.picksPerPack ?? 14
    this.state = {
      ...EMPTY_STATE,
      phase: 'active',
      arenaScene: this.state.arenaScene,
      set: snap.set, format: snap.format, eventName: snap.eventName, isBotDraft: snap.isBotDraft,
      picksPerPack: ppp, totalPicks: 3 * ppp,
      pool: this.rows(snap.pool),
      picks: [],
      model: this.modelInfo(snap),
      snapshot: { scryfall: this.bundle?.scryfallUpdatedAt ?? null, model: this.models.modelTag },
      seq: this.state.seq + 1
    }
    this.history.append({ at: new Date().toISOString(), type: 'draft-start', draftId: snap.draftId, eventName: snap.eventName, set: snap.set, format: snap.format })
    this.publish()
    if (!this.replaying && snap.set && snap.format) void this.models.ensure(snap.set, snap.format).then(() => this.refreshModelInfo())
  }

  onDraftPack(snap: DraftSessionSnapshot): void {
    snap = this.fill(snap)
    if (this.state.phase !== 'active' || !this.snapshot) this.onDraftStart(snap)
    this.snapshot = snap
    const cur = snap.currentPack
    if (!cur) return
    // Learn the pack size from the pack Arena actually dealt, rather than
    // trusting the shipped constant.
    //
    // The bundle's picks_per_pack is a build-time guess that defaults to 14,
    // and it was wrong for LCI, which deals 15. Nothing detected that: the HUD
    // simply drew 14 dots for a 15-card pack, and the progress read x/42 for a
    // 45-pick draft all the way to the end. The pack on screen is the truth and
    // is available on the very first pick, so use it and let the constant be a
    // fallback for the moment before a pack arrives.
    // At pick 1 the pack is complete, so its size IS the answer and replaces
    // the guess in both directions. Later picks only ever raise it: cards
    // already taken are gone, so the count is a lower bound, not a measurement.
    //
    // Only when one card is taken per pick. In a Pick-Two event a 14-card pack
    // yields 7 picks, so pack size is not picks per pack, and adopting it would
    // reproduce the exact defect this replaced — a HUD counting to 42 for a
    // 21-pick draft. Until a pick proves otherwise the bundle's value stands.
    const size = cur.grpIds.length + (cur.pick - 1) * this.cardsPerPick
    const ppp = size > 0 && this.cardsPerPick === 1
      ? (cur.pick === 1 ? size : Math.max(this.state.picksPerPack, size))
      : this.state.picksPerPack
    this.state = {
      ...this.state,
      picksPerPack: ppp, totalPicks: 3 * ppp,
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
    snap = this.fill(snap)
    this.snapshot = snap
    if (pick.grpIds.length > 0) this.cardsPerPick = pick.grpIds.length
    const takenGrp = pick.grpIds[0]
    const scores = this.lastScores && this.lastScores.pack === pick.pack && this.lastScores.pick === pick.pick ? this.lastScores : null
    // Rank alone is not enough: an unscored pack still ranks its cards, in log
    // order, so a pack the model could not score would otherwise record its
    // first card as "what the model wanted" and pollute the agreement stats.
    const rec = scores?.cards.find(c => c.rank === 1 && c.ev !== null) ?? null
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
    // Recorded during replay too. Arena keeps one backup log, so a draft's
    // picks survive exactly one restart of the game; this file is where they
    // live afterwards. Duplicates are rejected by identity in DraftHistory.
    this.history.append({ at: new Date().toISOString(), type: 'pick', draftId: snap.draftId, eventName: snap.eventName, set: snap.set, format: snap.format, ...record, modelId: scores?.modelId ?? null })
  }

  /**
   * Arena changed screens. A draft stays active while the drafter goes to Home
   * or the store, so this is what tells the overlay to get out of the way — and
   * to come back the moment the draft screen returns.
   */
  onScene(scene: string): void {
    if (this.state.arenaScene === scene) return
    this.state = { ...this.state, arenaScene: scene, seq: this.state.seq + 1 }
    if (!this.replaying) this.publish()
  }

  /** Arena submitted the Limited deck: record it, and expose it for verification. */
  onDeckSubmitted(deck: SubmittedDeck): void {
    this.lastSubmittedDeck = deck
    const submitSnap = this.snapshot
    this.history.append({ at: new Date().toISOString(), type: 'deck-submit', draftId: submitSnap?.draftId ?? null, eventName: deck.eventName ?? submitSnap?.eventName ?? null, set: submitSnap?.set ?? null, format: submitSnap?.format ?? null,
      mainCount: deck.mainCount, main: deck.main, sideboard: deck.sideboard })
    this.state = { ...this.state, submittedDeck: { main: deck.main, sideboard: deck.sideboard, mainCount: deck.mainCount }, seq: this.state.seq + 1 }
    this.publish()
  }

  onDraftEnd(snap: DraftSessionSnapshot): void {
    snap = this.fill(snap)
    this.snapshot = snap
    this.state = { ...this.state, phase: 'complete', cards: [], scoring: false, pool: this.rows(snap.pool), seq: this.state.seq + 1 }
    this.publish()
    const at = new Date().toISOString()
    this.history.append({ at, type: 'draft-end', draftId: snap.draftId, eventName: snap.eventName, set: snap.set, format: snap.format, picks: this.state.picks.length })
    // The finished pool, recorded separately. Arena's servers re-send it only
    // while the deck is unsubmitted, so once Done is pressed this is the last
    // copy that exists anywhere.
    if (snap.pool.length > 0) {
      this.history.append({ at, type: 'draft-pool', draftId: snap.draftId, eventName: snap.eventName, set: snap.set, format: snap.format, pool: snap.pool })
    }
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
    // Nothing in the logs, and nothing from Arena's servers. Fall back to what
    // we recorded ourselves.
    if (!snap) { this.restoreFromHistory(); return }
    // Load the model for any draft we replayed into, not just a live one. A
    // completed draft still needs it: the pool carries the grades the deckbuild
    // advisor ranks by, so restarting the app during deckbuilding used to leave
    // every card ungraded and the model stuck reporting "loading" forever.
    if (snap.set && snap.format) void this.models.ensure(snap.set, snap.format).then(() => this.refreshModelInfo())
    if (snap.state !== 'active') return
    if (snap.currentPack) {
      this.state = { ...this.state, scoring: true, seq: this.state.seq + 1 }
      this.publish()
      void this.score(snap)
    }
    void this.backfillPicks(snap)
  }

  /**
   * Rebuild the last recorded draft from our own history file.
   *
   * The last line of defence, and the only one that still works once every
   * other source is gone: Arena recreates Player.log on launch keeping one
   * backup, and its servers stop serving a finished pool once the deck is
   * submitted. Restored state is marked complete and carries no live pack,
   * because there is nothing left to pick — it exists so the deckbuild advisor
   * still has a pool to work from.
   */
  private restoreFromHistory(): void {
    if (this.state.phase !== 'idle') return
    let draft: RecordedDraft | null = null
    try { draft = this.history.lastDraft() } catch { return }
    if (!draft || !draft.set) return
    // Only a recent draft. Without a bound, opening the app months after the
    // last draft resurrected it: a stale pool published as "complete" with a
    // deckbuild advisor confidently building it, for half an hour.
    const age = Date.now() - Date.parse(draft.at)
    if (!Number.isFinite(age) || age > RESTORE_MAX_AGE_MS) return

    this.bundle = this.models.bundleFor(draft.set)
    const ppp = this.bundle?.picksPerPack ?? 14
    this.state = {
      ...EMPTY_STATE,
      phase: 'complete',
      arenaScene: this.state.arenaScene,
      set: draft.set, format: draft.format, eventName: draft.eventName,
      isBotDraft: draft.format === 'QuickDraft',
      picksPerPack: ppp, totalPicks: 3 * ppp,
      pool: this.rows(draft.pool),
      picks: draft.picks.map(p => ({ pack: p.pack, pick: p.pick, grpId: p.grpId, name: p.name ?? this.card(p.grpId)?.name ?? `#${p.grpId}`,
        recommendedGrpId: null, recommendedName: null, takenRank: null, ev: null })),
      restoredFromHistory: true,
      snapshot: { scryfall: this.bundle?.scryfallUpdatedAt ?? null, model: this.models.modelTag },
      seq: this.state.seq + 1
    }
    this.publish()
    if (draft.format) void this.models.ensure(draft.set, draft.format).then(() => this.refreshModelInfo())
    this.clearEndTimer()
    this.endTimer = setTimeout(() => { this.endTimer = null; this.idle() }, COMPLETE_LINGER_MS)
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
    const result = await this.models.score(snap.set, format, cur.grpIds, snap.pool, cur.pack - 1, cur.pick - 1, this.state.picksPerPack)
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
  /**
   * Re-read the model's status and re-grade the pool.
   *
   * A draft restored from history has no parser snapshot, so this used to
   * return early for it: the model stayed on "loading" forever, the pool rows
   * never got their grades, and the deckbuild advisor silently fell back to
   * heuristics — it cut the best card in the pool. Take the set, format and
   * pool from whichever source the draft actually came from.
   */
  private refreshModelInfo(): void {
    const snap = this.snapshot
    const set = snap?.set ?? this.state.set
    const format = snap?.format ?? this.state.format
    if (!set && !format && !snap) return
    const pool = snap ? snap.pool : this.state.pool.map(r => r.grpId)
    const status = this.models.status(set, format)
    this.state = { ...this.state, model: { state: status.state, modelId: status.modelId, message: status.message }, pool: this.rows(pool), seq: this.state.seq + 1 }
    this.publish()
  }

  private modelInfo(snap: DraftSessionSnapshot): DraftState['model'] {
    const s = this.models.status(snap.set, snap.format)
    return { state: s.state, modelId: s.modelId, message: s.message }
  }

  private card(grpId: number): CardInfo | undefined {
    const known = this.bundle?.cards.get(grpId)
    if (known) return known
    // Day zero: the client knows a set our bundle predates. Ask Arena's own
    // database before giving up, so a brand-new set is drafted with real card
    // names and Arena's ordering rather than refused as unidentifiable.
    const live = resolveFromArenaDb(grpId)
    if (!live) return undefined
    return {
      grpId,
      name: live.name,
      rarity: live.rarity,
      colors: live.colors,
      colorIdentity: live.colorIdentity,
      // Arena stores mana as its own "o2oUoU" text and has no Scryfall id;
      // those stay empty until the set is bundled properly.
      manaCost: '',
      manaValue: null,
      type: live.type,
      scryfallId: '',
      order: live.order ?? undefined
    }
  }

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
        scryfallId: c?.scryfallId ?? '',
        oracleText: c?.oracleText ?? '',
        hasBackFace: c?.hasBackFace === true,
        faces: c?.faces ?? [],
        order: c?.order,
        unresolved: c ? undefined : true,
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

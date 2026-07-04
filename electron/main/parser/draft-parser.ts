/**
 * Draft event parser for MTGA Player.log lines.
 *
 * Self-contained state machine fed raw log lines (it needs the message name
 * that precedes the JSON, which the generic JSON extractor throws away).
 *
 * Log format quirks handled here (verified against 2026 clients):
 * - The April 2025 client removed underscores from request names
 *   (Event_PlayerDraftMakePick -> EventPlayerDraftMakePick, etc.); every key
 *   is matched both with and without underscores.
 * - Human events (Draft.Notify, EventPlayerDraftMakePick) are 1-indexed;
 *   bot-draft events (BotDraftDraftStatus/BotDraftDraftPick) are 0-indexed.
 * - Draft.Notify PackCards is a comma-separated STRING of ids; bot DraftPack
 *   and CardIds are STRING arrays; everything is normalized to number[].
 * - Human P1P1 never generates a Draft.Notify; the pack contents arrive
 *   retroactively at pick time via a LogBusinessEvents request (CardsInPack).
 * - Requests wrap their JSON in a string-escaped "request" field, sometimes
 *   with a further string-escaped "Payload" inside; deepFindObjectWithKey
 *   parses through nested string JSON.
 *
 * All transitions are idempotent keyed on (pack, pick), so replaying the same
 * log (startup scan, size-shrink reopen) converges to the same state.
 */

import { EventEmitter } from 'events'
import { parseDraftEventName } from '../utils/format-utils'

export interface DraftPickRecord {
  pack: number
  pick: number
  grpIds: number[]
  packGrpIds: number[]
}

export interface DraftSessionSnapshot {
  draftId: string | null
  eventName: string | null
  set: string | null
  format: string | null
  state: 'active' | 'complete'
  isBotDraft: boolean
  currentPack: { pack: number; pick: number; grpIds: number[] } | null
  picks: DraftPickRecord[]
  pool: number[]
}

export interface DraftParserEvents {
  'draft-start': (snapshot: DraftSessionSnapshot) => void
  'draft-pack': (snapshot: DraftSessionSnapshot) => void
  'draft-pick': (snapshot: DraftSessionSnapshot, pick: DraftPickRecord) => void
  'draft-end': (snapshot: DraftSessionSnapshot) => void
  'detailed-logs': (data: { enabled: boolean }) => void
}

// Keys are stored with underscores; hasKey matches both spellings.
const KEY_MAKE_PICK = 'Event_PlayerDraftMakePick'
const KEY_BOT_PICK = 'BotDraft_DraftPick'
const KEY_COMPLETE = 'Draft_CompleteDraft'
const KEY_EVENT_JOIN = 'Event_Join'

/** Match a log key both with and without underscores (April 2025 client change). */
function hasKey(line: string, key: string): boolean {
  return line.includes(key) || line.includes(key.replace(/_/g, ''))
}

function tryParseJson(text: string): unknown | null {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** Parse the JSON object embedded in a log line (starts at the first '{'). */
function parseJsonFromLine(line: string): Record<string, unknown> | null {
  const start = line.indexOf('{')
  if (start === -1) return null
  const parsed = tryParseJson(line.slice(start))
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>
  }
  return null
}

/**
 * Search a parsed JSON value (recursing through objects, arrays, and
 * string-escaped JSON like "request"/"Payload") for the first object that
 * contains the given key.
 */
function deepFindObjectWithKey(
  value: unknown,
  key: string,
  depth = 0
): Record<string, unknown> | null {
  if (depth > 6 || value === null || value === undefined) return null

  if (typeof value === 'string') {
    if (!value.includes(key)) return null
    return deepFindObjectWithKey(tryParseJson(value), key, depth + 1)
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = deepFindObjectWithKey(item, key, depth + 1)
      if (found) return found
    }
    return null
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    if (key in obj) return obj
    for (const child of Object.values(obj)) {
      const found = deepFindObjectWithKey(child, key, depth + 1)
      if (found) return found
    }
  }

  return null
}

function deepFindValue(value: unknown, key: string): unknown {
  const obj = deepFindObjectWithKey(value, key)
  return obj ? obj[key] : undefined
}

/** Normalize card ids that may be numbers, numeric strings, or comma-strings. */
function toGrpIds(value: unknown): number[] {
  if (value === null || value === undefined) return []
  if (typeof value === 'string') {
    return value
      .split(',')
      .map(s => parseInt(s.trim(), 10))
      .filter(n => Number.isFinite(n))
  }
  if (Array.isArray(value)) {
    return value
      .map(v => (typeof v === 'string' ? parseInt(v, 10) : Number(v)))
      .filter(n => Number.isFinite(n))
  }
  const n = Number(value)
  return Number.isFinite(n) ? [n] : []
}

function pickKey(pack: number, pick: number): string {
  return `${pack}-${pick}`
}

/** Internal mutable draft session state. */
class DraftSession {
  draftId: string | null = null
  eventName: string | null = null
  set: string | null = null
  format: string | null = null
  state: 'active' | 'complete' = 'active'
  isBotDraft = false
  currentPack: { pack: number; pick: number; grpIds: number[] } | null = null
  /** (pack,pick) -> pack contents as seen */
  packs = new Map<string, number[]>()
  /** (pack,pick) -> picked grpIds */
  picks = new Map<string, number[]>()
  /** Authoritative pool (bot PickedCards / completion CardPool) when present */
  poolOverride: number[] | null = null

  applyEventName(eventName: string): void {
    this.eventName = eventName
    const parsed = parseDraftEventName(eventName)
    if (parsed) {
      this.set = parsed.set
      this.format = parsed.format
      if (parsed.format === 'QuickDraft') this.isBotDraft = true
    }
  }

  /** Record pack contents; returns true if anything changed. */
  recordPackContents(pack: number, pick: number, grpIds: number[]): boolean {
    const key = pickKey(pack, pick)
    const existing = this.packs.get(key)
    if (existing && existing.length === grpIds.length && existing.every((v, i) => v === grpIds[i])) {
      return false
    }
    this.packs.set(key, grpIds)
    return true
  }

  /** Record a pick; idempotent on (pack, pick). Returns true if new/changed. */
  recordPick(pack: number, pick: number, grpIds: number[]): boolean {
    const key = pickKey(pack, pick)
    const existing = this.picks.get(key)
    if (existing && existing.length === grpIds.length && existing.every((v, i) => v === grpIds[i])) {
      return false
    }
    this.picks.set(key, grpIds)
    return true
  }

  private sortedPickEntries(): Array<{ pack: number; pick: number; grpIds: number[] }> {
    return Array.from(this.picks.entries())
      .map(([key, grpIds]) => {
        const [pack, pick] = key.split('-').map(Number)
        return { pack, pick, grpIds }
      })
      .sort((a, b) => a.pack - b.pack || a.pick - b.pick)
  }

  pool(): number[] {
    if (this.poolOverride) return [...this.poolOverride]
    const pool: number[] = []
    for (const entry of this.sortedPickEntries()) {
      pool.push(...entry.grpIds)
    }
    return pool
  }

  snapshot(): DraftSessionSnapshot {
    return {
      draftId: this.draftId,
      eventName: this.eventName,
      set: this.set,
      format: this.format,
      state: this.state,
      isBotDraft: this.isBotDraft,
      currentPack: this.currentPack
        ? { pack: this.currentPack.pack, pick: this.currentPack.pick, grpIds: [...this.currentPack.grpIds] }
        : null,
      picks: this.sortedPickEntries().map(entry => ({
        pack: entry.pack,
        pick: entry.pick,
        grpIds: [...entry.grpIds],
        packGrpIds: [...(this.packs.get(pickKey(entry.pack, entry.pick)) ?? [])]
      })),
      pool: this.pool()
    }
  }
}

export class DraftParser extends EventEmitter {
  private session: DraftSession | null = null
  /** EventName from the last draft Event_Join — human packs carry no name. */
  private pendingEventName: string | null = null

  getSnapshot(): DraftSessionSnapshot | null {
    return this.session?.snapshot() ?? null
  }

  reset(): void {
    this.session = null
    this.pendingEventName = null
  }

  handleLine(line: string): void {
    if (!line) return

    // Player.log announces the Detailed Logs toggle state in its first lines.
    if (line.includes('DETAILED LOGS: DISABLED')) {
      this.emit('detailed-logs', { enabled: false })
      return
    }
    if (line.includes('DETAILED LOGS: ENABLED')) {
      this.emit('detailed-logs', { enabled: true })
      return
    }

    try {
      // Human pack pushed to the client (P1P2+, P2P1, P3P1 — never P1P1)
      if (line.includes('Draft.Notify') && line.includes('PackCards')) {
        this.handleDraftNotify(line)
        return
      }

      if (line.includes('==>')) {
        if (hasKey(line, KEY_MAKE_PICK)) {
          this.handleHumanPick(line)
          return
        }
        if (hasKey(line, KEY_BOT_PICK) && line.includes('PickInfo')) {
          this.handleBotPick(line)
          return
        }
        if (line.includes('LogBusinessEvents') && line.includes('CardsInPack')) {
          this.handleBusinessEvent(line)
          return
        }
        if (hasKey(line, KEY_EVENT_JOIN)) {
          this.handleEventJoin(line)
          return
        }
      }

      // Human draft completion (request and/or response carrying CardPool)
      if (hasKey(line, KEY_COMPLETE)) {
        this.handleHumanComplete(line)
        return
      }

      // Bot draft status payloads (PickNext / Completed), string-escaped JSON
      if (line.includes('DraftStatus')) {
        this.handleBotStatus(line)
      }
    } catch (error) {
      // Log lines are untrusted input; never let a malformed one throw.
      console.error('[DraftParser] Failed to handle line:', error)
    }
  }

  // ==========================================================================
  // Session management
  // ==========================================================================

  private startSession(opts: {
    draftId?: string | null
    eventName?: string | null
    isBot?: boolean
  }): DraftSession {
    const session = new DraftSession()
    session.isBotDraft = opts.isBot ?? false
    if (opts.draftId) session.draftId = opts.draftId

    const eventName = opts.eventName ?? (opts.isBot ? null : this.pendingEventName)
    if (eventName) session.applyEventName(eventName)

    this.session = session
    this.emit('draft-start', session.snapshot())
    return session
  }

  /**
   * Find-or-create the session an event belongs to.
   * reviveIfComplete: pack/pick events replayed after completion recreate the
   * session (full-log replay converges); completion/join events must not.
   */
  private ensureSession(opts: {
    draftId?: string | null
    eventName?: string | null
    isBot?: boolean
    reviveIfComplete?: boolean
  }): DraftSession {
    const { draftId, eventName, reviveIfComplete = true } = opts
    const s = this.session

    if (s) {
      const idConflict = !!(draftId && s.draftId && draftId !== s.draftId)
      const nameConflict = !!(eventName && s.eventName && eventName !== s.eventName)
      const completedReplay = s.state === 'complete' && reviveIfComplete

      if (!idConflict && !nameConflict && !completedReplay) {
        if (draftId && !s.draftId) s.draftId = draftId
        if (eventName && !s.eventName) s.applyEventName(eventName)
        return s
      }
    }

    return this.startSession(opts)
  }

  private completeSession(session: DraftSession, finalPool: number[] | null): void {
    const poolBefore = JSON.stringify(session.pool())
    if (finalPool && finalPool.length > 0) {
      session.poolOverride = finalPool
    }
    const changedPool = JSON.stringify(session.pool()) !== poolBefore

    if (session.state !== 'complete') {
      session.state = 'complete'
      session.currentPack = null
      this.emit('draft-end', session.snapshot())
    } else if (changedPool) {
      // e.g. completion request marked the end, response later carried CardPool
      this.emit('draft-end', session.snapshot())
    }
  }

  // ==========================================================================
  // Handlers
  // ==========================================================================

  /**
   * [UnityCrossThreadLogger]Draft.Notify {"draftId":"...","SelfPick":2,"SelfPack":1,"PackCards":"90210,90355,..."}
   * SelfPack/SelfPick are 1-indexed; PackCards is a comma-separated string.
   */
  private handleDraftNotify(line: string): void {
    const json = parseJsonFromLine(line)
    if (!json) return

    const draftId = (json.draftId as string) || (json.DraftId as string) || null
    const pack = Number(json.SelfPack)
    const pick = Number(json.SelfPick)
    const grpIds = toGrpIds(json.PackCards)
    if (!Number.isFinite(pack) || !Number.isFinite(pick) || grpIds.length === 0) return

    const session = this.ensureSession({ draftId, isBot: false })
    session.recordPackContents(pack, pick, grpIds)
    session.currentPack = { pack, pick, grpIds }
    this.emit('draft-pack', session.snapshot())
  }

  /**
   * ==> EventPlayerDraftMakePick {"id":"...","request":"{\"DraftId\":\"...\",\"GrpIds\":[90210],\"Pack\":1,\"Pick\":2}"}
   * GrpIds is an array (>1 entry in Pick-Two drafts); Pack/Pick are 1-indexed.
   */
  private handleHumanPick(line: string): void {
    const outer = parseJsonFromLine(line)
    if (!outer) return
    const req = typeof outer.request === 'string' ? tryParseJson(outer.request) : outer.request
    const body = deepFindObjectWithKey(req ?? outer, 'GrpIds')
    if (!body) return

    const draftId = (body.DraftId as string) || null
    const pack = Number(body.Pack)
    const pick = Number(body.Pick)
    const grpIds = toGrpIds(body.GrpIds)
    if (!Number.isFinite(pack) || !Number.isFinite(pick) || grpIds.length === 0) return

    const session = this.ensureSession({ draftId, isBot: false })
    const changed = session.recordPick(pack, pick, grpIds)
    if (changed) {
      const record = session.snapshot().picks.find(p => p.pack === pack && p.pick === pick)!
      this.emit('draft-pick', session.snapshot(), record)
    }
  }

  /**
   * ==> LogBusinessEvents whose (possibly double-escaped) payload contains
   * CardsInPack/PickGrpId. Fires at pick time — this is the ONLY way to learn
   * the human P1P1 pack contents. Used for backfill, never for live display,
   * so it does not touch currentPack.
   */
  private handleBusinessEvent(line: string): void {
    const outer = parseJsonFromLine(line)
    if (!outer) return
    const payload = deepFindObjectWithKey(outer, 'CardsInPack')
    if (!payload) return

    let pack = Number(payload.PackNumber)
    let pick = Number(payload.PickNumber)
    if (!Number.isFinite(pack) || !Number.isFinite(pick)) return
    // Human events are 1-indexed, but guard against 0-indexed variants: a 0
    // can only mean 0-indexing (pack/pick 0 does not exist 1-indexed).
    if (pack === 0 || pick === 0) {
      pack += 1
      pick += 1
    }

    const cardsInPack = toGrpIds(payload.CardsInPack)
    const picked = toGrpIds(payload.PickGrpId)
    const draftId = (payload.DraftId as string) || null
    const eventName = (payload.EventId as string) || null

    const session = this.ensureSession({ draftId, eventName, isBot: false })
    let changed = false
    if (cardsInPack.length > 0) {
      changed = session.recordPackContents(pack, pick, cardsInPack) || changed
    }
    if (picked.length > 0) {
      changed = session.recordPick(pack, pick, picked) || changed
    }
    if (changed && picked.length > 0) {
      const record = session.snapshot().picks.find(p => p.pack === pack && p.pick === pick)!
      this.emit('draft-pick', session.snapshot(), record)
    }
  }

  /**
   * Bot-draft status payloads: {"CurrentModule":"BotDraft","Payload":"{\"DraftStatus\":\"PickNext\",...}"}
   * Payload is string-escaped JSON; PackNumber/PickNumber are 0-indexed;
   * DraftPack/PickedCards are STRING id arrays. PickedCards is the
   * authoritative pool resync.
   */
  private handleBotStatus(line: string): void {
    const json = parseJsonFromLine(line)
    if (!json) return
    const payload = deepFindObjectWithKey(json, 'DraftStatus')
    if (!payload) return

    const status = payload.DraftStatus
    const eventName = (payload.EventName as string) || null
    const picked = 'PickedCards' in payload ? toGrpIds(payload.PickedCards) : null

    if (status === 'PickNext') {
      const pack = Number(payload.PackNumber) + 1
      const pick = Number(payload.PickNumber) + 1
      const grpIds = toGrpIds(payload.DraftPack)
      if (!Number.isFinite(pack) || !Number.isFinite(pick)) return

      const session = this.ensureSession({ eventName, isBot: true })
      if (picked !== null) session.poolOverride = picked
      session.recordPackContents(pack, pick, grpIds)
      session.currentPack = { pack, pick, grpIds }
      this.emit('draft-pack', session.snapshot())
    } else if (status === 'Completed') {
      const session = this.ensureSession({ eventName, isBot: true, reviveIfComplete: false })
      this.completeSession(session, picked)
    }
  }

  /**
   * ==> BotDraftDraftPick {"id":"...","request":"{...,\"PickInfo\":{\"CardIds\":[\"98546\"],\"PackNumber\":0,\"PickNumber\":0}}"}
   * CardIds is a string array (legacy logs: single int CardId); 0-indexed.
   */
  private handleBotPick(line: string): void {
    const outer = parseJsonFromLine(line)
    if (!outer) return
    const pickInfo = deepFindObjectWithKey(outer, 'CardIds') ?? deepFindObjectWithKey(outer, 'CardId')
    if (!pickInfo) return

    const pack = Number(pickInfo.PackNumber) + 1
    const pick = Number(pickInfo.PickNumber) + 1
    const grpIds = 'CardIds' in pickInfo ? toGrpIds(pickInfo.CardIds) : toGrpIds(pickInfo.CardId)
    if (!Number.isFinite(pack) || !Number.isFinite(pick) || grpIds.length === 0) return

    const eventName =
      (pickInfo.EventName as string) || (deepFindValue(outer, 'EventName') as string) || null

    const session = this.ensureSession({ eventName, isBot: true })
    const changed = session.recordPick(pack, pick, grpIds)
    if (changed) {
      const record = session.snapshot().picks.find(p => p.pack === pack && p.pick === pick)!
      this.emit('draft-pick', session.snapshot(), record)
    }
  }

  /**
   * DraftCompleteDraft request/response. The response carries the final
   * CardPool (int array); the request only signals completion.
   */
  private handleHumanComplete(line: string): void {
    const json = parseJsonFromLine(line)
    const cardPool = json ? toGrpIds(deepFindValue(json, 'CardPool')) : []
    const draftId = json ? ((deepFindValue(json, 'DraftId') as string) || null) : null
    const eventName = json ? ((deepFindValue(json, 'InternalEventName') as string) || null) : null

    let session = this.session
    if (!session) {
      // Replay joined mid-stream: only worth creating a session if we have a pool.
      if (cardPool.length === 0) return
      session = this.ensureSession({ draftId, eventName, isBot: false, reviveIfComplete: false })
    } else {
      if (draftId && session.draftId && draftId !== session.draftId && cardPool.length === 0) return
      if (eventName && !session.eventName) session.applyEventName(eventName)
      if (draftId && !session.draftId) session.draftId = draftId
    }

    this.completeSession(session, cardPool.length > 0 ? cardPool : null)
  }

  /**
   * ==> EventJoin {"id":"...","request":"{\"EventName\":\"PremierDraft_SOS_20260421\"}"}
   * Learns the pod (set + format) for human drafts, whose pack events carry
   * no event name. Never revives a completed session (Event_Join re-fires
   * during the post-draft deck-build/match phases).
   */
  private handleEventJoin(line: string): void {
    const outer = parseJsonFromLine(line)
    if (!outer) return
    const eventName = deepFindValue(outer, 'EventName') as string | undefined
    if (!eventName) return

    const parsed = parseDraftEventName(eventName)
    if (!parsed) return

    this.pendingEventName = eventName

    const s = this.session
    if (s && s.eventName === eventName) return // same event (any state): no-op

    this.ensureSession({
      eventName,
      isBot: parsed.format === 'QuickDraft',
      reviveIfComplete: false
    })
  }
}

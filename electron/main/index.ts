/**
 * MTGA Tracker - Main Process Entry Point
 *
 * This is the Electron main process that coordinates:
 * - Log file watching and parsing
 * - Database operations for match history
 * - Window management (overlay and dashboard)
 * - IPC communication with renderer processes
 */

import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { LogWatcher } from './parser/watcher'
import { LogParser } from './parser/index'
import { DraftSessionSnapshot, DraftPickRecord } from './parser/draft-parser'
import {
  createOverlayWindow,
  setOverlayMode,
  showOverlay,
  hideOverlay,
  moveOverlay,
  resizeOverlay,
  saveOverlayBounds,
  applyDraftDensity,
  getOverlayUiPrefs,
  setOverlayUiPrefs,
  unregisterOverlayShortcuts,
  DraftDensity
} from './windows/overlay'
import { createRegistryWindow } from './windows/registry'
import { installApplicationMenu } from './windows/menu'
import {
  initDatabase,
  closeDatabase,
  insertMatch,
  updateMatchEnd,
  updateMatchDeckName,
  updateMatchNotes,
  getRecentMatches,
  getMatchStats,
  getPlayDrawStats,
  getStatsByFormat,
  getOpponentStats,
  updateCollection,
  getCollection,
  getCollectionStats,
  recordInventorySnapshot,
  upsertDraft,
  completeDraft,
  recordDraftPick,
  findDraft,
  migrateDraftId
} from './data/database'
import {
  loadCardRegistry,
  getCard,
  getCardName,
  getSetList,
  getCardsBySet,
  mergeServerCards
} from './data/card-registry'
import { formatEventId } from './utils/format-utils'
import { loadConfig } from './config'
import { ServerClient, ServerCardRow, ModelInfo, ServerStatus } from './api/server-client'

// Window references
let overlayWindow: BrowserWindow | null = null
let registryWindow: BrowserWindow | null = null

// Core services
let logWatcher: LogWatcher | null = null
let logParser: LogParser | null = null
let serverClient: ServerClient | null = null

// Current match state
let currentMatchId: string | null = null
let currentDeckName: string | null = null

// Track last game state for win condition derivation
let lastTurnNumber = 0
let lastOpponentLife = 20
let lastPlayerLife = 20

// ============================================================================
// Draft state (main-process cache of what the overlay renders)
// ============================================================================

/** One row of the pack table sent to the renderer. */
interface DraftCardRow {
  grpId: number
  name: string | null
  manaCost: string
  type: string
  rarity: string | null
  colors: string
  manaValue: number | null
  gihWr: number | null
  alsa: number | null
  evP1p1: number | null
  ev: number | null
  /** Model pick probability within this pack (0..1) — drives the flame rating. */
  prob: number | null
  /** ev_p1p1 percentile within the set (0..100), tier-list rows only. */
  tierPct: number | null
  rank: number | null
  imageUrl: string | null
}

interface DraftPackPayload {
  pack: number
  pick: number
  isTierList: boolean
  note: string | null
  cards: DraftCardRow[]
}

interface DraftScoresPayload {
  pack: number
  pick: number
  model: ModelInfo | null
  cards: DraftCardRow[]
}

interface ServerStatusPayload {
  status: ServerStatus
  model: ModelInfo | null
  stale: boolean
  fetchedAt: string | null
}

// True while the startup scan (Player-prev.log + Player.log from byte 0)
// replays historical lines: DB writes stay on (idempotent), but window
// side effects and renderer IPC are suppressed until replay-complete.
let isReplaying = false
let detailedLogsEnabled: boolean | null = null

const draftRuntime = {
  session: null as DraftSessionSnapshot | null,
  /** DB id for the current session (resolved once at draft-start) */
  dbId: null as string | null,
  ratings: null as Map<number, ServerCardRow> | null,
  ratingsMeta: null as { set: string; format: string; model: ModelInfo | null; stale: boolean; fetchedAt: string | null } | null,
  lastPack: null as DraftPackPayload | null,
  lastScores: null as DraftScoresPayload | null,
  /** score results keyed "pack-pick" for DB pick records */
  scoresByPick: new Map<string, DraftScoresPayload>(),
  serverStatus: { status: 'red', model: null, stale: false, fetchedAt: null } as ServerStatusPayload,
  endTimer: null as NodeJS.Timeout | null
}

// True while the dashboard was auto-minimized for a draft (restore on draft-end)
let dashboardMinimizedForDraft = false

/** Push the overlay's visibility to the dashboard so its toggle stays truthful. */
function sendOverlayVisibility(): void {
  const visible = !!overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isVisible()
  if (registryWindow && !registryWindow.isDestroyed()) {
    registryWindow.webContents.send('overlay-visibility', { visible })
  }
}

/**
 * Plain-app quit semantics: the app stays alive only while the dashboard is
 * open or the overlay is showing. Hiding the overlay with the dashboard
 * already closed quits.
 */
function quitIfNothingShowing(): void {
  const dashboardOpen = !!registryWindow && !registryWindow.isDestroyed()
  const overlayShowing = !!overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isVisible()
  if (!dashboardOpen && !overlayShowing) {
    app.quit()
  }
}

/** Create (or re-create) the dashboard window and wire its lifecycle. */
function ensureRegistryWindow(): BrowserWindow {
  if (registryWindow && !registryWindow.isDestroyed()) {
    registryWindow.show()
    return registryWindow
  }

  registryWindow = createRegistryWindow()
  registryWindow.on('closed', () => {
    registryWindow = null
    quitIfNothingShowing()
  })
  registryWindow.webContents.on('did-finish-load', () => {
    sendOverlayVisibility()
  })
  return registryWindow
}

/**
 * The Untapped flow: on draft-start, clear the desk — minimize the dashboard
 * (if the setting is on) so the user is left with only the overlay over Arena.
 */
function hideDashboardForDraft(): void {
  if (!getOverlayUiPrefs().autoHideDashboard) return
  if (
    registryWindow &&
    !registryWindow.isDestroyed() &&
    registryWindow.isVisible() &&
    !registryWindow.isMinimized()
  ) {
    dashboardMinimizedForDraft = true
    registryWindow.minimize()
  }
}

function restoreDashboardAfterDraft(): void {
  if (!dashboardMinimizedForDraft) return
  dashboardMinimizedForDraft = false
  if (registryWindow && !registryWindow.isDestroyed() && registryWindow.isMinimized()) {
    registryWindow.restore()
  }
}

/**
 * Create all application windows
 */
async function createWindows(): Promise<void> {
  overlayWindow = createOverlayWindow()
  ensureRegistryWindow()

  // The startup replay usually finishes before the overlay page loads, so a
  // 'detailed-logs' send during replay is dropped. Re-send once loaded.
  overlayWindow.webContents.on('did-finish-load', () => {
    if (detailedLogsEnabled === false) {
      overlayWindow?.webContents.send('detailed-logs', { enabled: false })
    }
  })

  overlayWindow.on('show', sendOverlayVisibility)
  overlayWindow.on('hide', sendOverlayVisibility)

  // The startup log replay races window creation: if it already finished and
  // left us inside an active draft, surface it now that the window exists.
  if (!isReplaying) {
    surfaceActiveDraft()
  }
}

/**
 * Initialize the log parser and set up event handlers.
 * Events from the parser are forwarded to renderer windows and persisted to the database.
 */
function setupLogParser(): void {
  logParser = new LogParser()

  // Inventory updates (gems, gold, wildcards)
  logParser.on('inventory', (data) => {
    overlayWindow?.webContents.send('inventory-update', data)
    registryWindow?.webContents.send('inventory-update', data)

    console.log('[Parser] Inventory:', {
      gems: data.gems,
      gold: data.gold,
      wc: `${data.wcMythic}M/${data.wcRare}R/${data.wcUncommon}U/${data.wcCommon}C`
    })

    try {
      recordInventorySnapshot(data)
    } catch (error) {
      console.error('[DB] Failed to record inventory:', error)
    }
  })

  // Collection updates
  logParser.on('collection', (data) => {
    registryWindow?.webContents.send('collection-update', data)
    console.log('[Parser] Collection:', Object.keys(data).length, 'cards')

    try {
      updateCollection(data)
    } catch (error) {
      console.error('[DB] Failed to update collection:', error)
    }
  })

  // Match start
  logParser.on('match-start', (data) => {
    overlayWindow?.webContents.send('match-start', data)
    currentMatchId = data.matchId
    lastTurnNumber = 0
    lastOpponentLife = 20
    lastPlayerLife = 20

    const deckName = currentDeckName || logParser?.getCurrentDeckName() || null
    console.log('[Parser] Match started:', data.matchId, 'vs', data.opponentName, `(${data.opponentPlatform || '?'})`, 'Deck:', deckName || 'Unknown')

    try {
      insertMatch({
        id: data.matchId,
        eventId: data.eventId,
        format: data.gameMode || data.eventId,
        deckId: null,
        deckName: deckName,
        opponentName: data.opponentName,
        result: 'draw',
        gameCount: 1,
        startedAt: new Date(),
        onPlay: data.seatId === 1,
        opponentPlatform: data.opponentPlatform
      })
    } catch (error) {
      console.error('[DB] Failed to insert match:', error)
    }
  })

  // Match end
  logParser.on('match-end', (data) => {
    overlayWindow?.webContents.send('match-end', data)
    registryWindow?.webContents.send('match-end', data)

    // Derive win condition from match reason and game state
    const winCondition = deriveWinCondition(data.result, data.reason, lastOpponentLife, lastPlayerLife)
    console.log('[Parser] Match ended:', data.matchId, 'Result:', data.result, `(${winCondition}) Turn ${lastTurnNumber}`)

    try {
      updateMatchEnd(data.matchId, data.result, data.gameCount, winCondition, lastTurnNumber)
    } catch (error) {
      console.error('[DB] Failed to update match:', error)
    }

    currentMatchId = null
  })

  // Game state updates (for deck tracker)
  logParser.on('game-state', (data) => {
    overlayWindow?.webContents.send('game-state', data)
    // Track for win condition derivation
    if (data.turnNumber > 0) lastTurnNumber = data.turnNumber
    if (data.playerLife > 0) lastPlayerLife = data.playerLife
    if (data.opponentLife > 0) lastOpponentLife = data.opponentLife
  })

  // Deck submission (cards in deck)
  logParser.on('deck-submission', (data) => {
    overlayWindow?.webContents.send('deck-submission', data)

    if (data.deckName && data.deckName !== 'Unknown Deck') {
      currentDeckName = data.deckName

      // Update the database if we're in a match and got a valid deck name
      if (currentMatchId) {
        try {
          updateMatchDeckName(currentMatchId, data.deckName, data.deckId || null)
          console.log('[Parser] Updated match deck name:', data.deckName)
        } catch (error) {
          console.error('[DB] Failed to update match deck name:', error)
        }
      }
    }
    console.log('[Parser] Deck:', data.deckName)
  })

  // Deck selected (from Courses data)
  logParser.on('deck-selected', (data) => {
    if (data.deckName && data.deckName !== 'Unknown Deck') {
      currentDeckName = data.deckName
      overlayWindow?.webContents.send('deck-selected', data)
      console.log('[Parser] Deck selected:', data.deckName)

      // Update the database if we're in a match
      if (currentMatchId) {
        try {
          updateMatchDeckName(currentMatchId, data.deckName, data.deckId || null)
          console.log('[Parser] Updated match deck name from selection:', data.deckName)
        } catch (error) {
          console.error('[DB] Failed to update match deck name:', error)
        }
      }
    }
  })

  // Draft events
  logParser.on('draft-start', (snapshot: DraftSessionSnapshot) => handleDraftStart(snapshot))
  logParser.on('draft-pack', (snapshot: DraftSessionSnapshot) => handleDraftPack(snapshot))
  logParser.on('draft-pick', (snapshot: DraftSessionSnapshot, pick: DraftPickRecord) =>
    handleDraftPick(snapshot, pick)
  )
  logParser.on('draft-end', (snapshot: DraftSessionSnapshot) => handleDraftEnd(snapshot))

  logParser.on('detailed-logs', (data: { enabled: boolean }) => {
    detailedLogsEnabled = data.enabled
    if (!data.enabled) {
      console.warn('[Parser] MTGA detailed logs are DISABLED — draft events will not appear')
    }
    overlayWindow?.webContents.send('detailed-logs', data)
  })
}

// ============================================================================
// Draft coordination
// ============================================================================

function draftDbId(snapshot: DraftSessionSnapshot): string {
  return snapshot.draftId ?? snapshot.eventName ?? 'unknown-draft'
}

/**
 * Resolve the DB id for a session ONCE at draft-start. Human drafts get their
 * real draftId; bot drafts only have an event name, which repeats across
 * drafts of the same queue — a provisional id gets a #2/#3... suffix rather
 * than silently overwriting a previously completed draft's rows. During the
 * startup replay we instead converge onto the newest recorded id so replaying
 * an already-recorded draft never duplicates rows.
 */
function resolveDraftDbId(snapshot: DraftSessionSnapshot): string {
  const base = draftDbId(snapshot)
  if (snapshot.draftId) return base

  let candidate = base
  let lastExisting: string | null = null
  for (let n = 2; ; n++) {
    let row: { id: string; completedAt: string | null } | null = null
    try {
      row = findDraft(candidate)
    } catch (error) {
      console.error('[DB] Failed to look up draft id:', error)
      return base
    }
    if (!row) break
    lastExisting = candidate
    if (!row.completedAt) break // active/stub row: reuse it
    candidate = `${base}#${n}`
  }

  if (isReplaying && lastExisting) return lastExisting
  return candidate
}

/**
 * DB id for pick/end writes. When a session that started under a provisional
 * event-name id learns its real draftId (human drafts learn it at the first
 * pack/pick event), migrate the already-written rows to the real id.
 */
function ensureDraftDbId(snapshot: DraftSessionSnapshot): string {
  const real = snapshot.draftId
  const current = draftRuntime.dbId

  if (real) {
    if (current && current !== real) {
      try {
        migrateDraftId(current, real)
      } catch (error) {
        console.error('[DB] Failed to migrate draft id:', error)
      }
    }
    draftRuntime.dbId = real
    return real
  }

  if (current) return current
  draftRuntime.dbId = resolveDraftDbId(snapshot)
  return draftRuntime.dbId
}

function manaValueFromCost(manaCost: string): number | null {
  if (!manaCost) return null
  let total = 0
  const regex = /\{([^}]+)\}/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(manaCost)) !== null) {
    const sym = match[1]
    if (/^\d+$/.test(sym)) total += parseInt(sym, 10)
    else if (sym.toUpperCase() !== 'X') total += 1
  }
  return total
}

/**
 * Build renderer pack rows from local card identity (Arena DB registry) plus
 * cached server stats. Never blocks on the network.
 */
function buildCardRows(grpIds: number[]): DraftCardRow[] {
  return grpIds.map(grpId => {
    const reg = getCard(grpId)
    const rating = draftRuntime.ratings?.get(grpId) ?? null

    return {
      grpId,
      name: reg?.name ?? rating?.name ?? null,
      manaCost: reg?.manaCost ?? '',
      type: reg?.type ?? '',
      rarity: reg?.rarity ?? rating?.rarity ?? null,
      colors: reg?.colors?.join('') || rating?.colors || '',
      manaValue: rating?.mana_value ?? manaValueFromCost(reg?.manaCost ?? ''),
      gihWr: rating?.gih_wr_shrunk ?? rating?.gih_wr ?? null,
      alsa: rating?.alsa ?? null,
      evP1p1: rating?.ev_p1p1 ?? null,
      ev: null,
      prob: null,
      tierPct: null,
      rank: null,
      imageUrl: reg?.imageUrl ?? rating?.image_normal ?? rating?.image_small ?? null
    }
  })
}

function draftStartPayload(snapshot: DraftSessionSnapshot): Record<string, unknown> {
  return {
    draftId: snapshot.draftId,
    eventName: snapshot.eventName,
    set: snapshot.set,
    format: snapshot.format,
    isBotDraft: snapshot.isBotDraft,
    picksCount: snapshot.picks.length
  }
}

function draftPickPayload(snapshot: DraftSessionSnapshot, pick: DraftPickRecord | null): Record<string, unknown> {
  return {
    pack: pick?.pack ?? null,
    pick: pick?.pick ?? null,
    grpIds: pick?.grpIds ?? [],
    pickedNames: (pick?.grpIds ?? []).map(id => getCardName(id) ?? `Card #${id}`),
    picksCount: snapshot.picks.length,
    pool: buildCardRows(snapshot.pool),
    history: snapshot.picks.map(p => ({
      pack: p.pack,
      pick: p.pick,
      grpIds: p.grpIds,
      names: p.grpIds.map(id => getCardName(id) ?? `Card #${id}`),
      packNames: p.packGrpIds.map(id => getCardName(id) ?? `Card #${id}`)
    }))
  }
}

function draftEndPayload(snapshot: DraftSessionSnapshot): Record<string, unknown> {
  return {
    set: snapshot.set,
    format: snapshot.format,
    picksCount: snapshot.picks.length,
    pool: buildCardRows(snapshot.pool)
  }
}

function sendServerStatus(): void {
  overlayWindow?.webContents.send('server-status', draftRuntime.serverStatus)
}

function updateServerStatus(status?: ServerStatus): void {
  draftRuntime.serverStatus = {
    status: status ?? serverClient?.getStatus() ?? 'red',
    model: draftRuntime.ratingsMeta?.model ?? null,
    stale: draftRuntime.ratingsMeta?.stale ?? false,
    fetchedAt: draftRuntime.ratingsMeta?.fetchedAt ?? null
  }
  if (!isReplaying) sendServerStatus()
}

/**
 * ev_p1p1 for every rated card in the set, sorted ascending. The renderer
 * caches this and computes set percentiles (conviction bands) client-side.
 */
function setEvP1p1Sorted(): number[] | null {
  if (!draftRuntime.ratings || draftRuntime.ratings.size === 0) return null
  const evs = Array.from(draftRuntime.ratings.values())
    .map(card => card.ev_p1p1)
    .filter((v): v is number => v !== null && v !== undefined && Number.isFinite(v))
    .sort((a, b) => a - b)
  return evs.length > 0 ? evs : null
}

function sendSetRatings(): void {
  if (isReplaying) return
  overlayWindow?.webContents.send('draft-ratings', { setEvP1p1Sorted: setEvP1p1Sorted() })
}

/**
 * Prefetch the ratings table for the drafted set/format (once per draft).
 * Disk cache is the offline fallback; ev_p1p1 doubles as the human-P1P1
 * tier list.
 */
async function ensureRatings(snapshot: DraftSessionSnapshot): Promise<void> {
  if (!serverClient || !snapshot.set) return
  const format = snapshot.format ?? 'PremierDraft'
  const meta = draftRuntime.ratingsMeta
  if (meta && meta.set === snapshot.set && meta.format === format && !meta.stale) {
    // Already fetched (e.g. a second draft of the same set) — the renderer
    // resets its set-percentile cache at draft-start, so re-send it.
    sendSetRatings()
    return
  }

  const result = await serverClient.getRatings(snapshot.set, format)
  if (!result) {
    updateServerStatus()
    return
  }

  draftRuntime.ratings = new Map(result.cards.map(card => [card.grp_id, card]))
  draftRuntime.ratingsMeta = {
    set: result.set,
    format: result.format,
    model: result.model,
    stale: result.stale,
    fetchedAt: result.fetchedAt
  }
  mergeServerCards(result.cards)
  updateServerStatus()
  sendSetRatings()

  // Human P1P1 pending (packs aren't logged before pick time): show tier list
  const current = draftRuntime.session
  if (
    current &&
    current.state === 'active' &&
    !current.isBotDraft &&
    !current.currentPack &&
    current.picks.length === 0
  ) {
    sendTierList(current)
  } else if (draftRuntime.lastPack && !draftRuntime.lastPack.isTierList) {
    // Stats arrived after the pack rendered names-only: refresh rows
    const refreshed: DraftPackPayload = {
      ...draftRuntime.lastPack,
      cards: buildCardRows(draftRuntime.lastPack.cards.map(c => c.grpId))
    }
    draftRuntime.lastPack = refreshed
    if (!isReplaying) overlayWindow?.webContents.send('draft-pack', refreshed)
  }
}

/** Human P1P1: the pack is not in the log yet — show the set tier list. */
function sendTierList(snapshot: DraftSessionSnapshot): void {
  if (!draftRuntime.ratings || draftRuntime.ratings.size === 0) return

  const allEv = Array.from(draftRuntime.ratings.values())
    .map(card => card.ev_p1p1)
    .filter((v): v is number => v !== null && v !== undefined && Number.isFinite(v))

  const ranked = Array.from(draftRuntime.ratings.values())
    .filter(card => card.ev_p1p1 !== null && card.ev_p1p1 !== undefined)
    .sort((a, b) => (b.ev_p1p1 ?? 0) - (a.ev_p1p1 ?? 0))
    .slice(0, 20)

  // Percentile within the whole set — the renderer turns this into flames
  const pctByGrp = new Map<number, number>(ranked.map(card => {
    const below = allEv.filter(v => v < (card.ev_p1p1 as number)).length
    return [card.grp_id, allEv.length > 0 ? (below / allEv.length) * 100 : 0]
  }))

  const payload: DraftPackPayload = {
    pack: 1,
    pick: 1,
    isTierList: true,
    note: 'P1P1 pack is not logged before you pick — showing the set tier list',
    cards: buildCardRows(ranked.map(card => card.grp_id)).map(row => ({
      ...row,
      tierPct: pctByGrp.get(row.grpId) ?? null
    }))
  }
  draftRuntime.lastPack = payload
  if (!isReplaying) overlayWindow?.webContents.send('draft-pack', payload)
}

function handleDraftStart(snapshot: DraftSessionSnapshot): void {
  console.log('[Draft] Started:', snapshot.eventName ?? snapshot.draftId ?? 'unknown', snapshot.set, snapshot.format)
  draftRuntime.session = snapshot
  draftRuntime.dbId = null
  draftRuntime.lastPack = null
  draftRuntime.lastScores = null
  draftRuntime.scoresByPick.clear()
  if (draftRuntime.endTimer) {
    clearTimeout(draftRuntime.endTimer)
    draftRuntime.endTimer = null
  }

  try {
    upsertDraft({
      id: ensureDraftDbId(snapshot),
      eventName: snapshot.eventName,
      setCode: snapshot.set,
      format: snapshot.format
    })
  } catch (error) {
    console.error('[DB] Failed to upsert draft:', error)
  }

  if (!isReplaying) {
    if (overlayWindow) {
      showOverlay(overlayWindow)
      setOverlayMode(overlayWindow, 'draft')
      sendOverlayVisibility()
    }
    hideDashboardForDraft()
    overlayWindow?.webContents.send('draft-start', draftStartPayload(snapshot))
    void ensureRatings(snapshot)
  }
}

function handleDraftPack(snapshot: DraftSessionSnapshot): void {
  draftRuntime.session = snapshot
  const current = snapshot.currentPack
  if (!current) return

  // Render immediately from names + cached stats; EV scores arrive async.
  const payload: DraftPackPayload = {
    pack: current.pack,
    pick: current.pick,
    isTierList: false,
    note: null,
    cards: buildCardRows(current.grpIds)
  }
  draftRuntime.lastPack = payload

  if (!isReplaying) {
    overlayWindow?.webContents.send('draft-pack', payload)
    void ensureRatings(snapshot)
    void requestScores(snapshot)
  }
}

/** POST /score for the current pack; re-sort rows when it resolves. */
async function requestScores(snapshot: DraftSessionSnapshot): Promise<void> {
  if (!serverClient || !snapshot.currentPack) return
  const { pack, pick, grpIds } = snapshot.currentPack

  // Pool excludes what's in this pack: score against picks so far
  const result = await serverClient.score({
    set: snapshot.set,
    format: snapshot.format ?? 'PremierDraft',
    pack: grpIds,
    pool: snapshot.pool,
    packNumber: pack,
    pickNumber: pick
  })

  updateServerStatus()
  if (!result) return

  // The server can infer the set from the pack — learn it for ratings/caching
  if (!snapshot.set && result.set && draftRuntime.session) {
    draftRuntime.session = { ...draftRuntime.session, set: result.set }
    void ensureRatings(draftRuntime.session)
  }
  mergeServerCards(result.cards)

  const rowsByGrp = new Map(buildCardRows(grpIds).map(row => [row.grpId, row]))
  const cards: DraftCardRow[] = result.cards
    .filter(card => rowsByGrp.has(card.grp_id))
    .map(card => ({
      ...rowsByGrp.get(card.grp_id)!,
      name: rowsByGrp.get(card.grp_id)!.name ?? card.name,
      ev: card.ev ?? null,
      prob: card.prob ?? null,
      rank: card.rank ?? null
    }))

  const payload: DraftScoresPayload = { pack, pick, model: result.model, cards }
  draftRuntime.lastScores = payload
  draftRuntime.scoresByPick.set(`${pack}-${pick}`, payload)

  // Only surface if this is still the pack on screen
  const live = draftRuntime.session?.currentPack
  if (!isReplaying && live && live.pack === pack && live.pick === pick) {
    overlayWindow?.webContents.send('draft-scores', payload)
  }
}

function handleDraftPick(snapshot: DraftSessionSnapshot, pick: DraftPickRecord): void {
  draftRuntime.session = snapshot

  // "My picks vs my model" review data. Human drafts only learn their
  // draftId at the first pick/pack event: ensureDraftDbId migrates any rows
  // written under the provisional id and guarantees the drafts row exists.
  try {
    const dbId = ensureDraftDbId(snapshot)
    upsertDraft({
      id: dbId,
      eventName: snapshot.eventName,
      setCode: snapshot.set,
      format: snapshot.format
    })
    const scores = draftRuntime.scoresByPick.get(`${pick.pack}-${pick.pick}`)
    const top = scores?.cards.reduce<DraftCardRow | null>(
      (best, card) => (best === null || (card.rank ?? 99) < (best.rank ?? 99) ? card : best),
      null
    ) ?? null
    const pickedEv = scores?.cards.find(card => pick.grpIds.includes(card.grpId))?.ev ?? null

    recordDraftPick({
      draftId: dbId,
      pack: pick.pack,
      pick: pick.pick,
      packGrpIds: pick.packGrpIds,
      pickedGrpIds: pick.grpIds,
      modelTopGrpId: top?.grpId ?? null,
      modelEv: top?.ev ?? null,
      pickedEv
    })
  } catch (error) {
    console.error('[DB] Failed to record draft pick:', error)
  }

  if (!isReplaying) {
    overlayWindow?.webContents.send('draft-pick', draftPickPayload(snapshot, pick))
  }
}

function handleDraftEnd(snapshot: DraftSessionSnapshot): void {
  console.log('[Draft] Complete:', snapshot.eventName ?? snapshot.draftId, `${snapshot.pool.length} cards`)
  draftRuntime.session = snapshot

  try {
    completeDraft(ensureDraftDbId(snapshot), snapshot.pool)
  } catch (error) {
    console.error('[DB] Failed to complete draft:', error)
  }

  if (!isReplaying) {
    overlayWindow?.webContents.send('draft-end', draftEndPayload(snapshot))
    restoreDashboardAfterDraft()
    // The renderer shows a dismissible "draft complete" card and sends
    // 'draft-dismiss' (button or its own 10s timeout). This is only a
    // safety net in case the renderer never does.
    if (draftRuntime.endTimer) clearTimeout(draftRuntime.endTimer)
    draftRuntime.endTimer = setTimeout(() => {
      if (overlayWindow) setOverlayMode(overlayWindow, 'match')
      draftRuntime.endTimer = null
    }, 15_000)
  }
}

/**
 * After the startup replay: if the log left us inside an active draft,
 * surface it (window, pack, scores) as if it had just happened.
 */
function surfaceActiveDraft(): void {
  const snapshot = logParser?.getDraftSnapshot()
  if (!snapshot || snapshot.state !== 'active') return

  console.log('[Draft] Resuming active draft after replay:', snapshot.eventName ?? snapshot.draftId)
  draftRuntime.session = snapshot

  if (overlayWindow) {
    showOverlay(overlayWindow)
    setOverlayMode(overlayWindow, 'draft')
    sendOverlayVisibility()
  }
  hideDashboardForDraft()
  overlayWindow?.webContents.send('draft-start', draftStartPayload(snapshot))
  overlayWindow?.webContents.send('draft-pick', draftPickPayload(snapshot, null))

  if (snapshot.currentPack) {
    handleDraftPack(snapshot)
  } else {
    void ensureRatings(snapshot)
  }
  sendServerStatus()
}

/**
 * Initialize the log file watcher.
 * Watches MTGA log files and forwards lines to the parser.
 */
function setupLogWatcher(): void {
  const config = loadConfig()
  logWatcher = new LogWatcher({ watchLegacyLogs: config.watchLegacyLogs })

  logWatcher.on('line', (line: string) => {
    logParser?.parseLine(line)
  })

  logWatcher.on('replay-start', () => {
    isReplaying = true
    console.log('[Watcher] Replaying historical log content...')
  })

  logWatcher.on('replay-complete', () => {
    isReplaying = false
    console.log('[Watcher] Replay complete, now tailing live')
    if (detailedLogsEnabled === false) {
      overlayWindow?.webContents.send('detailed-logs', { enabled: false })
    }
    surfaceActiveDraft()
  })

  logWatcher.on('error', (error: Error) => {
    console.error('[Watcher] Error:', error.message)
  })

  logWatcher.on('watching', (path: string) => {
    console.log('[Watcher] Watching:', path)
  })

  void logWatcher.start()
}

/**
 * Initialize the draft server client (ratings prefetch + per-pick scoring).
 */
function setupServerClient(): void {
  const config = loadConfig()
  const cacheDir = join(app.getPath('userData'), 'cache')
  serverClient = new ServerClient(config, cacheDir)

  serverClient.on('status', () => updateServerStatus())

  serverClient.on('reconnected', () => {
    console.log('[Server] Reconnected')
    const snapshot = draftRuntime.session
    if (snapshot && snapshot.state === 'active') {
      draftRuntime.ratingsMeta = null // force a fresh (non-stale) fetch
      void ensureRatings(snapshot)
      if (snapshot.currentPack) void requestScores(snapshot)
    }
  })

  serverClient.startRetryLoop()
  void serverClient.checkHealth().then(ok => {
    updateServerStatus(ok ? 'green' : undefined)
  })
}

/**
 * Derive a human-readable win condition from match end data and last known game state.
 */
function deriveWinCondition(
  result: 'win' | 'loss' | 'draw',
  reason: string,
  opponentLife: number,
  playerLife: number
): string {
  const reasonLower = reason.toLowerCase()

  if (reasonLower.includes('concede') || reasonLower.includes('concession')) {
    return result === 'win' ? 'Opponent Conceded' : 'Conceded'
  }
  if (reasonLower.includes('timeout') || reasonLower.includes('idle')) {
    return result === 'win' ? 'Opponent Timed Out' : 'Timed Out'
  }
  if (reasonLower.includes('disconnect') || reasonLower.includes('connection')) {
    return result === 'win' ? 'Opponent Disconnected' : 'Disconnected'
  }

  // Game ended normally — check life totals to distinguish damage vs mill
  if (result === 'win') {
    // If opponent still had life, they were milled (drew from empty library)
    if (opponentLife > 0) return 'Milled'
    return 'Damage'
  } else if (result === 'loss') {
    if (playerLife > 0) return 'Milled'
    return 'Damage'
  }

  return 'Unknown'
}

// ============================================================================
// IPC Handlers - Expose data to renderer processes
// ============================================================================

ipcMain.handle('get-state', () => {
  return logParser?.getState() ?? null
})

ipcMain.handle('get-match-history', (_, limit?: number) => {
  try {
    return getRecentMatches(limit || 50)
  } catch (error) {
    console.error('[IPC] Failed to get match history:', error)
    return []
  }
})

ipcMain.handle('get-match-stats', (_, deckId?: string) => {
  try {
    return getMatchStats(deckId)
  } catch (error) {
    console.error('[IPC] Failed to get match stats:', error)
    return { wins: 0, losses: 0, draws: 0, winRate: 0 }
  }
})

ipcMain.handle('get-play-draw-stats', (_, deckId?: string) => {
  try {
    return getPlayDrawStats(deckId)
  } catch (error) {
    console.error('[IPC] Failed to get play/draw stats:', error)
    return {
      onPlay: { wins: 0, losses: 0, winRate: 0 },
      onDraw: { wins: 0, losses: 0, winRate: 0 }
    }
  }
})

ipcMain.handle('get-stats-by-format', (_, deckId?: string) => {
  try {
    return getStatsByFormat(deckId)
  } catch (error) {
    console.error('[IPC] Failed to get stats by format:', error)
    return []
  }
})

ipcMain.handle('get-collection', () => {
  try {
    return getCollection()
  } catch (error) {
    console.error('[IPC] Failed to get collection:', error)
    return {}
  }
})

ipcMain.handle('get-card', (_, grpId: number) => {
  return getCard(grpId)
})

ipcMain.handle('get-card-name', (_, grpId: number) => {
  return getCardName(grpId)
})

ipcMain.handle('get-collection-stats', () => {
  try {
    return getCollectionStats()
  } catch (error) {
    console.error('[IPC] Failed to get collection stats:', error)
    return { totalCards: 0, uniqueCards: 0, byRarity: {} }
  }
})

ipcMain.handle('get-set-list', () => {
  try {
    return getSetList()
  } catch (error) {
    console.error('[IPC] Failed to get set list:', error)
    return []
  }
})

ipcMain.handle('get-cards-by-set', (_, setCode: string) => {
  try {
    return getCardsBySet(setCode)
  } catch (error) {
    console.error('[IPC] Failed to get cards by set:', error)
    return []
  }
})

ipcMain.handle('update-match-notes', (_, matchId: string, notes: string) => {
  try {
    updateMatchNotes(matchId, notes)
    return true
  } catch (error) {
    console.error('[IPC] Failed to update match notes:', error)
    return false
  }
})

ipcMain.handle('get-opponent-stats', (_, deckId?: string) => {
  try {
    return getOpponentStats(deckId)
  } catch (error) {
    console.error('[IPC] Failed to get opponent stats:', error)
    return []
  }
})

ipcMain.handle('format-event-id', (_, eventId: string) => {
  try {
    return formatEventId(eventId)
  } catch (error) {
    console.error('[IPC] Failed to format event ID:', error)
    return eventId
  }
})

ipcMain.handle('get-draft-state', () => {
  const snapshot = logParser?.getDraftSnapshot() ?? draftRuntime.session
  if (!snapshot) {
    // No draft yet: still expose server status and the detailed-logs flag so
    // a late-attaching renderer can show the warning banner (a live
    // 'detailed-logs' send is dropped if it fires before the page loads).
    return {
      active: false,
      start: null,
      pack: null,
      scores: null,
      pick: null,
      end: null,
      serverStatus: draftRuntime.serverStatus,
      detailedLogsEnabled,
      setEvP1p1Sorted: null
    }
  }

  return {
    active: snapshot.state === 'active',
    start: draftStartPayload(snapshot),
    pack: draftRuntime.lastPack,
    scores: draftRuntime.lastScores,
    pick: draftPickPayload(snapshot, null),
    end: snapshot.state === 'complete' ? draftEndPayload(snapshot) : null,
    serverStatus: draftRuntime.serverStatus,
    detailedLogsEnabled,
    setEvP1p1Sorted: setEvP1p1Sorted()
  }
})

// ============================================================================
// IPC Handlers - Overlay window controls (manual drag/resize/density)
// ============================================================================
// The overlay is focusable:false (it must never steal focus or keystrokes
// from Arena), which on macOS also kills native window dragging — so the
// renderer drives moves and resizes explicitly through these channels.

ipcMain.handle('overlay-drag-start', () => {
  if (!overlayWindow || overlayWindow.isDestroyed()) return null
  return overlayWindow.getBounds()
})

ipcMain.on('overlay-move', (_, pos: { x: number; y: number }) => {
  if (overlayWindow && typeof pos?.x === 'number' && typeof pos?.y === 'number') {
    moveOverlay(overlayWindow, pos.x, pos.y)
  }
})

ipcMain.on('overlay-move-end', () => {
  if (overlayWindow) saveOverlayBounds(overlayWindow)
})

ipcMain.handle('overlay-resize-start', () => {
  if (!overlayWindow || overlayWindow.isDestroyed()) return null
  return overlayWindow.getBounds()
})

ipcMain.on('overlay-resize', (_, size: { width?: number; height?: number }) => {
  if (overlayWindow && size) resizeOverlay(overlayWindow, size, false)
})

ipcMain.on('overlay-resize-end', () => {
  if (overlayWindow) saveOverlayBounds(overlayWindow)
})

// Content-height sync: in verdict/mini densities the renderer measures the
// panel and asks the window to match (anchored top-left).
ipcMain.on('overlay-set-size', (_, size: { width?: number | null; height?: number | null; animate?: boolean }) => {
  if (overlayWindow && size) {
    resizeOverlay(overlayWindow, { width: size.width, height: size.height }, !!size.animate)
  }
})

ipcMain.on('overlay-density', (_, data: { density?: string }) => {
  const density: DraftDensity =
    data?.density === 'full' || data?.density === 'mini' ? data.density : 'verdict'
  applyDraftDensity(overlayWindow, density)
})

ipcMain.handle('overlay-get-prefs', () => getOverlayUiPrefs())

ipcMain.on('overlay-set-prefs', (_, patch: { autoHideDashboard?: boolean }) => {
  if (patch && typeof patch.autoHideDashboard === 'boolean') {
    setOverlayUiPrefs({ autoHideDashboard: patch.autoHideDashboard })
  }
})

// The ✕ on the grip: hide the overlay (not quit) — unless the dashboard is
// gone too, in which case hiding the last surface quits like a plain app.
ipcMain.on('overlay-hide', () => {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    hideOverlay(overlayWindow)
  }
  quitIfNothingShowing()
})

// Dashboard's "Draft Overlay" toggle
ipcMain.handle('overlay-toggle', () => {
  if (!overlayWindow || overlayWindow.isDestroyed()) return false
  if (overlayWindow.isVisible()) {
    hideOverlay(overlayWindow)
    return false
  }
  showOverlay(overlayWindow)
  return true
})

ipcMain.handle('overlay-visible', () => {
  return !!overlayWindow && !overlayWindow.isDestroyed() && overlayWindow.isVisible()
})

// Renderer dismissed the end-of-draft card (button click or its 10s timeout)
ipcMain.on('draft-dismiss', () => {
  if (draftRuntime.endTimer) {
    clearTimeout(draftRuntime.endTimer)
    draftRuntime.endTimer = null
  }
  if (overlayWindow) setOverlayMode(overlayWindow, 'match')
})

// ============================================================================
// Application Lifecycle
// ============================================================================

app.whenReady().then(async () => {
  // Initialize database
  try {
    initDatabase()
    console.log('[App] Database initialized')
  } catch (error) {
    console.error('[App] Failed to initialize database:', error)
  }

  // Load card registry
  try {
    loadCardRegistry()
    console.log('[App] Card registry loaded')
  } catch (error) {
    console.error('[App] Failed to load card registry:', error)
  }

  // Standard menu bar: About/Quit (Cmd+Q), Edit roles for copy/paste,
  // Window roles — plain Mac app behavior.
  installApplicationMenu()

  // Start services
  setupServerClient()
  setupLogParser()
  setupLogWatcher()
  await createWindows()

  // macOS: Dock icon click re-opens (or re-focuses) the dashboard —
  // the app's face — even if it was closed while the overlay kept running.
  app.on('activate', () => {
    const win = ensureRegistryWindow()
    win.focus()
  })
})

// Plain quit semantics on every platform: no windows -> quit. (The overlay
// window only ever *hides*, so the dashboard 'closed' handler and the
// 'overlay-hide' channel call quitIfNothingShowing() for the hidden case.)
app.on('window-all-closed', () => {
  app.quit()
})

app.on('before-quit', () => {
  cleanup()
})

app.on('will-quit', () => {
  unregisterOverlayShortcuts()
})

/**
 * Clean up resources before quitting: chokidar watchers + poll timers
 * (logWatcher.stop), server retry loop (serverClient.stop), pending draft
 * timer, sqlite handle. Windows are torn down by app.quit() itself.
 */
function cleanup(): void {
  logWatcher?.stop()
  serverClient?.stop()
  if (draftRuntime.endTimer) {
    clearTimeout(draftRuntime.endTimer)
    draftRuntime.endTimer = null
  }
  closeDatabase()
}

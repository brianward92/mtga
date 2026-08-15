/**
 * MTGA Draft Assistant - Main Process Entry Point
 *
 * This is the Electron main process that coordinates:
 * - Log file watching and parsing
 * - Database operations for match history
 * - Overlay window management
 * - IPC communication with renderer processes
 */

import { app, BrowserWindow, ipcMain, screen, shell } from 'electron'
import { appendFileSync, existsSync, mkdirSync, readdirSync, renameSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { LogWatcher } from './parser/watcher'
import { LogParser } from './parser/index'
import { DraftSessionSnapshot, DraftPickRecord } from './parser/draft-parser'
import {
  createOverlayWindow,
  setOverlayMode,
  showOverlay,
  activateOverlay,
  isOverlayPresented,
  hideOverlay,
  moveOverlay,
  setOverlaySnapRectProvider,
  getFollowZoom,
  resizeOverlay,
  saveOverlayBounds,
  applyDraftDensity,
  getOverlayUiPrefs,
  setOverlayUiPrefs,
  getBadgeCalibrations,
  saveBadgeCalibration,
  DraftDensity
} from './windows/overlay'
import { PanelFollow } from './windows/panel-follow'
import {
  createBadgeWindow,
  setBadgeWindowRect,
  showBadgeWindow,
  hideBadgeWindow
} from './windows/badges'
import { ArenaGeometryPoller, ArenaRect, HelperFrame, probeArenaWindow } from './arena-geometry'
import {
  normalizeCalibration,
  applyCalibrationOp,
  aspectBucketOf,
  nearestCalibrationBucket,
  CalibrationConfig,
  CalibrationOp,
  packLayout
} from '../renderer/badges/layout'
import { hoveredCardIndex, predictPopout, intersects } from '../renderer/badges/hover'
import { detectOcclusion, scaleRect, cardness, CARDNESS_MIN, ABS_DARK as ABS_DARK_FLOOR, screenCaptureGranted, frameFromBytes, type GrayFrame } from './windows/occlusion'
import { initCardArtCache, cachedArtUrl } from './utils/card-art-cache'
import { installApplicationMenu } from './windows/menu'
import { StatusTray } from './status-tray'
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
import { backfillCompletedDraftPick } from './utils/draft-result-backfill'
import { loadConfig } from './config'
import { ServerClient, ServerCardRow, ModelInfo, ServerStatus } from './api/server-client'

// E2E testability hook (tests/e2e/drive.mjs): relocate userData (DB, caches)
// into the harness sandbox — macOS resolves appData from directory services,
// not $HOME, so the env-var HOME sandbox alone cannot isolate it. Guarded by
// MTGA_E2E_USER_DATA; a plain launch never takes this branch.
if (process.env.MTGA_E2E_USER_DATA) {
  app.setPath('userData', process.env.MTGA_E2E_USER_DATA)
}

// Window references
let overlayWindow: BrowserWindow | null = null
let badgeWindow: BrowserWindow | null = null
let statusTray: StatusTray | null = null
let isQuitting = false
let quitCommitted = false
let quitCommitTimer: NodeJS.Timeout | null = null

// Core services
let logWatcher: LogWatcher | null = null
let logParser: LogParser | null = null
let serverClient: ServerClient | null = null

// Current match state
let currentMatchId: string | null = null
let currentDeckName: string | null = null

interface PendingMatch {
  id: string
  eventId: string
  format: string
  deckId: string | null
  deckName: string | null
  opponentName: string
  startedAt: Date
  onPlay: boolean
  opponentPlatform: string | undefined
}

// Active matches stay in memory. Persisting only on MatchCompleted prevents a
// crash or truncated startup replay from turning an unfinished match into a draw.
let pendingMatch: PendingMatch | null = null

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

// ============================================================================
// Badge overlay state (Arena-anchored flame badges)
// ============================================================================

/** Polls the Arena window rect (osascript) while a draft/calibration is live. */
const arenaPoller = new ArenaGeometryPoller()

// Panel snapping: screen edges always; Arena edges only while its rect is live
setOverlaySnapRectProvider(() => (arenaPoller.isFound() ? arenaPoller.lastKnown : null))

// Glue the panel to Arena: follow moves, rescale with resizes (tray-toggleable)
const panelFollow = new PanelFollow({
  getWindow: () => overlayWindow,
  isEnabled: () => getOverlayUiPrefs().followArena,
  getArena: () => (arenaPoller.isFound() ? arenaPoller.lastKnown : null)
})

// Follow needs a faster tick than the badge default for a glued feel.
const ARENA_POLL_MS = 1000

/**
 * Single authority over whether the Arena geometry poller runs: badges want
 * it during a live draft, calibration always, and the glued panel whenever
 * it is on screen. Idempotent — call after any of those inputs change.
 */
function syncArenaPollerDemand(): void {
  const badgesWant = !isReplaying && badgesEnabled() && draftRuntime.session?.state === 'active'
  const panelWant = getOverlayUiPrefs().followArena && isOverlayPresented(overlayWindow)
  const want = badgeRuntime.calibrating || badgesWant || panelWant
  if (want && !arenaPoller.isRunning()) {
    arenaPoller.start(ARENA_POLL_MS)
  } else if (!want && arenaPoller.isRunning()) {
    arenaPoller.stop()
  }
}

const badgeRuntime = {
  calibrating: false,
  calibrateCount: 14,
  calibrateConfig: null as CalibrationConfig | null,
  /** Overlay height before calibration temporarily grew it. */
  preCalibrateHeight: null as number | null,
  /** Set once when osascript reports missing Accessibility permission. */
  accessibilityIssue: false
}

function badgesEnabled(): boolean {
  return getOverlayUiPrefs().badgesEnabled
}

/**
 * Draft/calibration events go to the panel AND the badge window — but a
 * hidden badge window (badges off, or no Arena located) skips the traffic
 * entirely so it does no render work while invisible. It is re-synced with
 * the current pack state by resyncBadgeWindow() whenever it appears.
 */
function sendDraftEvent(channel: string, payload: unknown): void {
  overlayWindow?.webContents.send(channel, payload)
  if (channel === 'draft-scores') {
    console.log(`[Badges] draft-scores → badge window visible=${badgeWindow?.isVisible()} calibrating=${badgeRuntime.calibrating}`)
  }
  if (
    badgeWindow &&
    !badgeWindow.isDestroyed() &&
    (badgeWindow.isVisible() || badgeRuntime.calibrating)
  ) {
    badgeWindow.webContents.send(channel, payload)
  }
}

/**
 * Push the live draft state to the badge window after it becomes visible
 * (it received no draft events while hidden). The current pack is skipped
 * when its pick was already made — badges for a stale pack are worse than
 * no badges (badges.ts clears on draft-pick for the same reason).
 */
function resyncBadgeWindow(): void {
  if (!badgeWindow || badgeWindow.isDestroyed()) return
  const contents = badgeWindow.webContents
  contents.send('server-status', draftRuntime.serverStatus)
  contents.send('draft-ratings', { setEvP1p1Sorted: setEvP1p1Sorted() })
  const pack = draftRuntime.lastPack
  if (!pack) return
  const picked = draftRuntime.session?.picks.some(
    p => p.pack === pack.pack && p.pick === pack.pick
  )
  if (picked) { console.log('[Badges] resync: current pack already picked, skipping'); return }
  contents.send('draft-pack', pack)
  const scores = draftRuntime.lastScores
  console.log(`[Badges] resync p${pack.pack}p${pack.pick}: scores ${scores ? `p${scores.pack}p${scores.pick}` : 'none'}`)
  if (scores && scores.pack === pack.pack && scores.pick === pack.pick) {
    contents.send('draft-scores', scores)
  }
}

/**
 * The calibration config for the current Arena window shape: the working
 * calibration (while calibrating), else the persisted per-aspect-bucket one,
 * else the "default" bucket, else the built-in defaults.
 */
function resolveBadgeConfig(rect: { width: number; height: number } | null): CalibrationConfig {
  if (badgeRuntime.calibrating && badgeRuntime.calibrateConfig) {
    return badgeRuntime.calibrateConfig
  }
  const configs = getBadgeCalibrations()
  if (!rect) return normalizeCalibration(configs['default'] ?? {})

  // Exact bucket, else the nearest calibrated aspect, else the default bucket.
  const bucket =
    nearestCalibrationBucket(Object.keys(configs), rect.width, rect.height) ??
    aspectBucketOf(rect.width, rect.height)
  return normalizeCalibration(configs[bucket] ?? configs['default'] ?? {})
}

function pushBadgeView(): void {
  badgeWindow?.webContents.send('badge-view', {
    config: resolveBadgeConfig(arenaPoller.lastKnown)
  })
}

function badgesWantedNow(): boolean {
  if (badgeRuntime.calibrating) return true
  if (isReplaying || !badgesEnabled()) return false
  // Badges paint over Arena's cards; when another app is in front they would
  // paint over that app instead, so they only show while Arena is frontmost.
  if (!arenaPoller.arenaFrontmost) return false
  return draftRuntime.session?.state === 'active'
}

/**
 * Badges are on: drop the panel to Mini so it stays out of Arena's way.
 * Reuses the existing density IPC — 'density-cycle' steps the renderer's
 * cycle (verdict → full → mini), and main knows the persisted density, so
 * send exactly as many steps as it takes to land on mini.
 */
function autoMiniPanel(): void {
  if (!overlayWindow || overlayWindow.isDestroyed()) return
  const density = getOverlayUiPrefs().draftDensity
  const cycles = density === 'verdict' ? 2 : density === 'full' ? 1 : 0
  for (let i = 0; i < cycles; i++) {
    overlayWindow.webContents.send('density-cycle')
  }
}

function startBadgesForDraft(): void {
  syncArenaPollerDemand() // draft went active — poller demand changed
  if (!badgesEnabled()) return
  autoMiniPanel()
}

function stopBadgesAfterDraft(): void {
  syncArenaPollerDemand() // keeps running if calibrating or the panel is glued
  if (badgeRuntime.calibrating) return
  if (badgeWindow) hideBadgeWindow(badgeWindow)
}

function sendCalibrateState(): void {
  const payload = {
    active: badgeRuntime.calibrating,
    count: badgeRuntime.calibrateCount,
    config: badgeRuntime.calibrateConfig ?? resolveBadgeConfig(arenaPoller.lastKnown),
    arenaFound: arenaPoller.isFound(),
    accessibilityIssue: badgeRuntime.accessibilityIssue
  }
  // Control-plane: always delivered, even to a hidden badge window — the
  // teardown (active:false) must never be dropped by the idle-badges guard.
  overlayWindow?.webContents.send('calibrate-mode', payload)
  badgeWindow?.webContents.send('calibrate-mode', payload)
}

function startBadgeCalibration(): void {
  if (badgeRuntime.calibrating) {
    sendCalibrateState()
    return
  }
  badgeRuntime.calibrating = true
  badgeRuntime.calibrateConfig = resolveBadgeConfig(arenaPoller.lastKnown)
  syncArenaPollerDemand()

  // The helper controls live in the (interactive) panel window: make sure it
  // is visible and tall enough — Mini is 64px, the helper needs ~420.
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    showOverlay(overlayWindow)
    sendOverlayVisibility()
    // The helper needs ~420 CSS px; the window budget is CSS px x zoom
    const helperHeight = Math.round(420 * getFollowZoom())
    badgeRuntime.preCalibrateHeight = overlayWindow.getBounds().height
    if (badgeRuntime.preCalibrateHeight < helperHeight) {
      resizeOverlay(overlayWindow, { height: helperHeight }, true)
      panelFollow.noteReshape() // animated resize — re-anchor once settled
    }
  }

  if (badgeWindow && arenaPoller.lastKnown) {
    setBadgeWindowRect(badgeWindow, arenaPoller.lastKnown)
    showBadgeWindow(badgeWindow)
  }
  sendCalibrateState()
}

function endBadgeCalibration(save: boolean): void {
  if (!badgeRuntime.calibrating) return

  if (save && badgeRuntime.calibrateConfig) {
    const rect = arenaPoller.lastKnown
    const bucket = rect ? aspectBucketOf(rect.width, rect.height) : 'default'
    try {
      saveBadgeCalibration(bucket, badgeRuntime.calibrateConfig as unknown as Record<string, unknown>)
      console.log('[Badges] Calibration saved for bucket', bucket)
    } catch (error) {
      console.error('[Badges] Failed to save calibration:', error)
    }
  }

  badgeRuntime.calibrating = false
  badgeRuntime.calibrateConfig = null
  sendCalibrateState() // active:false -> both renderers tear down

  // Give the panel its pre-calibration height back (full density only; the
  // content-hugging densities re-sync themselves after the helper hides).
  if (overlayWindow && !overlayWindow.isDestroyed() && badgeRuntime.preCalibrateHeight !== null) {
    resizeOverlay(overlayWindow, { height: badgeRuntime.preCalibrateHeight }, true)
    panelFollow.noteReshape()
  }
  badgeRuntime.preCalibrateHeight = null

  syncArenaPollerDemand() // calibration over — poller stays only if still wanted
  const draftActive = draftRuntime.session?.state === 'active'
  if (draftActive && badgesEnabled()) {
    pushBadgeView() // back to the persisted config
  } else if (badgeWindow) {
    hideBadgeWindow(badgeWindow)
  }
}

// ============================================================================
// Arena layer awareness: hover pop-out prediction + modal (scrim) detection
// ============================================================================

const layerRuntime = {
  fallbackTimer: null as NodeJS.Timeout | null,
  lastKey: '',
  panelFaded: false,
  /** "Clear" pack frame (nothing hovered, not dark) for per-cell diffs. */
  baseline: null as GrayFrame | null,
  baselineLum: 0,
  baselineCardness: 0,
  /** Wall-clock of the last helper frame; stale => fall back to prediction. */
  lastFrameAt: 0,
  /** Cached layout for the current (rect, pack) so frames don't recompute it. */
  layoutKey: '',
  layoutCache: null as ReturnType<typeof packLayout> | null
}

const LAYER_DEBUG = process.env.MTGA_LAYER_DEBUG === '1'
function layerDebug(msg: string): void {
  if (!LAYER_DEBUG) return
  try { appendFileSync(join(homedir(), '.mtga-tracker', 'layer-debug.log'), `${new Date().toISOString()} ${msg}\n`) } catch { /* ignore */ }
}

function badgeLayerActive(): boolean {
  return !!badgeWindow && !badgeWindow.isDestroyed() && badgeWindow.isVisible() &&
    !badgeRuntime.calibrating && !!arenaPoller.lastKnown && !!draftRuntime.lastPack
}

function setPanelFaded(faded: boolean): void {
  if (layerRuntime.panelFaded === faded) return
  layerRuntime.panelFaded = faded
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.setOpacity(faded ? 0 : 1)
}

function sendLayerState(cells: number[], regions: Array<{ x: number; y: number; width: number; height: number }>, covered: boolean): void {
  const key = `${covered ? 1 : 0}|${cells.join(',')}|` +
    regions.map(r => [r.x, r.y, r.width, r.height].map(Math.round).join(',')).join(';')
  if (key === layerRuntime.lastKey) return
  layerRuntime.lastKey = key
  badgeWindow?.webContents.send('badge-layer', { cells, regions, covered })
}

function resetLayerBaseline(): void {
  layerRuntime.baseline = null
  layerRuntime.baselineLum = 0
  layerRuntime.baselineCardness = 0
}

function currentLayout(rect: ArenaRect, count: number): ReturnType<typeof packLayout> {
  const key = `${rect.width}x${rect.height}:${count}:${badgeRuntime.calibrating ? 'c' : 'p'}`
  if (layerRuntime.layoutKey !== key || !layerRuntime.layoutCache) {
    layerRuntime.layoutKey = key
    layerRuntime.layoutCache = packLayout({ width: rect.width, height: rect.height }, count, resolveBadgeConfig(rect))
  }
  return layerRuntime.layoutCache
}

function panelRectIn(rect: ArenaRect): { x: number; y: number; width: number; height: number } | null {
  if (!overlayWindow || overlayWindow.isDestroyed() || !isOverlayPresented(overlayWindow)) return null
  const b = overlayWindow.getBounds()
  return { x: b.x - rect.x, y: b.y - rect.y, width: b.width, height: b.height }
}

function clearLayerState(): void {
  sendLayerState([], [], false)
  setPanelFaded(false)
}

/**
 * Frame-driven layer detection: called for every helper frame (≤12 fps, only
 * when Arena's content changed). Decides which badges Arena's own UI is drawn
 * over — hover previews of any shape, modal scrims, or no pack on screen.
 */
function onArenaFrame(hf: HelperFrame): void {
  layerRuntime.lastFrameAt = Date.now()
  if (!badgeLayerActive()) { clearLayerState(); return }
  const rect = arenaPoller.lastKnown!
  const pack = draftRuntime.lastPack!
  const view = { width: rect.width, height: rect.height }
  const layout = currentLayout(rect, pack.cards.length)
  const cellRects = layout.cards.map(c => c.card)
  const cursor = screen.getCursorScreenPoint()
  const local = { x: cursor.x - rect.x, y: cursor.y - rect.y }
  const hoveredIdx = hoveredCardIndex(local, cellRects)
  const panel = panelRectIn(rect)

  const frame = frameFromBytes(hf.width, hf.height, hf.data)
  const fsize = { width: frame.width, height: frame.height }
  const packPx = scaleRect(layout.pack, view, fsize)
  const cellsPx = cellRects.map(r => scaleRect(r, view, fsize))
  const panelPx = panel ? scaleRect(panel, view, fsize) : null
  const result = detectOcclusion(frame, layerRuntime.baseline, packPx, cellsPx, panelPx)

  const packLum = meanLum(frame, packPx)
  const score = cardness(frame, packPx, cellsPx) ?? 0
  const packOnScreen = score >= CARDNESS_MIN && packLum !== null && packLum >= ABS_DARK_FLOOR
  if (LAYER_DEBUG) { const b = badgeWindow!.getBounds(); layerDebug(`badgeWin ${b.x},${b.y} ${b.width}x${b.height} arena ${rect.x},${rect.y} ${rect.width}x${rect.height} opacity=${badgeWindow!.getOpacity()} pack=${pack.cards.length} scores=${draftRuntime.lastScores ? 'y' : 'n'}`) }
  layerDebug(`frame ${frame.width}x${frame.height} hovered=${hoveredIdx} lum=${packLum?.toFixed(1)} base=${layerRuntime.baselineLum.toFixed(1)} cardness=${score.toFixed(1)} covered=${result.packCovered} cells=[${result.coveredCells}] panel=${result.extraCovered}`)

  const sizeChanged = layerRuntime.baseline !== null &&
    (frame.width !== layerRuntime.baseline.width || frame.height !== layerRuntime.baseline.height)
  if (packOnScreen && hoveredIdx < 0 &&
      (layerRuntime.baseline === null || sizeChanged || score >= layerRuntime.baselineCardness * 0.9)) {
    layerRuntime.baseline = frame
    layerRuntime.baselineLum = packLum!
    layerRuntime.baselineCardness = score
  }

  if (!packOnScreen && (hoveredIdx < 0 || result.packCovered)) {
    sendLayerState([], [], true)
    setPanelFaded(result.packCovered)
    return
  }
  if (layerRuntime.baseline) {
    const cells = result.coveredCells.filter(i => i !== hoveredIdx)
    sendLayerState(cells, [], result.packCovered)
    setPanelFaded(result.extraCovered || result.packCovered)
    return
  }
  // No baseline yet: prediction until one is captured.
  predictionTick(hoveredIdx, cellRects, view, panel)
}

function predictionTick(
  hoveredIdx: number,
  cellRects: Array<{ x: number; y: number; width: number; height: number }>,
  view: { width: number; height: number },
  panel: { x: number; y: number; width: number; height: number } | null
): void {
  const regions = hoveredIdx >= 0 ? predictPopout(cellRects[hoveredIdx], view) : []
  sendLayerState([], regions, false)
  setPanelFaded(!!panel && regions.some(r => intersects(r, panel!)))
}

/**
 * Fallback tick (10Hz) when no frame stream is available (no Screen Recording
 * / helper missing): cursor-driven prediction. Also clears state when badges
 * go away without a final frame.
 */
function layerFallbackTick(): void {
  if (!badgeLayerActive()) { clearLayerState(); return }
  if (Date.now() - layerRuntime.lastFrameAt < 1500) return // stream is live
  const rect = arenaPoller.lastKnown!
  const pack = draftRuntime.lastPack!
  const view = { width: rect.width, height: rect.height }
  const layout = currentLayout(rect, pack.cards.length)
  const cellRects = layout.cards.map(c => c.card)
  const cursor = screen.getCursorScreenPoint()
  const hoveredIdx = hoveredCardIndex({ x: cursor.x - rect.x, y: cursor.y - rect.y }, cellRects)
  predictionTick(hoveredIdx, cellRects, view, panelRectIn(rect))
}

function meanLum(frame: GrayFrame, r: { x: number; y: number; width: number; height: number }): number | null {
  const x0 = Math.max(0, Math.floor(r.x)), y0 = Math.max(0, Math.floor(r.y))
  const x1 = Math.min(frame.width, Math.ceil(r.x + r.width)), y1 = Math.min(frame.height, Math.ceil(r.y + r.height))
  if (x1 <= x0 || y1 <= y0) return null
  let sum = 0, n = 0
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { sum += frame.data[y * frame.width + x]; n++ }
  return n ? sum / n : null
}

function setupLayerAwareness(): void {
  arenaPoller.on('frame', (frame: HelperFrame) => onArenaFrame(frame))
  arenaPoller.on('capture', () => refreshStatusTray())
  if (!layerRuntime.fallbackTimer) layerRuntime.fallbackTimer = setInterval(layerFallbackTick, 100)
}

/** Wire the geometry poller once: bounds-follow, hide-on-lost, setup card. */
function setupArenaGeometry(): void {
  let lastBadgeSize = ''
  arenaPoller.on('geometry', (rect: ArenaRect) => {
    if (badgeWindow && !badgeWindow.isDestroyed()) {
      setBadgeWindowRect(badgeWindow, rect)
      // The calibration config only depends on the window SIZE; a pure move at
      // 30Hz must not re-send it (each send is a full badge re-render).
      const sizeKey = `${rect.width}x${rect.height}`
      if (sizeKey !== lastBadgeSize) {
        lastBadgeSize = sizeKey
        pushBadgeView()
      }
      if (badgesWantedNow()) {
        const wasVisible = badgeWindow.isVisible()
        showBadgeWindow(badgeWindow)
        if (!wasVisible) resyncBadgeWindow() // it saw no events while hidden
      }
    }
    panelFollow.handleGeometry(rect)
    if (badgeRuntime.calibrating) sendCalibrateState()
  })

  arenaPoller.on('frontmost', (front: boolean) => {
    if (!badgeWindow || badgeWindow.isDestroyed()) return
    if (!front) {
      if (!badgeRuntime.calibrating) hideBadgeWindow(badgeWindow)
    } else if (badgesWantedNow() && arenaPoller.lastKnown) {
      const wasVisible = badgeWindow.isVisible()
      showBadgeWindow(badgeWindow)
      if (!wasVisible) resyncBadgeWindow()
    }
  })

  arenaPoller.on('lost', () => {
    if (badgeWindow) hideBadgeWindow(badgeWindow)
    panelFollow.handleLost()
    if (badgeRuntime.calibrating) sendCalibrateState()
  })

  arenaPoller.on('accessibility-missing', () => {
    badgeRuntime.accessibilityIssue = true
    console.warn('[Badges] Accessibility permission missing — cannot locate the Arena window')
    if (badgeRuntime.calibrating) sendCalibrateState()
  })
}

/** Push the overlay's visibility into the menu-bar state + follow machinery. */
function sendOverlayVisibility(): void {
  refreshStatusTray()
  syncArenaPollerDemand()
  panelFollow.refresh()
}

function refreshStatusTray(): void {
  if (!statusTray) return
  const snapshot = draftRuntime.session
  const pack = draftRuntime.lastPack
  statusTray.update({
    serverStatus: draftRuntime.serverStatus.status,
    model: draftRuntime.serverStatus.model?.id ?? null,
    draft: snapshot?.state === 'active'
      ? {
          set: snapshot.set,
          format: snapshot.format,
          pack: pack?.pack ?? null,
          pick: pack?.pick ?? null
        }
      : null,
    overlayVisible: isOverlayPresented(overlayWindow),
    followArena: getOverlayUiPrefs().followArena,
    badgesEnabled: badgesEnabled(),
    layerDetection: arenaPoller.captureOn || screenCaptureGranted()
  })
}

/** Tray/prefs toggle for gluing the panel to the Arena window. */
function setFollowArenaPref(enabled: boolean): void {
  setOverlayUiPrefs({ followArena: enabled })
  syncArenaPollerDemand()
  panelFollow.refresh()
  refreshStatusTray()
}

function toggleOverlayFromTray(): void {
  if (!overlayWindow || overlayWindow.isDestroyed()) return
  if (isOverlayPresented(overlayWindow)) hideOverlay(overlayWindow)
  else activateOverlay(overlayWindow)
  sendOverlayVisibility()
}

function showOverlayFromAppSurface(): void {
  if (!overlayWindow || overlayWindow.isDestroyed()) return
  activateOverlay(overlayWindow)
  sendOverlayVisibility()
}

function setupStatusTray(): void {
  statusTray = new StatusTray({
    showOverlay: showOverlayFromAppSurface,
    toggleOverlay: toggleOverlayFromTray,
    calibrateBadges: startBadgeCalibration,
    toggleBadges: () => toggleBadges(),
    grantScreenRecording: () => {
      void shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture')
    },
    toggleFollowArena: () => setFollowArenaPref(!getOverlayUiPrefs().followArena)
  })
  refreshStatusTray()
}

/**
 * Create all application windows
 */
async function createWindows(): Promise<void> {
  overlayWindow = createOverlayWindow()
  // Initial launch is a deliberate app action: focus the panel so the native
  // Cmd+W/Cmd+M/Cmd+Q menu commands work immediately. Later draft events use
  // showOverlay/showInactive and never steal focus from Arena.
  activateOverlay(overlayWindow)

  const interactiveWindow = overlayWindow
  interactiveWindow.on('close', event => {
    if (isQuitting) return
    event.preventDefault()
    hideOverlay(interactiveWindow)
    sendOverlayVisibility()
  })

  // Badge overlay: hidden until a draft is live AND the Arena window is found
  badgeWindow = createBadgeWindow()
  badgeWindow.on('closed', () => {
    badgeWindow = null
  })
  badgeWindow.webContents.on('did-finish-load', () => {
    pushBadgeView()
    if (badgeRuntime.calibrating) sendCalibrateState()
  })

  // The startup replay usually finishes before the overlay page loads, so a
  // 'detailed-logs' send during replay is dropped. Re-send once loaded.
  overlayWindow.webContents.on('did-finish-load', () => {
    if (detailedLogsEnabled === false) {
      overlayWindow?.webContents.send('detailed-logs', { enabled: false })
    }
    // Late-loading renderer missed any 'overlay-scale' pushes
    if (getFollowZoom() !== 1) {
      overlayWindow?.webContents.send('overlay-scale', getFollowZoom())
    }
  })

  overlayWindow.on('show', sendOverlayVisibility)
  overlayWindow.on('hide', sendOverlayVisibility)

  // The initial activateOverlay above ran before these listeners attached:
  // sync the poller demand (glued panel wants geometry from the start).
  syncArenaPollerDemand()
  overlayWindow.on('minimize', sendOverlayVisibility)
  overlayWindow.on('restore', sendOverlayVisibility)

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
    console.log('[Parser] Collection:', Object.keys(data).length, 'cards')

    try {
      updateCollection(data)
    } catch (error) {
      console.error('[DB] Failed to update collection:', error)
    }
  })

  // Match start
  logParser.on('match-start', (data) => {
    // Historical replay must not splash old results / stale state on the panel.
    if (!isReplaying) overlayWindow?.webContents.send('match-start', data)
    currentMatchId = data.matchId
    lastTurnNumber = 0
    lastOpponentLife = 20
    lastPlayerLife = 20

    const previous = pendingMatch?.id === data.matchId ? pendingMatch : null
    const deckName = currentDeckName || logParser?.getCurrentDeckName() || previous?.deckName || null
    console.log('[Parser] Match started:', data.matchId, 'vs', data.opponentName, `(${data.opponentPlatform || '?'})`, 'Deck:', deckName || 'Unknown')

    pendingMatch = {
      id: data.matchId,
      eventId: data.eventId,
      format: data.gameMode || data.eventId,
      deckId: previous?.deckId ?? null,
      deckName,
      opponentName: data.opponentName,
      startedAt: previous?.startedAt ?? new Date(),
      onPlay: data.seatId === 1,
      opponentPlatform: data.opponentPlatform || undefined
    }
  })

  // Match end
  logParser.on('match-end', (data) => {
    // Historical replay must not splash old results / stale state on the panel.
    if (!isReplaying) overlayWindow?.webContents.send('match-end', data)

    // Derive win condition from match reason and game state
    const winCondition = deriveWinCondition(data.result, data.reason, lastOpponentLife, lastPlayerLife)
    console.log('[Parser] Match ended:', data.matchId, 'Result:', data.result, `(${winCondition}) Turn ${lastTurnNumber}`)

    try {
      const completedMatch = pendingMatch
      if (completedMatch && completedMatch.id === data.matchId) {
        insertMatch({
          ...completedMatch,
          result: data.result,
          gameCount: data.gameCount
        })
      }
      updateMatchEnd(data.matchId, data.result, data.gameCount, winCondition, lastTurnNumber)
    } catch (error) {
      console.error('[DB] Failed to update match:', error)
    }

    currentMatchId = null
    if (pendingMatch?.id === data.matchId) pendingMatch = null
  })

  // Game state updates (for deck tracker)
  logParser.on('game-state', (data) => {
    // Historical replay must not splash old results / stale state on the panel.
    if (!isReplaying) overlayWindow?.webContents.send('game-state', data)
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
        if (pendingMatch?.id === currentMatchId) {
          pendingMatch.deckName = data.deckName
          pendingMatch.deckId = data.deckId || pendingMatch.deckId
        }
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
        if (pendingMatch?.id === currentMatchId) {
          pendingMatch.deckName = data.deckName
          pendingMatch.deckId = data.deckId || pendingMatch.deckId
        }
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
      // Local file:// URL once cached; null on a miss (a download is started).
      imageUrl: cachedArtUrl(
        grpId,
        rating?.image_small ?? rating?.image_normal ?? reg?.imageUrl ?? null
      )
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
  sendDraftEvent('server-status', draftRuntime.serverStatus)
}

function updateServerStatus(status?: ServerStatus): void {
  draftRuntime.serverStatus = {
    status: status ?? serverClient?.getStatus() ?? 'red',
    model: draftRuntime.ratingsMeta?.model ?? null,
    stale: draftRuntime.ratingsMeta?.stale ?? false,
    fetchedAt: draftRuntime.ratingsMeta?.fetchedAt ?? null
  }
  if (!isReplaying) sendServerStatus()
  refreshStatusTray()
}

/**
 * One ev_p1p1 per unique card name, sorted ascending. Arena can expose
 * multiple grpIds for alternate art; counting each alias would distort the
 * set-relative grades and conviction percentiles shown by the renderer.
 */
function setEvP1p1Sorted(): number[] | null {
  if (!draftRuntime.ratings || draftRuntime.ratings.size === 0) return null
  const unique = new Map<string, number>()
  for (const card of draftRuntime.ratings.values()) {
    const score = card.ev_p1p1
    if (score === null || score === undefined || !Number.isFinite(score)) continue
    const key = card.name?.trim().toLocaleLowerCase() || `#${card.grp_id}`
    if (!unique.has(key)) unique.set(key, score)
  }
  const evs = Array.from(unique.values()).sort((a, b) => a - b)
  return evs.length > 0 ? evs : null
}

function sendSetRatings(): void {
  if (isReplaying) return
  sendDraftEvent('draft-ratings', { setEvP1p1Sorted: setEvP1p1Sorted() })
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
    if (!isReplaying) {
      sendDraftEvent('draft-pack', refreshed)
      // Scores may already have landed for this pack; a pack refresh must not
      // leave the renderers without them.
      const scores = draftRuntime.lastScores
      if (scores && scores.pack === refreshed.pack && scores.pick === refreshed.pick) {
        sendDraftEvent('draft-scores', scores)
      }
    }
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
  resetLayerBaseline()
  if (!isReplaying) sendDraftEvent('draft-pack', payload)
}

function handleDraftStart(snapshot: DraftSessionSnapshot): void {
  console.log('[Draft] Started:', snapshot.eventName ?? snapshot.draftId ?? 'unknown', snapshot.set, snapshot.format)
  draftRuntime.session = snapshot
  draftRuntime.dbId = null
  draftRuntime.lastPack = null
  draftRuntime.lastScores = null
  draftRuntime.scoresByPick.clear()
  refreshStatusTray()
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
      // Reshape first: sendOverlayVisibility triggers an anchor refresh,
      // which must defer to the settle timer, not read mid-animation bounds
      panelFollow.noteReshape()
      sendOverlayVisibility()
    }
    sendDraftEvent('draft-start', draftStartPayload(snapshot))
    startBadgesForDraft()
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
  refreshStatusTray()

  if (!isReplaying) {
    sendDraftEvent('draft-pack', payload)
    void ensureRatings(snapshot)
    void requestScores(snapshot)
  }
}

/** POST /score for the current pack; re-sort rows when it resolves. */
/** Retry schedule for a missed /score while the same pack is still live. */
const SCORE_RETRY_DELAYS_MS = [700, 1500, 3000, 6000, 12000]

async function requestScores(snapshot: DraftSessionSnapshot): Promise<void> {
  if (!serverClient || !snapshot.currentPack) return
  const { pack, pick, grpIds } = snapshot.currentPack
  const stillLive = (): boolean => {
    const live = draftRuntime.session?.currentPack
    return !!live && live.pack === pack && live.pick === pick
  }

  // Pool excludes what's in this pack: score against picks so far. The first
  // attempt is short (the UI renders from cached stats meanwhile); a miss —
  // e.g. slow .local resolution on the first request after launch — retries
  // with a longer timeout for as long as this pack is the one on screen.
  const req = {
    set: snapshot.set,
    format: snapshot.format ?? 'PremierDraft',
    pack: grpIds,
    pool: snapshot.pool,
    packNumber: pack,
    pickNumber: pick
  }
  console.log(`[Score] request p${pack}p${pick} (${grpIds.length} cards)`)
  let result = await serverClient.score(req)
  for (let attempt = 0; !result && attempt < SCORE_RETRY_DELAYS_MS.length; attempt++) {
    await new Promise(resolve => setTimeout(resolve, SCORE_RETRY_DELAYS_MS[attempt]))
    if (!stillLive() || draftRuntime.lastScores?.pack === pack && draftRuntime.lastScores?.pick === pick) return
    result = await serverClient.score(req, 3000)
  }

  updateServerStatus()
  console.log(`[Score] p${pack}p${pick} ${result ? `ok: ${result.cards.length} cards, model ${result.model?.id}` : 'no result after retries'}`)
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

  // A fast user can pick before /score returns. Re-upsert that pick now that
  // model fields exist; recordDraftPick preserves the original timestamp.
  backfillCompletedDraftPick(
    draftRuntime.session,
    pack,
    pick,
    grpIds,
    persistDraftPick
  )

  // Only surface if this is still the pack on screen
  const live = draftRuntime.session?.currentPack
  if (!isReplaying && live && live.pack === pack && live.pick === pick) {
    sendDraftEvent('draft-scores', payload)
  } else {
    console.log(`[Score] p${pack}p${pick} not surfaced (replaying=${isReplaying}, live=${live ? `p${live.pack}p${live.pick}` : 'none'})`)
  }
}

/**
 * Card art arrives after the rows were already sent, so re-push the live scores
 * with the now-local image URLs. Coalesced: a 14-card pack finishes downloading
 * as 14 separate events and the renderer only needs one repaint.
 */
let artRepublishTimer: NodeJS.Timeout | null = null

function scheduleArtRepublish(): void {
  if (artRepublishTimer) return
  artRepublishTimer = setTimeout(() => {
    artRepublishTimer = null
    const payload = draftRuntime.lastScores
    const live = draftRuntime.session?.currentPack
    if (!payload || !live || live.pack !== payload.pack || live.pick !== payload.pick) return

    sendDraftEvent('draft-scores', {
      ...payload,
      cards: payload.cards.map(card => ({
        ...card,
        imageUrl: cachedArtUrl(card.grpId, null) ?? card.imageUrl
      }))
    })
  }, 400)
}

function persistDraftPick(snapshot: DraftSessionSnapshot, pick: DraftPickRecord): void {
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
}

function handleDraftPick(snapshot: DraftSessionSnapshot, pick: DraftPickRecord): void {
  draftRuntime.session = snapshot
  refreshStatusTray()

  // "My picks vs my model" review data. Human drafts only learn their
  // draftId at the first pick/pack event: ensureDraftDbId migrates any rows
  // written under the provisional id and guarantees the drafts row exists.
  persistDraftPick(snapshot, pick)

  if (!isReplaying) {
    sendDraftEvent('draft-pick', draftPickPayload(snapshot, pick))
  }
}

function handleDraftEnd(snapshot: DraftSessionSnapshot): void {
  console.log('[Draft] Complete:', snapshot.eventName ?? snapshot.draftId, `${snapshot.pool.length} cards`)
  draftRuntime.session = snapshot
  refreshStatusTray()

  try {
    completeDraft(ensureDraftDbId(snapshot), snapshot.pool)
  } catch (error) {
    console.error('[DB] Failed to complete draft:', error)
  }

  if (!isReplaying) {
    sendDraftEvent('draft-end', draftEndPayload(snapshot))
    stopBadgesAfterDraft()
    // The renderer shows a dismissible "draft complete" card and sends
    // 'draft-dismiss' (button or its own 10s timeout). This is only a
    // safety net in case the renderer never does.
    if (draftRuntime.endTimer) clearTimeout(draftRuntime.endTimer)
    draftRuntime.endTimer = setTimeout(() => {
      if (overlayWindow) {
        setOverlayMode(overlayWindow, 'match')
        panelFollow.noteReshape()
      }
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
    panelFollow.noteReshape() // before the visibility refresh reads bounds
    sendOverlayVisibility()
  }
  sendDraftEvent('draft-start', draftStartPayload(snapshot))
  sendDraftEvent('draft-pick', draftPickPayload(snapshot, null))
  startBadgesForDraft()

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
  // NOT userData/cache: on macOS's case-insensitive filesystem that collides
  // with Chromium's own disk cache directory (userData/Cache), and Chromium
  // deletes foreign files there during startup — silently destroying the
  // offline ratings fallback. Keep ratings snapshots in a directory Chromium
  // never touches, migrating any files that survived the old location.
  const cacheDir = join(app.getPath('userData'), 'ratings-cache')
  const legacyDir = join(app.getPath('userData'), 'cache')
  try {
    if (existsSync(legacyDir)) {
      for (const file of readdirSync(legacyDir)) {
        if (file.startsWith('ratings-') && file.endsWith('.json')) {
          mkdirSync(cacheDir, { recursive: true })
          renameSync(join(legacyDir, file), join(cacheDir, file))
        }
      }
    }
  } catch {
    // best-effort migration — worst case is one re-fetch from the server
  }
  // Card art lives in its own directory for the same reason as ratings-cache:
  // Chromium clears foreign files out of userData/cache on startup.
  initCardArtCache(join(app.getPath('userData'), 'card-art'), scheduleArtRepublish)

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
// The overlay is frameless (no native title bar to drag) and passive draft
// updates must never steal focus from Arena, so the renderer drives moves
// and resizes explicitly through these channels. User gestures are reported
// to panelFollow: a drag in progress always beats an Arena-follow move, and
// the anchor is recaptured where the user let go.

ipcMain.handle('overlay-drag-start', () => {
  if (!overlayWindow || overlayWindow.isDestroyed()) return null
  panelFollow.noteUserActivity()
  return overlayWindow.getBounds()
})

ipcMain.on('overlay-move', (_, pos: { x: number; y: number }) => {
  if (overlayWindow && typeof pos?.x === 'number' && typeof pos?.y === 'number') {
    panelFollow.noteUserActivity()
    moveOverlay(overlayWindow, pos.x, pos.y)
  }
})

ipcMain.on('overlay-move-end', () => {
  if (overlayWindow) {
    saveOverlayBounds(overlayWindow)
    panelFollow.noteUserGestureEnd()
  }
})

ipcMain.handle('overlay-resize-start', () => {
  if (!overlayWindow || overlayWindow.isDestroyed()) return null
  panelFollow.noteUserActivity()
  return overlayWindow.getBounds()
})

ipcMain.on('overlay-resize', (_, size: { width?: number; height?: number }) => {
  if (overlayWindow && size) {
    panelFollow.noteUserActivity()
    resizeOverlay(overlayWindow, size, false)
  }
})

ipcMain.on('overlay-resize-end', () => {
  if (overlayWindow) {
    saveOverlayBounds(overlayWindow)
    panelFollow.noteUserGestureEnd()
  }
})

// Content-height sync: in verdict/mini densities the renderer measures the
// panel and asks the window to match. Anchored at the Arena-glued corner
// when one exists (a bottom-docked panel grows upward), else top-left.
ipcMain.on('overlay-set-size', (_, size: { width?: number | null; height?: number | null; animate?: boolean }) => {
  if (overlayWindow && size) {
    resizeOverlay(
      overlayWindow,
      { width: size.width, height: size.height },
      !!size.animate,
      panelFollow.getAnchorSides()
    )
  }
})

ipcMain.on('overlay-density', (_, data: { density?: string }) => {
  const density: DraftDensity =
    data?.density === 'full' || data?.density === 'mini' ? data.density : 'verdict'
  applyDraftDensity(overlayWindow, density)
  panelFollow.noteReshape()
})

ipcMain.handle('overlay-get-prefs', () => getOverlayUiPrefs())

ipcMain.on('overlay-set-prefs', (_, patch: { autoHideDashboard?: boolean; followArena?: boolean }) => {
  if (patch && typeof patch.autoHideDashboard === 'boolean') {
    setOverlayUiPrefs({ autoHideDashboard: patch.autoHideDashboard })
  }
  if (patch && typeof patch.followArena === 'boolean') {
    setFollowArenaPref(patch.followArena)
  }
})

// The X on the grip hides the overlay; the Dock or menu-bar item reopens it.
ipcMain.on('overlay-hide', () => {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    hideOverlay(overlayWindow)
  }
})

// Overlay visibility toggle retained for the preload API and test harness.
ipcMain.handle('overlay-toggle', () => {
  if (!overlayWindow || overlayWindow.isDestroyed()) return false
  if (isOverlayPresented(overlayWindow)) {
    hideOverlay(overlayWindow)
    return false
  }
  activateOverlay(overlayWindow)
  return true
})

ipcMain.handle('overlay-visible', () => {
  return isOverlayPresented(overlayWindow)
})

// ============================================================================
// IPC Handlers - Badge overlay (Arena-anchored flame badges) + calibration
// ============================================================================

ipcMain.handle('badges-state', () => ({
  enabled: badgesEnabled(),
  accessibilityIssue: badgeRuntime.accessibilityIssue
}))

ipcMain.handle('badges-toggle', () => toggleBadges())

/** Flip the per-card badge overlay on/off (menu bar + renderer share this). */
function toggleBadges(): boolean {
  const enabled = !badgesEnabled()
  setOverlayUiPrefs({ badgesEnabled: enabled })

  const draftActive = draftRuntime.session?.state === 'active'
  if (enabled && draftActive && !isReplaying) {
    syncArenaPollerDemand()
    autoMiniPanel()
    if (badgeWindow && arenaPoller.lastKnown) {
      setBadgeWindowRect(badgeWindow, arenaPoller.lastKnown)
      pushBadgeView()
      showBadgeWindow(badgeWindow)
      resyncBadgeWindow() // it saw no events while hidden
    }
  } else if (!enabled) {
    stopBadgesAfterDraft() // no-op while calibrating
  }
  refreshStatusTray()
  return enabled
}

// Dashboard setup card's "Test again" button (Accessibility permission)
ipcMain.handle('badges-test-access', async () => {
  // pollOnce dedups against an in-flight poller tick and returns null on the
  // collision — now that the poller runs near-constantly, probe directly so
  // the "test again" button never misreports a working setup as broken.
  const probe = (await arenaPoller.pollOnce()) ?? (await probeArenaWindow())
  const ok = probe.status !== 'no-accessibility'
  if (ok) badgeRuntime.accessibilityIssue = false
  return { ok, arenaFound: probe.status === 'found' }
})

// Dashboard button + View menu entry
ipcMain.handle('badges-calibrate-start', () => {
  startBadgeCalibration()
  return true
})

// Helper-panel nudge/scale buttons (live ghost updates)
ipcMain.on('calibrate-adjust', (_, op: unknown) => {
  if (!badgeRuntime.calibrating || !op || typeof op !== 'object') return
  const base = badgeRuntime.calibrateConfig ?? resolveBadgeConfig(arenaPoller.lastKnown)
  badgeRuntime.calibrateConfig = applyCalibrationOp(base, op as CalibrationOp)
  sendCalibrateState()
})

ipcMain.on('calibrate-count', (_, data: { count?: number }) => {
  if (!badgeRuntime.calibrating) return
  const count = data?.count
  badgeRuntime.calibrateCount = count === 13 || count === 15 ? count : 14
  sendCalibrateState()
})

ipcMain.on('calibrate-save', () => endBadgeCalibration(true))
ipcMain.on('calibrate-cancel', () => endBadgeCalibration(false))

// Renderer dismissed the end-of-draft card (button click or its 10s timeout)
ipcMain.on('draft-dismiss', () => {
  if (draftRuntime.endTimer) {
    clearTimeout(draftRuntime.endTimer)
    draftRuntime.endTimer = null
  }
  if (overlayWindow) {
    setOverlayMode(overlayWindow, 'match')
    panelFollow.noteReshape()
  }
})

// ============================================================================
// Application Lifecycle
// ============================================================================

app.whenReady().then(async () => {
  if (process.platform === 'darwin') {
    // Remain a normal foreground Mac application. The packaged app deliberately
    // does not call dock.show() or dock.setIcon(): AppKit owns one stable bundle
    // icon for both running and stopped states, so launch/quit cannot swap or
    // rescale the pinned Dock item.
    app.setActivationPolicy('regular')
    if (!app.isPackaged) {
      const dockIconPath = join(app.getAppPath(), 'build', 'icon.png')
      try {
        await app.dock.setIcon(dockIconPath)
      } catch (error) {
        console.error('[App] Failed to set development Dock icon:', error)
      }
    }
  }

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
  // View → Calibrate Badges, Window roles — plain Mac app behavior.
  installApplicationMenu({
    onShowOverlay: showOverlayFromAppSurface,
    onCloseOverlay: () => {
      if (overlayWindow && !overlayWindow.isDestroyed()) hideOverlay(overlayWindow)
    },
    onCalibrateBadges: startBadgeCalibration,
    onCycleDensity: () => overlayWindow?.webContents.send('density-cycle')
  })
  setupStatusTray()

  // Start services
  setupServerClient()
  setupLogParser()
  setupLogWatcher()
  setupArenaGeometry()
  setupLayerAwareness()
  await createWindows()

  // macOS: Dock icon click reopens the overlay without stealing Arena focus.
  app.on('activate', () => {
    showOverlayFromAppSurface()
  })
})

// The menu-bar item keeps the app alive while the overlay is hidden.
app.on('window-all-closed', () => {
  if (!statusTray) app.quit()
})

app.on('before-quit', event => {
  if (!quitCommitted) {
    event.preventDefault()
    if (quitCommitTimer) return

    isQuitting = true
    // Make transparent windows fully invisible, then give WindowServer time
    // to commit that frame before Electron destroys their renderer surfaces.
    for (const window of [overlayWindow, badgeWindow]) {
      if (!window || window.isDestroyed()) continue
      window.setOpacity(0)
      window.hide()
    }

    quitCommitTimer = setTimeout(() => {
      quitCommitted = true
      app.quit()
    }, 120)
    return
  }

  cleanup()
})

/**
 * Clean up resources before quitting: chokidar watchers + poll timers
 * (logWatcher.stop), server retry loop (serverClient.stop), Arena geometry
 * poller, pending draft timer, sqlite handle. Windows are torn down by
 * app.quit() itself.
 */
function cleanup(): void {
  if (overlayWindow && !overlayWindow.isDestroyed()) saveOverlayBounds(overlayWindow)
  logWatcher?.stop()
  serverClient?.stop()
  arenaPoller.stop()
  panelFollow.dispose()
  statusTray?.destroy()
  statusTray = null
  if (draftRuntime.endTimer) {
    clearTimeout(draftRuntime.endTimer)
    draftRuntime.endTimer = null
  }
  if (quitCommitTimer) {
    clearTimeout(quitCommitTimer)
    quitCommitTimer = null
  }
  closeDatabase()
}

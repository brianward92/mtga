/**
 * MTGA Draft Assistant — main process.
 *
 * A menu-bar app with ONE overlay window glued to Arena. During a draft the
 * overlay draws per-card badges on the pack grid and a corner HUD; the pack is
 * scored locally by the bundled DraftFM model. Nothing here talks to a server.
 *
 * Wiring: LogWatcher → DraftParser (draft events) → DraftCoordinator (state)
 *         ArenaGeometryPoller (native helper) → overlay bounds + LayerDetector
 *         prefs/tray/shortcuts → user intent
 */
import { app, BrowserWindow, globalShortcut, ipcMain, screen, shell } from 'electron'
import { join } from 'path'
import { writeFileSync } from 'fs'
import { LogWatcher } from './parser/watcher'
import { startDraftLogPipeline } from './parser/pipeline'
import { ArenaGeometryPoller, type ArenaRect } from './arena-geometry'
import { ModelManager } from './model/manager'
import { DraftHistory } from './data/history'
import { DraftCoordinator } from './draft/coordinator'
import { sheetOpenForPhaseTransition } from './draft/completion'
import { createOverlayWindow, setOverlayRect, showOverlay, hideOverlay, setOverlayInteractive } from './overlay/window'
import { LayerDetector } from './overlay/layer'
import { Calibration } from './overlay/calibration'
import { StandAside } from './overlay/stand-aside'
import { screenCaptureGranted } from './overlay/occlusion'
import { OverlayGeometrySync } from './overlay/geometry-sync'
import { badgesAreLive, wantsOverlayContent, type OverlayActivity } from './overlay/activity-policy'
import { loadPrefs, savePrefs } from './prefs'
import { StatusTray } from './status-tray'
import type { DraftState, Prefs } from '../shared/state'
import type { CalibrationOp, Rect } from '../shared/layout'
import { arenaDisplayOrder } from '../shared/display-order'

// ---------------------------------------------------------------------------
// Singletons
// ---------------------------------------------------------------------------

let overlay: BrowserWindow | null = null
let tray: StatusTray | null = null
let logWatcher: LogWatcher | null = null
let models: ModelManager
let coordinator: DraftCoordinator
let layer: LayerDetector
const calibration = new Calibration()
const standAside = new StandAside()
let standAsideTimer: NodeJS.Timeout | null = null
const poller = new ArenaGeometryPoller()
let quitCommitted = false
let quitTimer: NodeJS.Timeout | null = null
/** Pool & picks section of the rail: open by default during a draft. */
let sheetOpen = true

// ---------------------------------------------------------------------------
// Overlay visibility policy
// ---------------------------------------------------------------------------

/** Snapshot the inputs shared by overlay visibility and capture policy. */
function currentOverlayActivity(): OverlayActivity {
  const prefs = loadPrefs()
  const draft = coordinator.current
  return {
    arenaFound: poller.lastKnown !== null && poller.isFound(),
    arenaFrontmost: poller.arenaFrontmost,
    overlayAvailable: !!overlay && !overlay.isDestroyed(),
    calibrating: calibration.active,
    phase: draft.phase,
    cardCount: draft.cards.length,
    badgesEnabled: prefs.badges,
    hudEnabled: prefs.hud,
    standAside: standAside.active
  }
}

/**
 * Poll the cursor while the overlay is up: reaching into Arena's top menu bar
 * (Options, Packs, Store…) makes the overlay stand aside until the draft moves
 * on. Arena draws its menus inside its own window, so stepping out of the way
 * is the only way to let them win.
 */
function standAsideTick(): void {
  const rect = poller.lastKnown
  if (!rect || calibration.active) return
  const cursor = screen.getCursorScreenPoint()
  const local = { x: cursor.x - rect.x, y: cursor.y - rect.y }
  if (standAside.sample(local, rect, Date.now())) syncOverlay()
}

/** The draft moved on (or the user asked for it back): show the overlay again. */
function releaseStandAside(): void {
  if (standAside.release()) syncOverlay()
}

function isOverlayContentWanted(): boolean { return wantsOverlayContent(currentOverlayActivity()) }

function areBadgesLive(): boolean { return badgesAreLive(currentOverlayActivity()) }

function syncOverlay(): void {
  overlayGeometrySync.sync()
}

const overlayGeometrySync = new OverlayGeometrySync({
  targetAvailable: () => !!overlay && !overlay.isDestroyed(),
  arenaFound: () => poller.isFound(),
  arenaRect: () => poller.lastKnown,
  arenaFrontmost: () => poller.arenaFrontmost,
  contentWanted: isOverlayContentWanted,
  setRect: rect => { if (overlay) setOverlayRect(overlay, rect) },
  show: () => { if (overlay) showOverlay(overlay) },
  hide: () => { if (overlay) hideOverlay(overlay) },
  afterSync: () => {
    // Cursor polling is useful only while badge geometry is live.
    layer?.syncActivity()
    // Window capture only while badges need layer awareness.
    poller.setCapture(loadPrefs().layerDetection && areBadgesLive())
  }
})

// ---------------------------------------------------------------------------
// Pushes to the renderer
// ---------------------------------------------------------------------------

function send(channel: string, payload: unknown): void {
  if (!overlay || overlay.isDestroyed()) return
  overlay.webContents.send(channel, payload)
}

let lastPickKey = ''

function pushState(state: DraftState): void {
  // A new pack or pick means the drafter is back at the table.
  const pickKey = `${state.phase}:${state.pack}:${state.pick}`
  if (pickKey !== lastPickKey) { lastPickKey = pickKey; releaseStandAside() }
  send('overlay:state', state)
  syncOverlay()
  refreshTray()
  mirrorState(state)
}

/**
 * Dev seam: MTGA_STATE_FILE=path mirrors every DraftState push to disk, plus
 * the Arena rect the overlay is using (window mode agnostic — the development
 * picker needs the same rect we do, including full screen).
 */
function mirrorState(state: DraftState): void {
  const file = process.env.MTGA_STATE_FILE
  if (!file) return
  try {
    writeFileSync(file, JSON.stringify({ ...state, arena: poller.lastKnown, standAside: standAside.active }))
  } catch { /* dev only */ }
}

function pushPrefs(prefs: Prefs): void {
  send('overlay:prefs', prefs)
  syncOverlay()
  refreshTray()
}

function pushCalibrate(): void {
  send('overlay:calibrate', calibration.state(poller.lastKnown, poller.isFound()))
  syncOverlay()
}

function refreshTray(): void {
  tray?.update({
    draft: coordinator.current,
    prefs: loadPrefs(),
    layerDetectionAvailable: poller.captureOn || screenCaptureGranted(),
    arenaFound: poller.isFound() && poller.lastKnown !== null
  })
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function setupModelAndDraft(): void {
  const userData = app.getPath('userData')
  models = new ModelManager(join(userData, 'model-cache'), process.env.MTGA_BUNDLE_DIR || undefined)
  coordinator = new DraftCoordinator(models, new DraftHistory(join(userData, 'draft-history.jsonl')))
  let previousPhase = coordinator.current.phase
  coordinator.on('state', (state: DraftState) => {
    const completionSheetOpen = sheetOpenForPhaseTransition(previousPhase, state.phase, sheetOpen)
    previousPhase = state.phase
    if (completionSheetOpen !== sheetOpen) setSheetOpen(completionSheetOpen)
    pushState(state)
    if (state.phase !== 'active') layer.resetBaseline()
  })
  coordinator.on('state', (() => {
    let lastPackKey = ''
    return (state: DraftState) => {
      const key = `${state.pack}-${state.pick}-${state.cards.length}`
      if (key !== lastPackKey) { lastPackKey = key; layer.resetBaseline() }
    }
  })())
}

function setupGeometry(): void {
  poller.on('geometry', () => {
    // Dragging or resizing Arena must never leave the overlay hidden: grabbing
    // the title bar puts the cursor near Arena's menu band.
    standAside.noteWindowMoved(Date.now())
    syncOverlay()
    refreshTray()
  })
  poller.on('lost', () => { syncOverlay(); refreshTray() })
  poller.on('frontmost', () => syncOverlay())
  poller.on('capture', () => refreshTray())
  standAsideTimer = setInterval(standAsideTick, 120)
  poller.on('helper-missing', () => coordinator.setWarning('Window helper missing from the app bundle — overlay cannot locate Arena'))
  poller.start()

  layer = new LayerDetector({
    poller,
    packCount: () => coordinator.current.cards.length,
    names: () => {
      const cards = coordinator.current.cards
      return arenaDisplayOrder(cards).map(i => cards[i].name)
    },
    config: (rect: ArenaRect) => calibration.configFor(rect),
    active: () => areBadgesLive() && !calibration.active
  })
  layer.on('change', state => send('overlay:layer', state))
  layer.syncActivity()
  calibration.on('change', () => pushCalibrate())
}

function setupIpc(): void {
  ipcMain.handle('overlay:get-state', () => coordinator.current)
  ipcMain.handle('overlay:get-prefs', () => loadPrefs())
  ipcMain.on('overlay:interactive', (_e, on: boolean) => { if (overlay) setOverlayInteractive(overlay, !!on) })
  ipcMain.on('overlay:hud-rect', (_e, rect: Rect | null) => layer.setHudRect(rect && typeof rect === 'object' ? rect : null))
  ipcMain.on('overlay:action', (_e, msg: { name?: string; data?: unknown }) => {
    switch (msg?.name) {
      case 'toggle-badges': pushPrefs(savePrefs({ badges: !loadPrefs().badges })); break
      case 'toggle-hud': pushPrefs(savePrefs({ hud: !loadPrefs().hud })); break
      case 'set-hud-corner': {
        const c = (msg.data as { corner?: Prefs['hudCorner'] })?.corner
        if (c) pushPrefs(savePrefs({ hudCorner: c }))
        break
      }
      case 'dismiss': coordinator.idle(); break
      case 'calibrate-start': calibration.start(poller.lastKnown); break
      case 'calibrate-op': calibration.adjust(msg.data as CalibrationOp, poller.lastKnown); break
      case 'calibrate-count': calibration.setCount(Number((msg.data as { count?: number })?.count)); break
      case 'calibrate-finish': calibration.finish(!!(msg.data as { save?: boolean })?.save, poller.lastKnown); break
      case 'open-screen-recording': openScreenRecordingSettings(); break
      case 'quit': app.quit(); break
      default: console.warn('[IPC] unknown action', msg?.name)
    }
  })
}

function setSheetOpen(open: boolean): void {
  sheetOpen = open
  send('overlay:command', { name: 'toggle-sheet', data: { open: sheetOpen } })
}

function openScreenRecordingSettings(): void {
  void shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture')
}

function setupTray(): void {
  tray = new StatusTray({
    toggleBadges: () => pushPrefs(savePrefs({ badges: !loadPrefs().badges })),
    toggleHud: () => pushPrefs(savePrefs({ hud: !loadPrefs().hud })),
    toggleLayerDetection: () => pushPrefs(savePrefs({ layerDetection: !loadPrefs().layerDetection })),
    calibrate: () => calibration.start(poller.lastKnown),
    openScreenRecordingSettings
  })
  refreshTray()
}

function setupShortcuts(): void {
  // The overlay is never focused; these are global by necessity.
  globalShortcut.register('CommandOrControl+Shift+B', () => {
    releaseStandAside()
    pushPrefs(savePrefs({ badges: !loadPrefs().badges }))
  })
}

async function createOverlay(): Promise<void> {
  overlayGeometrySync.reset()
  overlay = createOverlayWindow()
  overlay.webContents.on('did-finish-load', () => {
    send('overlay:state', coordinator.current)
    send('overlay:prefs', loadPrefs())
    send('overlay:command', { name: 'toggle-sheet', data: { open: sheetOpen } })
    pushCalibrate()
    syncOverlay()
  })
  overlay.on('closed', () => {
    overlayGeometrySync.reset()
    overlay = null
    layer?.syncActivity()
    poller.setCapture(false)
  })
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

// Test seam: an isolated userData (the single-instance lock lives there too).
if (process.env.MTGA_USER_DATA) app.setPath('userData', process.env.MTGA_USER_DATA)

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.whenReady().then(async () => {
    if (process.platform === 'darwin') app.dock?.hide() // menu-bar app; the overlay never wants a Dock presence
    setupModelAndDraft()
    setupGeometry()
    setupIpc()
    await createOverlay()
    setupTray()
    setupShortcuts()
    logWatcher = startDraftLogPipeline(coordinator)
  })
}

app.on('window-all-closed', () => { /* the tray keeps us alive */ })

app.on('before-quit', event => {
  if (quitCommitted) { cleanup(); return }
  event.preventDefault()
  if (quitTimer) return
  // Let the transparent overlay commit an invisible frame before teardown.
  if (overlay && !overlay.isDestroyed()) { overlay.setOpacity(0); overlay.hide() }
  quitTimer = setTimeout(() => { quitCommitted = true; app.quit() }, 120)
})

function cleanup(): void {
  if (standAsideTimer) { clearInterval(standAsideTimer); standAsideTimer = null }
  overlayGeometrySync.dispose()
  globalShortcut.unregisterAll()
  layer?.dispose()
  // Stop event sources BEFORE tearing down their consumers (tray) so a final
  // helper 'exit' cannot land on a destroyed Tray.
  poller.removeAllListeners()
  poller.stop()
  logWatcher?.stop()
  tray?.destroy()
  tray = null
}

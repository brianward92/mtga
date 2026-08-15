import { BrowserWindow, screen } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { homedir } from 'os'
import {
  AnchorSides,
  PANEL_MIN_HEIGHT as MIN_HEIGHT,
  PANEL_MIN_WIDTH as MIN_WIDTH,
  Rect,
  clampPanelSize,
  snapAxis,
  snapCandidates
} from './panel-anchor'

// Position storage file location
const CONFIG_DIR = join(homedir(), '.mtga-tracker')
const POSITION_FILE = join(CONFIG_DIR, 'overlay-position.json')

interface OverlayPosition {
  x: number
  y: number
  width: number
  height: number
}

export type OverlayMode = 'match' | 'draft'

/** Draft panel densities (renderer cycles these; main persists + sizes the window). */
export type DraftDensity = 'verdict' | 'full' | 'mini'

/** UI preferences persisted alongside the per-mode bounds. */
export interface OverlayUiPrefs {
  draftDensity: DraftDensity
  autoHideDashboard: boolean
  /** Arena-anchored badge overlay (flame chips drawn on the pack cards). */
  badgesEnabled: boolean
  /** Glue the panel to the Arena window: follow moves, rescale on resize. */
  followArena: boolean
}

/**
 * Per-mode saved bounds ({match, draft}) plus UI prefs and badge overlay
 * calibrations (keyed by Arena-window aspect bucket); legacy flat files
 * migrate to match.
 */
interface StoredPositions {
  match?: OverlayPosition
  draft?: OverlayPosition
  ui?: Partial<OverlayUiPrefs>
  badgeCalibrations?: Record<string, Record<string, unknown>>
}

// Manual drag/resize limits live in panel-anchor.ts (pure, shared with the
// Arena-follow math); the renderer drives moves/resizes through IPC so the
// frameless panel has predictable grips — clamp whatever it asks for.

/** Width of the draft panel in verdict/mini densities (full uses saved bounds). */
export const COMPACT_DRAFT_WIDTH = 300
const DEFAULT_VERDICT_HEIGHT = 300
const DEFAULT_MINI_HEIGHT = 64

let currentMode: OverlayMode = 'match'
let draftDensity: DraftDensity = 'verdict'

function isWithinDisplays(position: OverlayPosition): boolean {
  const displays = screen.getAllDisplays()
  return displays.some(display => {
    const { x, y, width, height } = display.bounds
    return (
      position.x >= x &&
      position.x < x + width &&
      position.y >= y &&
      position.y < y + height
    )
  })
}

/**
 * Load saved overlay positions from disk.
 * Handles the legacy flat {x,y,width,height} format (migrated to match mode).
 */
function loadStoredPositions(): StoredPositions {
  try {
    if (existsSync(POSITION_FILE)) {
      const data = JSON.parse(readFileSync(POSITION_FILE, 'utf-8')) as Record<string, unknown>

      if (typeof data.x === 'number') {
        // Legacy flat format
        return { match: data as unknown as OverlayPosition }
      }

      const stored: StoredPositions = {}
      if (data.match) stored.match = data.match as OverlayPosition
      if (data.draft) stored.draft = data.draft as OverlayPosition
      if (data.ui && typeof data.ui === 'object') stored.ui = data.ui as Partial<OverlayUiPrefs>
      if (data.badgeCalibrations && typeof data.badgeCalibrations === 'object') {
        stored.badgeCalibrations = data.badgeCalibrations as Record<string, Record<string, unknown>>
      }
      return stored
    }
  } catch {
    // Ignore errors, use default positions
  }
  return {}
}

function writeStored(stored: StoredPositions): void {
  try {
    if (!existsSync(CONFIG_DIR)) {
      mkdirSync(CONFIG_DIR, { recursive: true })
    }
    writeFileSync(POSITION_FILE, JSON.stringify(stored, null, 2))
  } catch (error) {
    console.error('[Overlay] Failed to save overlay state:', error)
  }
}

function savePosition(mode: OverlayMode, position: OverlayPosition): void {
  const stored = loadStoredPositions()
  stored[mode] = position
  writeStored(stored)
}

function normalizeDensity(value: unknown): DraftDensity {
  return value === 'full' || value === 'mini' ? value : 'verdict'
}

export function getOverlayUiPrefs(): OverlayUiPrefs {
  const ui = loadStoredPositions().ui ?? {}
  return {
    draftDensity: normalizeDensity(ui.draftDensity),
    autoHideDashboard: ui.autoHideDashboard === true,
    badgesEnabled: ui.badgesEnabled === true,
    followArena: ui.followArena !== false // glue to Arena by default
  }
}

export function setOverlayUiPrefs(patch: Partial<OverlayUiPrefs>): void {
  const stored = loadStoredPositions()
  stored.ui = { ...stored.ui, ...patch }
  writeStored(stored)
  if (patch.draftDensity) draftDensity = normalizeDensity(patch.draftDensity)
}

/**
 * Badge overlay calibrations, keyed by Arena-window aspect bucket
 * (renderer/badges/layout.ts owns the shape; this is just the storage).
 */
export function getBadgeCalibrations(): Record<string, Record<string, unknown>> {
  return loadStoredPositions().badgeCalibrations ?? {}
}

export function saveBadgeCalibration(bucket: string, config: Record<string, unknown>): void {
  const stored = loadStoredPositions()
  stored.badgeCalibrations = { ...stored.badgeCalibrations, [bucket]: config }
  writeStored(stored)
}

function defaultBounds(mode: OverlayMode): OverlayPosition {
  const primaryDisplay = screen.getPrimaryDisplay()
  const { width } = primaryDisplay.workAreaSize

  if (mode === 'draft') {
    // 620: tall enough that full density fits the verdict + pack table +
    // pool block + the Pick-history toggle row without clipping the latter.
    return { x: width - 400, y: 80, width: 380, height: 620 }
  }
  return { x: width - 300, y: 100, width: 280, height: 500 }
}

function boundsForMode(mode: OverlayMode): OverlayPosition {
  const stored = loadStoredPositions()[mode]
  if (stored && isWithinDisplays(stored)) return stored
  return defaultBounds(mode)
}

/**
 * Content zoom while glued to Arena (1 = unscaled). Main owns the value; the
 * renderer mirrors it as CSS zoom via the 'overlay-scale' channel. CSS zoom
 * (not webContents.setZoomFactor) keeps the renderer's content-height sync
 * honest: getBoundingClientRect of zoomed content stays in the same DIP
 * space as window bounds.
 */
let followZoom = 1

export function getFollowZoom(): number {
  return followZoom
}

export function setFollowZoom(window: BrowserWindow, zoom: number): void {
  followZoom = zoom
  if (!window.isDestroyed()) {
    window.webContents.send('overlay-scale', zoom)
  }
}

// Arena-follow moves are programmatic: the debounced move/resize save must
// not persist them as the user's chosen spot (poll-frequency write spam,
// Arena-derived coordinates). Timestamp beats a boolean because the window's
// 'move' event arrives async after setBounds.
let lastFollowBoundsAt = 0
const FOLLOW_SAVE_SUPPRESS_MS = 700

/** Bounds applied by the Arena-follow loop (never routed through snapping). */
export function applyFollowBounds(window: BrowserWindow, bounds: Rect): void {
  if (window.isDestroyed()) return
  lastFollowBoundsAt = Date.now()
  window.setBounds({
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.round(bounds.width),
    height: Math.round(bounds.height)
  }, false)
}

function clampSize(width: number, height: number): { width: number; height: number } {
  return clampPanelSize(width, height, followZoom)
}

/** Scale a stored (unzoomed baseline) size for the current content zoom. */
function scaleForZoom(bounds: OverlayPosition): OverlayPosition {
  return {
    x: bounds.x,
    y: bounds.y,
    width: Math.round(bounds.width * followZoom),
    height: Math.round(bounds.height * followZoom)
  }
}

/**
 * Bounds to apply when entering draft mode: the saved draft bounds are the
 * FULL-density size; verdict/mini anchor at the same top-left with a compact
 * fixed width (the renderer fine-tunes the height to its content afterwards).
 */
function draftBoundsForDensity(density: DraftDensity): OverlayPosition {
  const base = boundsForMode('draft')
  if (density === 'full') return base
  return {
    x: base.x,
    y: base.y,
    width: COMPACT_DRAFT_WIDTH,
    height: density === 'mini' ? DEFAULT_MINI_HEIGHT : DEFAULT_VERDICT_HEIGHT
  }
}

/**
 * Persist the window's current bounds for the active mode.
 * In draft verdict/mini densities the height is content-driven and the width
 * fixed, so only x/y are updated — the saved draft size stays the
 * full-density size the user chose. Sizes are stored at zoom 1 (divided out
 * of the current follow zoom) so a restart, which starts unzoomed, restores
 * the size the user actually chose.
 */
export function saveOverlayBounds(window: BrowserWindow): void {
  if (window.isDestroyed()) return
  const bounds = window.getBounds()

  if (currentMode === 'draft' && draftDensity !== 'full') {
    const stored = loadStoredPositions().draft ?? defaultBounds('draft')
    savePosition('draft', { ...stored, x: bounds.x, y: bounds.y })
    return
  }

  savePosition(currentMode, {
    x: bounds.x,
    y: bounds.y,
    width: Math.round(bounds.width / followZoom),
    height: Math.round(bounds.height / followZoom)
  })
}

// Magnetic snapping (candidates + threshold live in panel-anchor.ts): while
// dragging, edges near a screen work-area edge — or the Arena window's edges
// when the geometry poller has a live fix — pull the panel flush.
let snapRectProvider: (() => Rect | null) | null = null

/** Wire a source of the Arena window rect (main wires the geometry poller). */
export function setOverlaySnapRectProvider(provider: () => Rect | null): void {
  snapRectProvider = provider
}

/** Move the window (manual drag: absolute position, already rAF-throttled by renderer). */
export function moveOverlay(window: BrowserWindow, x: number, y: number): void {
  if (window.isDestroyed()) return

  const { width, height } = window.getBounds()
  const display = screen.getDisplayNearestPoint({ x: Math.round(x), y: Math.round(y) })
  const candidates = snapCandidates(
    display.workArea,
    { width, height },
    snapRectProvider?.() ?? null
  )

  window.setPosition(
    Math.round(snapAxis(x, candidates.x)),
    Math.round(snapAxis(y, candidates.y))
  )
}

/**
 * Resize the window, clamped to sane limits. Anchored at the top-left by
 * default (the manual bottom-right grip needs that); programmatic
 * content-height syncs pass the Arena-glued corner instead so a panel docked
 * at Arena's bottom/right edge grows away from that edge, not off it.
 */
export function resizeOverlay(
  window: BrowserWindow,
  size: { width?: number | null; height?: number | null },
  animate = false,
  anchorAt: AnchorSides | null = null
): void {
  if (window.isDestroyed()) return
  const bounds = window.getBounds()
  const target = clampSize(size.width ?? bounds.width, size.height ?? bounds.height)
  if (target.width === bounds.width && target.height === bounds.height) return
  const x = anchorAt?.hSide === 'right' ? bounds.x + bounds.width - target.width : bounds.x
  const y = anchorAt?.vSide === 'bottom' ? bounds.y + bounds.height - target.height : bounds.y
  window.setBounds({ x, y, ...target }, animate)
}

/**
 * Renderer changed the draft density: persist it and re-shape the window
 * (anchored top-left, animated). The renderer follows up with a
 * content-height sync for verdict/mini.
 */
export function applyDraftDensity(window: BrowserWindow | null, density: DraftDensity): void {
  setOverlayUiPrefs({ draftDensity: density })
  if (!window || window.isDestroyed() || currentMode !== 'draft') return

  const bounds = window.getBounds()
  const target = draftBoundsForDensity(density)
  // Keep the panel where the user put it — only the size changes. Stored
  // sizes are the zoom-1 baseline; scale them for the current Arena glue.
  const size = clampSize(target.width * followZoom, target.height * followZoom)
  window.setBounds({ x: bounds.x, y: bounds.y, ...size }, true)
}

export function createOverlayWindow(): BrowserWindow {
  const initial = boundsForMode('match')
  currentMode = 'match'
  draftDensity = getOverlayUiPrefs().draftDensity

  const overlayWindow = new BrowserWindow({
    width: initial.width,
    height: initial.height,
    x: initial.x,
    y: initial.y,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    // CSS owns the panel silhouette. Electron's native corner treatment can
    // expose a bright compositor rim while a transparent window is closing.
    roundedCorners: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    resizable: true,
    minimizable: true,
    maximizable: false,
    closable: true,
    // Passive appearances use showInactive(), so draft updates never steal
    // focus from Arena. A deliberate click can focus the panel, which gives
    // Cmd+M/Cmd+Q their normal native macOS behavior.
    focusable: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: join(__dirname, '../preload/preload.js')
    }
  })

  // The overlay is ALWAYS interactive. There is deliberately no click-through
  // mode: setIgnoreMouseEvents(true) with no visible indicator is how a
  // window becomes "I can't click on anything". Assert the default here.
  overlayWindow.setIgnoreMouseEvents(false)

  // Keep window on top of fullscreen apps (macOS). 'floating' is the
  // recommended overlay level ('screen-saver' can sit above system UI).
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  overlayWindow.setAlwaysOnTop(true, 'floating')

  // Load the overlay HTML
  if (process.env.NODE_ENV === 'development') {
    overlayWindow.loadURL('http://localhost:5173/overlay/')
  } else {
    overlayWindow.loadFile(join(__dirname, '../renderer/overlay/index.html'))
  }

  // Save position (for the active mode) when window is moved or resized —
  // but not when the Arena-follow loop moved it (those are not the user's
  // chosen spot, and they arrive at poll frequency).
  let saveTimeout: NodeJS.Timeout | null = null
  const debouncedSave = () => {
    if (Date.now() - lastFollowBoundsAt < FOLLOW_SAVE_SUPPRESS_MS) return
    if (saveTimeout) {
      clearTimeout(saveTimeout)
    }
    saveTimeout = setTimeout(() => {
      // Re-check: a follow move may have landed after this timer was armed
      if (Date.now() - lastFollowBoundsAt < FOLLOW_SAVE_SUPPRESS_MS) return
      saveOverlayBounds(overlayWindow)
    }, 500)  // Debounce saves by 500ms
  }

  overlayWindow.on('move', debouncedSave)
  overlayWindow.on('resize', debouncedSave)

  // Handle window events
  overlayWindow.on('closed', () => {
    if (saveTimeout) {
      clearTimeout(saveTimeout)
    }
  })

  return overlayWindow
}

/**
 * Switch the overlay between match and draft layouts, saving the current
 * mode's bounds and restoring the target mode's (animated, anchored at the
 * saved top-left so the panel never teleports mid-session).
 */
export function setOverlayMode(window: BrowserWindow, mode: OverlayMode): void {
  if (window.isDestroyed()) return
  if (mode === currentMode) return

  saveOverlayBounds(window)
  currentMode = mode

  const target = scaleForZoom(
    mode === 'draft' ? draftBoundsForDensity(draftDensity) : boundsForMode('match')
  )
  window.setBounds({ x: target.x, y: target.y, ...clampSize(target.width, target.height) }, true)

  // Mode transitions always land interactive — belt and braces
  window.setIgnoreMouseEvents(false)
}

export function getOverlayMode(): OverlayMode {
  return currentMode
}

export function getDraftDensity(): DraftDensity {
  return draftDensity
}

export function showOverlay(window: BrowserWindow): void {
  if (window.isDestroyed()) return
  // A passive draft update must respect an explicit Cmd+M.
  if (window.isMinimized()) return
  if (!window.isVisible()) {
    // showInactive: never steal focus from Arena
    window.showInactive()
  }
  window.setIgnoreMouseEvents(false)
}

/** Restore and focus the panel after an explicit Dock/menu-bar action. */
export function activateOverlay(window: BrowserWindow): void {
  if (window.isDestroyed()) return
  if (window.isMinimized()) window.restore()
  if (!window.isVisible()) window.show()
  window.setIgnoreMouseEvents(false)
  window.focus()
}

/** Whether the panel is presently on screen (minimized is not presented). */
export function isOverlayPresented(window: BrowserWindow | null): boolean {
  return !!window && !window.isDestroyed() && window.isVisible() && !window.isMinimized()
}

export function hideOverlay(window: BrowserWindow): void {
  if (window.isDestroyed()) return
  window.hide()
}

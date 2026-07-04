import { BrowserWindow, screen, globalShortcut } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { homedir } from 'os'

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
}

/**
 * Per-mode saved bounds ({match, draft}) plus UI prefs; legacy flat files
 * migrate to match.
 */
interface StoredPositions {
  match?: OverlayPosition
  draft?: OverlayPosition
  ui?: Partial<OverlayUiPrefs>
}

// Manual drag/resize limits (the window is focusable:false, so the renderer
// drives moves/resizes through IPC — clamp whatever it asks for).
const MIN_WIDTH = 240
const MIN_HEIGHT = 36
const MAX_WIDTH = 720
const MAX_HEIGHT = 1200

/** Width of the draft panel in verdict/mini densities (full uses saved bounds). */
export const COMPACT_DRAFT_WIDTH = 300
const DEFAULT_VERDICT_HEIGHT = 300
const DEFAULT_MINI_HEIGHT = 64

const DENSITY_ACCELERATOR = 'CommandOrControl+M'

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
    autoHideDashboard: ui.autoHideDashboard !== false
  }
}

export function setOverlayUiPrefs(patch: Partial<OverlayUiPrefs>): void {
  const stored = loadStoredPositions()
  stored.ui = { ...stored.ui, ...patch }
  writeStored(stored)
  if (patch.draftDensity) draftDensity = normalizeDensity(patch.draftDensity)
}

function defaultBounds(mode: OverlayMode): OverlayPosition {
  const primaryDisplay = screen.getPrimaryDisplay()
  const { width } = primaryDisplay.workAreaSize

  if (mode === 'draft') {
    return { x: width - 400, y: 80, width: 380, height: 560 }
  }
  return { x: width - 300, y: 100, width: 280, height: 500 }
}

function boundsForMode(mode: OverlayMode): OverlayPosition {
  const stored = loadStoredPositions()[mode]
  if (stored && isWithinDisplays(stored)) return stored
  return defaultBounds(mode)
}

function clampSize(width: number, height: number): { width: number; height: number } {
  return {
    width: Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width))),
    height: Math.round(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, height)))
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
 * full-density size the user chose.
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
    width: bounds.width,
    height: bounds.height
  })
}

/** Move the window (manual drag: absolute position, already rAF-throttled by renderer). */
export function moveOverlay(window: BrowserWindow, x: number, y: number): void {
  if (window.isDestroyed()) return
  window.setPosition(Math.round(x), Math.round(y))
}

/**
 * Resize the window anchored at its top-left corner, clamped to sane limits.
 * Used both by the manual bottom-right resize grip and by the renderer's
 * content-height sync in verdict/mini densities.
 */
export function resizeOverlay(
  window: BrowserWindow,
  size: { width?: number | null; height?: number | null },
  animate = false
): void {
  if (window.isDestroyed()) return
  const bounds = window.getBounds()
  const target = clampSize(size.width ?? bounds.width, size.height ?? bounds.height)
  if (target.width === bounds.width && target.height === bounds.height) return
  window.setBounds({ x: bounds.x, y: bounds.y, ...target }, animate)
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
  const target = density === 'full'
    ? draftBoundsForDensity('full')
    : draftBoundsForDensity(density)
  // Keep the panel where the user put it — only the size changes
  const size = clampSize(target.width, target.height)
  window.setBounds({ x: bounds.x, y: bounds.y, ...size }, true)
}

/**
 * Cmd+M cycles draft densities. The overlay window is focusable:false (it
 * must never steal keystrokes from Arena) so document-level shortcuts can't
 * fire — a global shortcut, registered ONLY while the draft panel is up, is
 * the sole way to offer a keyboard toggle.
 */
function updateDensityShortcut(window: BrowserWindow, mode: OverlayMode): void {
  if (mode === 'draft') {
    if (globalShortcut.isRegistered(DENSITY_ACCELERATOR)) return
    try {
      globalShortcut.register(DENSITY_ACCELERATOR, () => {
        if (!window.isDestroyed()) window.webContents.send('density-cycle')
      })
    } catch {
      // Another app owns the accelerator — the grip button still works
    }
  } else {
    globalShortcut.unregister(DENSITY_ACCELERATOR)
  }
}

export function unregisterOverlayShortcuts(): void {
  globalShortcut.unregister(DENSITY_ACCELERATOR)
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
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    resizable: true,
    minimizable: false,
    maximizable: false,
    closable: true,
    focusable: false,  // Don't steal focus from MTGA
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

  // Save position (for the active mode) when window is moved or resized
  let saveTimeout: NodeJS.Timeout | null = null
  const debouncedSave = () => {
    if (saveTimeout) {
      clearTimeout(saveTimeout)
    }
    saveTimeout = setTimeout(() => {
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
    unregisterOverlayShortcuts()
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
  if (mode === currentMode) {
    updateDensityShortcut(window, mode)
    return
  }

  saveOverlayBounds(window)
  currentMode = mode

  const target = mode === 'draft' ? draftBoundsForDensity(draftDensity) : boundsForMode('match')
  window.setBounds(target, true)

  // Mode transitions always land interactive — belt and braces
  window.setIgnoreMouseEvents(false)
  updateDensityShortcut(window, mode)
}

export function getOverlayMode(): OverlayMode {
  return currentMode
}

export function showOverlay(window: BrowserWindow): void {
  if (window.isDestroyed()) return
  if (!window.isVisible()) {
    // showInactive: never steal focus from Arena
    window.showInactive()
  }
  window.setIgnoreMouseEvents(false)
}

export function hideOverlay(window: BrowserWindow): void {
  if (window.isDestroyed()) return
  window.hide()
}

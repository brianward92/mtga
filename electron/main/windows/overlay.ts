import { BrowserWindow, screen } from 'electron'
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

/** Per-mode saved bounds ({match, draft}); legacy flat files migrate to match. */
interface StoredPositions {
  match?: OverlayPosition
  draft?: OverlayPosition
}

let currentMode: OverlayMode = 'match'

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
      return stored
    }
  } catch {
    // Ignore errors, use default positions
  }
  return {}
}

function savePosition(mode: OverlayMode, position: OverlayPosition): void {
  try {
    if (!existsSync(CONFIG_DIR)) {
      mkdirSync(CONFIG_DIR, { recursive: true })
    }
    const stored = loadStoredPositions()
    stored[mode] = position
    writeFileSync(POSITION_FILE, JSON.stringify(stored, null, 2))
  } catch (error) {
    console.error('[Overlay] Failed to save position:', error)
  }
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

export function createOverlayWindow(): BrowserWindow {
  const initial = boundsForMode('match')
  currentMode = 'match'

  const overlayWindow = new BrowserWindow({
    width: initial.width,
    height: initial.height,
    x: initial.x,
    y: initial.y,
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

  // Note: We don't use setIgnoreMouseEvents so the overlay remains interactive
  // This allows dragging the window and using the minimize button

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
      const bounds = overlayWindow.getBounds()
      savePosition(currentMode, {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height
      })
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
 * mode's bounds and restoring the target mode's.
 */
export function setOverlayMode(window: BrowserWindow, mode: OverlayMode): void {
  if (mode === currentMode || window.isDestroyed()) return

  const bounds = window.getBounds()
  savePosition(currentMode, bounds)
  currentMode = mode

  window.setBounds(boundsForMode(mode))
}

export function getOverlayMode(): OverlayMode {
  return currentMode
}

export function showOverlay(window: BrowserWindow): void {
  window.show()
}

export function hideOverlay(window: BrowserWindow): void {
  window.hide()
}

export function setOverlayInteractive(window: BrowserWindow, interactive: boolean): void {
  window.setIgnoreMouseEvents(!interactive, { forward: true })
}

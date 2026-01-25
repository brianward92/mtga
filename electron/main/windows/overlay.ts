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

/**
 * Load saved overlay position from disk
 */
function loadOverlayPosition(): OverlayPosition | null {
  try {
    if (existsSync(POSITION_FILE)) {
      const data = readFileSync(POSITION_FILE, 'utf-8')
      const position = JSON.parse(data) as OverlayPosition

      // Validate the position is within screen bounds
      const displays = screen.getAllDisplays()
      const validPosition = displays.some(display => {
        const { x, y, width, height } = display.bounds
        return (
          position.x >= x &&
          position.x < x + width &&
          position.y >= y &&
          position.y < y + height
        )
      })

      if (validPosition) {
        return position
      }
    }
  } catch {
    // Ignore errors, use default position
  }
  return null
}

/**
 * Save overlay position to disk
 */
function saveOverlayPosition(position: OverlayPosition): void {
  try {
    if (!existsSync(CONFIG_DIR)) {
      mkdirSync(CONFIG_DIR, { recursive: true })
    }
    writeFileSync(POSITION_FILE, JSON.stringify(position, null, 2))
  } catch (error) {
    console.error('[Overlay] Failed to save position:', error)
  }
}

export function createOverlayWindow(): BrowserWindow {
  const primaryDisplay = screen.getPrimaryDisplay()
  const { width } = primaryDisplay.workAreaSize

  // Load saved position or use defaults
  const savedPosition = loadOverlayPosition()
  const defaultX = width - 300
  const defaultY = 100
  const defaultWidth = 280
  const defaultHeight = 500

  const overlayWindow = new BrowserWindow({
    width: savedPosition?.width || defaultWidth,
    height: savedPosition?.height || defaultHeight,
    x: savedPosition?.x ?? defaultX,
    y: savedPosition?.y ?? defaultY,
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

  // Keep window on top of fullscreen apps (macOS)
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  overlayWindow.setAlwaysOnTop(true, 'screen-saver')

  // Load the overlay HTML
  if (process.env.NODE_ENV === 'development') {
    overlayWindow.loadURL('http://localhost:5173/overlay/')
  } else {
    overlayWindow.loadFile(join(__dirname, '../renderer/overlay/index.html'))
  }

  // Save position when window is moved or resized
  let saveTimeout: NodeJS.Timeout | null = null
  const debouncedSave = () => {
    if (saveTimeout) {
      clearTimeout(saveTimeout)
    }
    saveTimeout = setTimeout(() => {
      const bounds = overlayWindow.getBounds()
      saveOverlayPosition({
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

export function showOverlay(window: BrowserWindow): void {
  window.show()
}

export function hideOverlay(window: BrowserWindow): void {
  window.hide()
}

export function setOverlayInteractive(window: BrowserWindow, interactive: boolean): void {
  window.setIgnoreMouseEvents(!interactive, { forward: true })
}

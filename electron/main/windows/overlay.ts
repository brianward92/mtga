import { BrowserWindow, screen } from 'electron'
import { join } from 'path'

export function createOverlayWindow(): BrowserWindow {
  const primaryDisplay = screen.getPrimaryDisplay()
  const { width, height } = primaryDisplay.workAreaSize

  const overlayWindow = new BrowserWindow({
    width: 280,
    height: 500,
    x: width - 300,  // Position on right side
    y: 100,
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

  // Handle window events
  overlayWindow.on('closed', () => {
    // Window was closed
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

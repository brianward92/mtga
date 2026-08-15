/**
 * THE overlay: one frameless, transparent, always-on-top window sized to the
 * Arena window (main/arena-geometry.ts supplies the rect). Click-through by
 * default with mouse-event forwarding, so the renderer still sees mousemove
 * and can ask to become interactive while the cursor is over the HUD.
 * Never focusable — Arena keeps keyboard focus.
 */
import { BrowserWindow, app } from 'electron'
import { join } from 'path'
import type { ArenaRect } from '../arena-geometry'

export function createOverlayWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    resizable: true, // programmatic setBounds only
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: join(__dirname, '../preload/preload.js'),
      backgroundThrottling: false
    }
  })
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.setAlwaysOnTop(true, 'floating')
  win.setIgnoreMouseEvents(true, { forward: true })
  if (app.isPackaged) {
    void win.loadFile(join(__dirname, '../renderer/overlay/index.html'))
  } else if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/overlay/index.html`)
  } else {
    void win.loadFile(join(__dirname, '../renderer/overlay/index.html'))
  }
  return win
}

export function setOverlayRect(win: BrowserWindow, rect: ArenaRect): void {
  if (win.isDestroyed()) return
  win.setBounds({
    x: Math.round(rect.x), y: Math.round(rect.y),
    width: Math.max(1, Math.round(rect.width)), height: Math.max(1, Math.round(rect.height))
  }, false)
}

export function showOverlay(win: BrowserWindow): void {
  if (win.isDestroyed() || win.isVisible()) return
  win.showInactive()
}

export function hideOverlay(win: BrowserWindow): void {
  if (win.isDestroyed() || !win.isVisible()) return
  win.hide()
}

/** Renderer asks for clicks while the cursor is over an interactive region. */
export function setOverlayInteractive(win: BrowserWindow, interactive: boolean): void {
  if (win.isDestroyed()) return
  if (interactive) win.setIgnoreMouseEvents(false)
  else win.setIgnoreMouseEvents(true, { forward: true })
}

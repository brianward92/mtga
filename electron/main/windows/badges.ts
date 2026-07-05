/**
 * Badge overlay window — Untapped-style flame badges drawn ON the Arena pack
 * cards (not a side panel).
 *
 * The window is a frameless transparent sheet sized/positioned to cover the
 * Arena window (main/arena-geometry.ts supplies the rect) and is ALWAYS
 * click-through: setIgnoreMouseEvents(true), no drag grips, no buttons, no
 * interaction of any kind — unlike the panel overlay there is nothing to
 * click, so the panel's drag/click machinery deliberately does not exist
 * here. Hidden by default; shown only while a draft is live (or calibration
 * mode is on) AND the Arena window has been located.
 */

import { BrowserWindow } from 'electron'
import { join } from 'path'

export function createBadgeWindow(): BrowserWindow {
  const badgeWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,             // hidden until a draft + Arena geometry exist
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    // Programmatic setBounds only — kept resizable:true because non-resizable
    // windows reject bounds changes on some platforms; the window is
    // frameless + click-through, so the user can never resize it anyway.
    resizable: true,
    movable: false,
    minimizable: false,
    maximizable: false,
    closable: true,
    focusable: false,        // never steal focus/keystrokes from Arena
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: join(__dirname, '../preload/preload.js')
    }
  })

  // ALWAYS click-through: this window never takes a single mouse event.
  badgeWindow.setIgnoreMouseEvents(true)
  badgeWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  badgeWindow.setAlwaysOnTop(true, 'floating')

  if (process.env.NODE_ENV === 'development') {
    badgeWindow.loadURL('http://localhost:5173/badges/index.html')
  } else {
    badgeWindow.loadFile(join(__dirname, '../renderer/badges/index.html'))
  }

  return badgeWindow
}

/** Cover the Arena window exactly (rect from the geometry poller). */
export function setBadgeWindowRect(
  window: BrowserWindow,
  rect: { x: number; y: number; width: number; height: number }
): void {
  if (window.isDestroyed()) return
  window.setBounds({
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height)
  }, false)
}

export function showBadgeWindow(window: BrowserWindow): void {
  if (window.isDestroyed()) return
  if (!window.isVisible()) {
    window.showInactive() // never steal focus from Arena
  }
  window.setIgnoreMouseEvents(true) // belt and braces: never interactive
}

export function hideBadgeWindow(window: BrowserWindow): void {
  if (window.isDestroyed()) return
  if (window.isVisible()) window.hide()
}

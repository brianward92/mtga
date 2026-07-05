/**
 * Dashboard window configuration
 * Main window for viewing match history, stats, and inventory
 */

import { BrowserWindow } from 'electron'
import { join } from 'path'

export function createRegistryWindow(): BrowserWindow {
  const dashboardWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'MTGA Tracker',
    backgroundColor: '#0a0a0f',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: join(__dirname, '../preload/preload.js')
    }
  })

  // Load the dashboard
  if (process.env.NODE_ENV === 'development') {
    // In development, load from dev server
    dashboardWindow.loadURL('http://localhost:5173/dashboard/index.html')
    dashboardWindow.webContents.openDevTools()
  } else {
    // In production, load the BUILT bundle from dist (one level up from
    // dist/main — same as the overlay/badge windows). '../../renderer/...'
    // used to escape dist/ entirely and load the raw source HTML out of the
    // asar, whose <script src="dashboard.ts"> never executes: the packaged
    // dashboard shipped with no working JavaScript at all.
    const dashboardPath = join(__dirname, '../renderer/dashboard/index.html')
    dashboardWindow.loadFile(dashboardPath)
  }

  // Hide menu bar
  dashboardWindow.setMenuBarVisibility(false)

  return dashboardWindow
}

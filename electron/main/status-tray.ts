/**
 * Menu-bar item: the app's only persistent surface. Shows model/draft status
 * and the few toggles a drafter needs.
 */
import { app, Menu, Tray, nativeImage } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import type { DraftState, Prefs } from '../shared/state'
import { draftLabel, modelLabel } from './status-labels'

interface TrayState {
  draft: DraftState
  prefs: Prefs
  layerDetectionAvailable: boolean
  arenaFound: boolean
}

interface TrayActions {
  toggleBadges: () => void
  toggleHud: () => void
  toggleLayerDetection: () => void
  toggleOpenAtLogin: () => void
  calibrate: () => void
  openScreenRecordingSettings: () => void
}

// Monochrome stacked-card mark as a template PNG (macOS recolors template
// images; nativeImage cannot rasterize SVG, so we ship 1x/2x PNGs).
function menuIcon(): Electron.NativeImage {
  const candidates = [
    join(process.resourcesPath ?? '', 'trayTemplate.png'),
    join(__dirname, '..', '..', 'build', 'trayTemplate.png'),
    join(process.cwd(), 'build', 'trayTemplate.png')
  ]
  for (const p of candidates) {
    if (existsSync(p)) {
      const img = nativeImage.createFromPath(p)
      if (!img.isEmpty()) { img.setTemplateImage(true); return img }
    }
  }
  return nativeImage.createEmpty()
}

/** Owns and rebuilds the persistent menu-bar status surface. */
export class StatusTray {
  private tray: Tray
  private state: TrayState | null = null

  constructor(private actions: TrayActions) {
    const icon = menuIcon()
    this.tray = new Tray(icon)
    // Text fallback so the item is never invisible.
    if (process.platform === 'darwin' && icon.isEmpty()) this.tray.setTitle('Draft')
    this.tray.setToolTip('MTGA Draft Assistant')
  }

  /** Replace displayed application state and rebuild the context menu. */
  update(state: TrayState): void {
    this.state = state
    this.rebuild()
  }

  /** Destroy the native tray item. */
  destroy(): void {
    if (!this.tray.isDestroyed()) this.tray.destroy()
  }

  private rebuild(): void {
    const s = this.state
    // Late poller/child-process events during quit must not touch a dead tray.
    if (!s || this.tray.isDestroyed()) return
    const menu = Menu.buildFromTemplate([
      { label: modelLabel(s.draft), enabled: false },
      { label: draftLabel(s.draft, s.arenaFound), enabled: false },
      { type: 'separator' },
      { label: 'Card Badges', type: 'checkbox', checked: s.prefs.badges, click: () => this.actions.toggleBadges() },
      { label: 'Draft Sidebar', type: 'checkbox', checked: s.prefs.hud, click: () => this.actions.toggleHud() },
      { type: 'separator' },
      {
        label: 'Precise layering (optional — captures the Arena window)',
        type: 'checkbox',
        checked: s.prefs.layerDetection,
        click: () => this.actions.toggleLayerDetection()
      },
      ...(s.prefs.layerDetection && !s.layerDetectionAvailable
        ? [{ label: '   needs Screen Recording — open System Settings…', click: () => this.actions.openScreenRecordingSettings() }]
        : []),
      { label: 'Calibrate Card Grid…', click: () => this.actions.calibrate() },
      { type: 'separator' },
      {
        label: 'Start at Login',
        type: 'checkbox',
        checked: s.prefs.openAtLogin,
        click: () => this.actions.toggleOpenAtLogin()
      },
      { type: 'separator' },
      { label: 'Quit MTGA Draft Assistant', click: () => app.quit() }
    ])
    this.tray.setContextMenu(menu)
  }
}

/**
 * Menu-bar item: the app's only persistent surface. Shows model/draft status
 * and the few toggles a drafter needs.
 */
import { app, Menu, Tray, nativeImage } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import type { DraftState } from '../shared/state'
import type { Prefs } from './prefs'

export interface TrayState {
  draft: DraftState
  prefs: Prefs
  layerDetectionAvailable: boolean
  overlayVisible: boolean
}

export interface TrayActions {
  toggleBadges: () => void
  toggleHud: () => void
  toggleLayerDetection: () => void
  calibrate: () => void
  toggleSheet: () => void
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

function modelLabel(d: DraftState): string {
  const m = d.model
  if (m.state === 'ready' && m.modelId) return `Model: ${m.modelId.replace(/^_foundation\//, 'DraftFM ')}`
  if (m.state === 'no-bundle') return 'Model: bundle missing'
  if (m.state === 'no-set') return `Model: ${d.set ?? 'set'} not bundled`
  if (m.state === 'error') return `Model: error — ${m.message ?? ''}`
  return 'Model: DraftFM (loading…)'
}

function draftLabel(d: DraftState): string {
  if (d.phase === 'idle') return 'No draft in progress'
  const where = d.pack && d.pick ? ` P${d.pack}P${d.pick}` : ''
  return `${d.set ?? '?'} ${d.format ?? ''}${where}${d.phase === 'complete' ? ' — complete' : ''}`
}

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

  update(state: TrayState): void {
    this.state = state
    this.rebuild()
  }

  destroy(): void { this.tray.destroy() }

  private rebuild(): void {
    const s = this.state
    if (!s) return
    const menu = Menu.buildFromTemplate([
      { label: modelLabel(s.draft), enabled: false },
      { label: draftLabel(s.draft), enabled: false },
      { type: 'separator' },
      { label: 'Card Badges', type: 'checkbox', checked: s.prefs.badges, click: () => this.actions.toggleBadges() },
      { label: 'Context HUD', type: 'checkbox', checked: s.prefs.hud, click: () => this.actions.toggleHud() },
      { label: 'Pool & Picks Sheet   ⌘⇧D', click: () => this.actions.toggleSheet() },
      { type: 'separator' },
      s.layerDetectionAvailable
        ? { label: 'Lift badges under Arena previews', type: 'checkbox', checked: s.prefs.layerDetection, click: () => this.actions.toggleLayerDetection() }
        : { label: 'Lift badges under previews: needs Screen Recording…', click: () => this.actions.openScreenRecordingSettings() },
      { label: 'Calibrate Card Grid…', click: () => this.actions.calibrate() },
      { type: 'separator' },
      { label: 'Quit MTGA Draft Assistant', click: () => app.quit() }
    ])
    this.tray.setContextMenu(menu)
  }
}

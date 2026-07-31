/** Persistent macOS menu-bar status and controls. */

import { app, Menu, nativeImage, Tray } from 'electron'

export interface StatusTrayState {
  serverStatus: 'green' | 'amber' | 'red'
  model: string | null
  draft: {
    set: string | null
    format: string | null
    pack: number | null
    pick: number | null
  } | null
  overlayVisible: boolean
}

export interface StatusTrayActions {
  showOverlay: () => void
  toggleOverlay: () => void
  calibrateBadges: () => void
}

// Monochrome stacked-card mark. macOS recolors template images for the
// current menu-bar appearance, including high-contrast and dark modes.
const ICON_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18">
  <path fill="#000" d="M4 2h9a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm1 2a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1H5Zm1 2h5v1H6V6Zm0 3h5v1H6V9Zm0 3h3v1H6v-1Z"/>
</svg>`.trim()

function menuIcon() {
  const data = Buffer.from(ICON_SVG).toString('base64')
  const image = nativeImage.createFromDataURL(`data:image/svg+xml;base64,${data}`)
  image.setTemplateImage(true)
  return image
}

function modelLabel(model: string | null): string {
  if (!model) return 'none'
  const parts = model.split('/').filter(Boolean)
  return parts.at(-1) || model
}

function draftLabel(draft: StatusTrayState['draft']): string {
  if (!draft) return 'Draft: idle'
  const set = draft.set || 'unknown set'
  const format = draft.format || 'draft'
  const position = draft.pack !== null && draft.pick !== null
    ? ` P${draft.pack}P${draft.pick}`
    : ''
  return `Draft: ${set} ${format}${position}`
}

export class StatusTray {
  private readonly tray: Tray
  private state: StatusTrayState

  constructor(private readonly actions: StatusTrayActions) {
    this.state = {
      serverStatus: 'red',
      model: null,
      draft: null,
      overlayVisible: false
    }
    this.tray = new Tray(menuIcon())
    if (process.platform === 'darwin') {
      // Text is an intentional fallback: a malformed/unsupported template
      // image must never leave the status item present but invisible.
      this.tray.setTitle('MTGA')
    }
    this.tray.setToolTip('MTGA Draft Assistant')
    this.tray.on('click', () => this.actions.showOverlay())
    this.rebuildMenu()
  }

  update(state: StatusTrayState): void {
    this.state = state
    this.rebuildMenu()
  }

  destroy(): void {
    this.tray.destroy()
  }

  private rebuildMenu(): void {
    const status = this.state.serverStatus.toUpperCase()
    const menu = Menu.buildFromTemplate([
      { label: `Server: ${status}`, enabled: false },
      { label: `Model: ${modelLabel(this.state.model)}`, enabled: false },
      { label: draftLabel(this.state.draft), enabled: false },
      { type: 'separator' },
      {
        label: this.state.overlayVisible ? 'Hide Draft Overlay' : 'Show Draft Overlay',
        click: () => this.actions.toggleOverlay()
      },
      { label: 'Calibrate Card Badges', click: () => this.actions.calibrateBadges() },
      { type: 'separator' },
      { label: 'Quit MTGA Draft Assistant', click: () => app.quit() }
    ])
    this.tray.setContextMenu(menu)
  }
}

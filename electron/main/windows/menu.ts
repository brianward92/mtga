/**
 * Standard application menu — makes the tracker behave like a plain Mac app:
 * About/Quit under the app menu, standard Edit
 * roles, a View menu carrying the overlay and badge-calibration entries
 * (dev additionally gets reload/devtools roles), and the usual Window roles.
 */

import { Menu, MenuItemConstructorOptions } from 'electron'

export interface MenuActions {
  /** File -> Close Overlay (Cmd+W). */
  onCloseOverlay?: () => void
  /** View -> Show Draft Overlay (available in dev AND prod). */
  onShowOverlay?: () => void
  /** View → Calibrate Badges (available in dev AND prod). */
  onCalibrateBadges?: () => void
  /** View -> Cycle Overlay View (application-local Cmd+Shift+D). */
  onCycleDensity?: () => void
}

export function installApplicationMenu(actions: MenuActions = {}): void {
  const isDev = process.env.NODE_ENV === 'development'
  const isMac = process.platform === 'darwin'

  const viewSubmenu: MenuItemConstructorOptions[] = [
    ...(isDev
      ? ([
          { role: 'reload' },
          { role: 'forceReload' },
          { role: 'toggleDevTools' },
          { type: 'separator' }
        ] as MenuItemConstructorOptions[])
      : []),
    {
      label: 'Show Draft Overlay',
      click: () => actions.onShowOverlay?.()
    },
    {
      label: 'Cycle Overlay View',
      accelerator: 'CommandOrControl+Shift+D',
      click: () => actions.onCycleDensity?.()
    },
    {
      label: 'Calibrate Badges',
      click: () => actions.onCalibrateBadges?.()
    }
  ]

  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'File',
      submenu: [{
        label: 'Close Overlay',
        accelerator: 'CommandOrControl+W',
        click: () => actions.onCloseOverlay?.()
      }]
    },
    { role: 'editMenu' },
    { label: 'View', submenu: viewSubmenu },
    { role: 'windowMenu' },
    ...(!isMac ? [{ label: 'App', submenu: [{ role: 'quit' as const }] }] : [])
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

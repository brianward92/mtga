/**
 * Standard application menu — makes the tracker behave like a plain Mac app:
 * About/Quit under the app menu (Cmd+Q works from anywhere), standard Edit
 * roles so copy/paste works in dashboard inputs, a View menu carrying the
 * badge-calibration entry (dev additionally gets the reload/devtools roles),
 * and the usual Window roles.
 */

import { Menu, MenuItemConstructorOptions } from 'electron'

export interface MenuActions {
  /** View → Calibrate Badges (available in dev AND prod). */
  onCalibrateBadges?: () => void
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
      label: 'Calibrate Badges',
      click: () => actions.onCalibrateBadges?.()
    }
  ]

  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    { role: 'editMenu' },
    { label: 'View', submenu: viewSubmenu },
    { role: 'windowMenu' },
    ...(!isMac ? [{ label: 'App', submenu: [{ role: 'quit' as const }] }] : [])
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

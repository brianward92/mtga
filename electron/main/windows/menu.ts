/**
 * Standard application menu — makes the tracker behave like a plain Mac app:
 * About/Quit under the app menu (Cmd+Q works from anywhere), standard Edit
 * roles so copy/paste works in dashboard inputs, dev-only View menu, and the
 * usual Window roles.
 */

import { Menu, MenuItemConstructorOptions } from 'electron'

export function installApplicationMenu(): void {
  const isDev = process.env.NODE_ENV === 'development'
  const isMac = process.platform === 'darwin'

  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    { role: 'editMenu' },
    ...(isDev ? [{ role: 'viewMenu' as const }] : []),
    { role: 'windowMenu' },
    ...(!isMac ? [{ label: 'App', submenu: [{ role: 'quit' as const }] }] : [])
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

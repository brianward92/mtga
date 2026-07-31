import { beforeEach, describe, expect, it, vi } from 'vitest'

const { setApplicationMenu, buildFromTemplate } = vi.hoisted(() => ({
  setApplicationMenu: vi.fn(),
  buildFromTemplate: vi.fn((template: unknown) => template)
}))

vi.mock('electron', () => ({
  Menu: { setApplicationMenu, buildFromTemplate }
}))

import { installApplicationMenu } from '../main/windows/menu'

describe('application menu shortcuts', () => {
  beforeEach(() => {
    setApplicationMenu.mockClear()
    buildFromTemplate.mockClear()
  })

  it('keeps native Mac quit/minimize roles and an explicit Cmd+W overlay close', () => {
    const close = vi.fn()
    installApplicationMenu({ onCloseOverlay: close })

    const template = buildFromTemplate.mock.calls[0][0] as Array<Record<string, any>>
    expect(template.some(item => item.role === 'appMenu')).toBe(true)
    expect(template.some(item => item.role === 'windowMenu')).toBe(true)

    const file = template.find(item => item.label === 'File')!
    const closeItem = file.submenu.find((item: Record<string, any>) => item.label === 'Close Overlay')
    expect(closeItem.accelerator).toBe('CommandOrControl+W')
    closeItem.click()
    expect(close).toHaveBeenCalledOnce()
  })

  it('exposes density cycling as an app-local Cmd+Shift+D command', () => {
    const cycle = vi.fn()
    installApplicationMenu({ onCycleDensity: cycle })
    const template = buildFromTemplate.mock.calls[0][0] as Array<Record<string, any>>
    const view = template.find(item => item.label === 'View')!
    const cycleItem = view.submenu.find((item: Record<string, any>) => item.label === 'Cycle Overlay View')
    expect(cycleItem.accelerator).toBe('CommandOrControl+Shift+D')
    cycleItem.click()
    expect(cycle).toHaveBeenCalledOnce()
  })
})

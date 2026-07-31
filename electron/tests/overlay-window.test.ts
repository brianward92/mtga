import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  BrowserWindow: class {},
  screen: {
    getAllDisplays: () => [{ bounds: { x: 0, y: 0, width: 1440, height: 900 } }],
    getPrimaryDisplay: () => ({ workAreaSize: { width: 1440, height: 900 } })
  }
}))

import { activateOverlay, isOverlayPresented, showOverlay } from '../main/windows/overlay'

function fakeWindow(state: { minimized?: boolean; visible?: boolean } = {}) {
  let minimized = state.minimized ?? false
  let visible = state.visible ?? false
  return {
    isDestroyed: vi.fn(() => false),
    isMinimized: vi.fn(() => minimized),
    isVisible: vi.fn(() => visible),
    showInactive: vi.fn(() => { visible = true }),
    show: vi.fn(() => { visible = true }),
    restore: vi.fn(() => { minimized = false; visible = true }),
    focus: vi.fn(),
    setIgnoreMouseEvents: vi.fn()
  }
}

describe('overlay presentation lifecycle', () => {
  it('never restores a user-minimized panel for passive draft updates', () => {
    const window = fakeWindow({ minimized: true })
    showOverlay(window as any)
    expect(window.restore).not.toHaveBeenCalled()
    expect(window.showInactive).not.toHaveBeenCalled()
    expect(window.focus).not.toHaveBeenCalled()
  })

  it('shows a hidden panel passively without taking focus', () => {
    const window = fakeWindow({ visible: false })
    showOverlay(window as any)
    expect(window.showInactive).toHaveBeenCalledOnce()
    expect(window.focus).not.toHaveBeenCalled()
  })

  it('restores and focuses after a deliberate Dock or menu-bar action', () => {
    const window = fakeWindow({ minimized: true })
    activateOverlay(window as any)
    expect(window.restore).toHaveBeenCalledOnce()
    expect(window.focus).toHaveBeenCalledOnce()
    expect(isOverlayPresented(window as any)).toBe(true)
  })

  it('does not report a minimized window as presented', () => {
    const window = fakeWindow({ minimized: true, visible: true })
    expect(isOverlayPresented(window as any)).toBe(false)
  })
})

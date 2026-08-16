/**
 * Preload: the overlay's narrow bridge to main.
 *   window.overlay.getState()          → DraftState snapshot (late attach)
 *   window.overlay.getPrefs()          → Prefs
 *   window.overlay.onState(cb)         ← every DraftState change
 *   window.overlay.onLayer(cb)         ← Arena layer awareness (covered cells…)
 *   window.overlay.onCalibrate(cb)     ← calibration mode state
 *   window.overlay.onPrefs(cb)         ← prefs changed
 *   window.overlay.onCommand(cb)       ← 'toggle-sheet' | 'cycle-hud' … (shortcuts/menu)
 *   window.overlay.setInteractive(on)  → take/release mouse events (HUD hover)
 *   window.overlay.setHudRect(rect)    → where the HUD is (layer awareness lifts it)
 *   window.overlay.action(name, data)  → user intent (toggle-badges, calibrate-op, dismiss, …)
 *   window.overlay.e2e                 → enables renderer-only E2E injection seams
 */
import { contextBridge, ipcRenderer } from 'electron'

const api = {
  getState: () => ipcRenderer.invoke('overlay:get-state'),
  getPrefs: () => ipcRenderer.invoke('overlay:get-prefs'),
  onState: (cb: (data: unknown) => void) => { ipcRenderer.on('overlay:state', (_e, d) => cb(d)) },
  onLayer: (cb: (data: unknown) => void) => { ipcRenderer.on('overlay:layer', (_e, d) => cb(d)) },
  onCalibrate: (cb: (data: unknown) => void) => { ipcRenderer.on('overlay:calibrate', (_e, d) => cb(d)) },
  onPrefs: (cb: (data: unknown) => void) => { ipcRenderer.on('overlay:prefs', (_e, d) => cb(d)) },
  onCommand: (cb: (data: unknown) => void) => { ipcRenderer.on('overlay:command', (_e, d) => cb(d)) },
  setInteractive: (on: boolean) => ipcRenderer.send('overlay:interactive', on),
  setHudRect: (rect: { x: number; y: number; width: number; height: number } | null) => ipcRenderer.send('overlay:hud-rect', rect),
  action: (name: string, data?: unknown) => ipcRenderer.send('overlay:action', { name, data }),
  e2e: process.env.MTGA_E2E === '1'
}

contextBridge.exposeInMainWorld('overlay', api)

declare global {
  interface Window {
    overlay: typeof api
  }
}

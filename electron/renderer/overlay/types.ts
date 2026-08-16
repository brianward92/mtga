/**
 * Renderer-side view of the payloads main pushes over the preload bridge.
 * The authoritative shapes live in shared/ (type-only imports).
 */
import type { DraftState, LayerState, CalibrateState, Prefs } from '../../shared/state'

/** Renderer prefs: the persisted prefs minus the calibration table. */
export type ViewPrefs = Pick<Prefs, 'badges' | 'hud' | 'hudCorner' | 'layerDetection'>

/** User intent emitted by renderer controls through the preload bridge. */
export type OverlayAction = (name: string, data?: unknown) => void

/** Main-to-renderer command received through the preload bridge. */
export interface OverlayCommand {
  name: string
  data?: unknown
}

interface ViewportSize {
  width: number
  height: number
}

/** Everything the layers render from. Mutated in place; renders coalesce via rAF. */
export interface Store {
  state: DraftState
  prefs: ViewPrefs
  layer: LayerState
  calibrate: CalibrateState
  sheetOpen: boolean
  /** Display-order pack cell under the cursor (-1 when none). */
  hoverCell: number
  view: ViewportSize
}

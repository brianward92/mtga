/**
 * Renderer-side view of the payloads main pushes over the preload bridge.
 * The authoritative shapes live in shared/ (type-only imports).
 */
import type { DraftState, LayerState, CalibrateState, HudCorner, Prefs } from '../../shared/state'
import type { CalibrationConfig, Rect } from '../../shared/layout'

export type { DraftState, CalibrationConfig, Rect, LayerState, CalibrateState, HudCorner, Prefs }

/** Renderer prefs: the persisted prefs minus the calibration table. */
export type ViewPrefs = Pick<Prefs, 'badges' | 'hud' | 'hudCorner' | 'layerDetection'>

export interface Command {
  name: string
  data?: unknown
}

export interface Size {
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
  view: Size
}

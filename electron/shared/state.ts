/**
 * The overlay's single source of truth: main pushes whole DraftState
 * snapshots (packs are tiny), the renderer renders. Shared between main and
 * renderer — keep it JSON-plain.
 */
import type { Grade } from './grades'

export type { Grade }

export interface CardRow {
  grpId: number
  name: string
  rarity: string
  /** WUBRG letters ('' colourless). */
  colors: string
  manaCost: string
  manaValue: number | null
  type: string
  imageUrl: string | null
  /** Model logit for THIS pick (pool-conditioned); null until scored / unknown. */
  ev: number | null
  /** Softmax over the pack's known cards. */
  prob: number | null
  /** 1-based rank within the pack by ev. */
  rank: number | null
  /** Set-relative intrinsic strength (P1P1 curve). */
  percentile: number | null
  grade: Grade | null
  /** 17Lands display stats (may be absent). */
  gihWr: number | null
  alsa: number | null
}

export interface PickRecord {
  pack: number   // 1-based for display
  pick: number   // 1-based for display
  grpId: number
  name: string
  /** What the model preferred at the time (null if scores never arrived). */
  recommendedGrpId: number | null
  recommendedName: string | null
  /** Rank of the taken card in the model's ordering (1 = agreed). */
  takenRank: number | null
  ev: number | null
}

export interface ModelInfo {
  state: 'ready' | 'loading' | 'no-bundle' | 'no-set' | 'error'
  modelId: string | null
  message: string | null
}

export interface DraftState {
  phase: 'idle' | 'active' | 'complete'
  set: string | null
  format: string | null
  eventName: string | null
  isBotDraft: boolean
  /** 1-based for display; null between packs. */
  pack: number | null
  pick: number | null
  picksPerPack: number
  totalPicks: number
  cards: CardRow[]
  /** True while the pack is on screen but scores haven't landed yet. */
  scoring: boolean
  pool: CardRow[]
  picks: PickRecord[]
  model: ModelInfo
  attribution: string | null
  /** Setup problem to surface (e.g. Arena detailed logs disabled). */
  warning: string | null
  /** Monotonic; renderer can skip stale pushes. */
  seq: number
}

export const EMPTY_STATE: DraftState = {
  phase: 'idle', set: null, format: null, eventName: null, isBotDraft: false,
  pack: null, pick: null, picksPerPack: 14, totalPicks: 42, cards: [], scoring: false,
  pool: [], picks: [], model: { state: 'loading', modelId: null, message: null }, attribution: null, warning: null, seq: 0
}

// ---------------------------------------------------------------------------
// Overlay side-channels (main → renderer)
// ---------------------------------------------------------------------------

import type { CalibrationConfig, Rect } from './layout'

/** What Arena's own UI is currently drawn over (see main/overlay/layer.ts). */
export interface LayerState {
  /** Pack cells (display order) covered by Arena UI. */
  cells: number[]
  /** Predicted preview regions (window px) when no capture is available. */
  regions: Rect[]
  /** Whole pack covered (modal) or not on screen — lift everything. */
  covered: boolean
  /** The renderer-reported HUD rect is covered. */
  hudCovered: boolean
}

export interface CalibrateState {
  active: boolean
  count: number
  config: CalibrationConfig
  arenaFound: boolean
}

export type HudCorner = 'tl' | 'tr' | 'bl' | 'br'

export interface Prefs {
  badges: boolean
  hud: boolean
  hudCorner: HudCorner
  layerDetection: boolean
  /** Per aspect-bucket grid calibrations. */
  calibrations: Record<string, CalibrationConfig>
}

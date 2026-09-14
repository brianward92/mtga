/**
 * The overlay's single source of truth: main pushes whole DraftState
 * snapshots (packs are tiny), the renderer renders. Shared between main and
 * renderer — keep it JSON-plain.
 */
import type { Grade } from './grades'

export type { Grade }

/** One pack or pool card with immutable identity and live model scores. */
export interface CardFace {
  name: string
  type: string
  manaCost: string
  oracleText: string
}

export interface CardRow {
  hasBackFace?: boolean
  oracleText?: string
  faces?: CardFace[]
  grpId: number
  name: string
  rarity: string
  /** WUBRG letters ('' colourless). */
  colors: string
  /** Full WUBRG identity, used to place lands in Arena's display order. */
  colorIdentity: string
  manaCost: string
  manaValue: number | null
  type: string
  /**
   * Raw Scryfall printing id carried through from the offline bundle.
   *
   * Optional because identity now comes from Arena's own card database, which
   * has no Scryfall ids: a card resolved through the live-database fallback has
   * a name, a type and sort keys but no printing.
   */
  scryfallId?: string
  /** Arena's own sort keys when known; see shared/display-order.ts. */
  order?: readonly [number, number, string]
  /**
   * No bundle entry for this grpId, so every field above is a placeholder.
   * The pack grid is matched to cards positionally, so a single unresolved card
   * reorders everything after it: callers must refuse to draw or click rather
   * than render a grid that looks right and is not.
   */
  unresolved?: boolean
  imageUrl: string | null
  /** Model logit for THIS pick (pool-conditioned); null until scored / unknown. */
  ev: number | null
  /** Softmax over the pack's known cards. */
  prob: number | null
  /** 1-based rank within the pack by ev. */
  rank: number | null
  /**
   * "For your pool": set-relative percentile/letter of the card under the live
   * pool + pick position (what we recommend by). Before scores arrive, or with
   * an empty pool, equals the raw set rating.
   */
  percentile: number | null
  grade: Grade | null
  /** Raw set rating: empty-pool P1P1 percentile/letter (the paper's scale). */
  setPercentile: number | null
  setGrade: Grade | null
}

/** The recorded human/model decision for one completed draft pick. */
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

/** Model availability and diagnostic state exposed to the renderer. */
export interface ModelInfo {
  state: 'ready' | 'loading' | 'no-bundle' | 'no-set' | 'error'
  modelId: string | null
  message: string | null
}

/** Complete JSON-plain renderer snapshot for the current draft lifecycle. */
export interface DraftState {
  phase: 'idle' | 'active' | 'complete'
  /**
   * The Arena screen currently showing (Client.SceneChange's toSceneName), or
   * null before one is seen. A draft stays active while the drafter wanders to
   * Home, so this is what stops the overlay drawing a pack over the menus.
   */
  arenaScene?: string | null
  /**
   * This draft was rebuilt from the app's own history file rather than seen
   * live or replayed from Arena's log. Its picks carry no model comparison,
   * because scoring happened, if at all, in an earlier run.
   */
  restoredFromHistory?: boolean
  /** Arena's own submitted Limited deck (from EventSetDeck), once Done is pressed. */
  submittedDeck?: { main: Array<{ grpId: number; quantity: number }>; sideboard: Array<{ grpId: number; quantity: number }>; mainCount: number } | null
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
  /** Provenance of what's on screen: Scryfall snapshot date + model tag. */
  snapshot: { scryfall: string | null; model: string | null }
  /** Setup problem to surface (e.g. Arena detailed logs disabled). */
  warning: string | null
  /** Monotonic; renderer can skip stale pushes. */
  seq: number
}

/** Initial snapshot used before a draft is discovered. */
export const EMPTY_STATE: DraftState = {
  phase: 'idle', arenaScene: null, set: null, format: null, eventName: null, isBotDraft: false,
  pack: null, pick: null, picksPerPack: 14, totalPicks: 42, cards: [], scoring: false,
  pool: [], picks: [], model: { state: 'loading', modelId: null, message: null },
  snapshot: { scryfall: null, model: null }, warning: null, seq: 0
}

// ---------------------------------------------------------------------------
// Overlay side-channels (main → renderer)
// ---------------------------------------------------------------------------

import type { CalibrationConfig, Rect } from './layout'

/** What Arena's own UI is currently drawn over (see main/overlay/layer.ts). */
export interface LayerState {
  /** Actual Arena title bar; absent preserves legacy windowed geometry. */
  titleBarHeight?: number
  /** Pack cells (display order) whose badges must lift. */
  cells: number[]
  /** Where Arena's hover preview is expected (window px); empty when none is up. */
  regions: Rect[]
  /** Whole pack covered (modal) or not on screen — lift everything. */
  covered: boolean
}

/** Calibration-panel state pushed independently of draft snapshots. */
export interface CalibrateState {
  active: boolean
  count: number
  config: CalibrationConfig
  arenaFound: boolean
}

/** Supported corners for the joined HUD and pool rail. */
export type HudCorner = 'tl' | 'tr' | 'bl' | 'br'

/** Persisted overlay presentation and calibration preferences. */
export interface Prefs {
  badges: boolean
  hud: boolean
  hudCorner: HudCorner
  layerDetection: boolean
  /** Start the assistant at login so it is already waiting when Arena opens. */
  openAtLogin: boolean
  /** Per aspect-bucket grid calibrations. */
  calibrations: Record<string, CalibrationConfig>
}

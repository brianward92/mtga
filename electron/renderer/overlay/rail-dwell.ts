export const RAIL_DWELL_MS = 250

export type RailPanel = 'hud' | 'sheet'
export type RailDwellTarget = RailPanel | 'rail'
export type RailTopology = 'none' | RailPanel | 'split' | 'rail'

export interface RailDwellState {
  readonly target: RailDwellTarget | null
  readonly since: number
  readonly yielded: RailDwellTarget | null
}

export interface RailBounds {
  readonly left: number
  readonly top: number
  readonly right: number
  readonly bottom: number
}

export const EMPTY_RAIL_DWELL: RailDwellState = {
  target: null,
  since: 0,
  yielded: null
}

/** Geometry fallback while pointer-events make a yielded panel miss hit-testing. */
export function pointInRailBounds(x: number, y: number, bounds: RailBounds): boolean {
  return x >= bounds.left && x < bounds.right && y >= bounds.top && y < bounds.bottom
}

/** Treat flush HUD + sheet panels as one dwell surface. */
export function railDwellTarget(panel: RailPanel, joined: boolean): RailDwellTarget {
  return joined ? 'rail' : panel
}

/** Which DOM roots should yield for a dwell target. */
export function railDwellIncludes(target: RailDwellTarget | null, panel: RailPanel): boolean {
  return target === 'rail' || target === panel
}

export function railTopology(hudVisible: boolean, sheetVisible: boolean, joined: boolean): RailTopology {
  if (!hudVisible && !sheetVisible) return 'none'
  if (hudVisible && !sheetVisible) return 'hud'
  if (!hudVisible && sheetVisible) return 'sheet'
  return joined ? 'rail' : 'split'
}

/** A topology change invalidates pending timers and existing yields. */
export function reconcileRailDwellTopology(
  state: RailDwellState,
  previous: RailTopology,
  next: RailTopology
): RailDwellState {
  return previous === next ? state : EMPTY_RAIL_DWELL
}

/** Pure dwell transition; the renderer owns the timer and DOM side effects. */
export function advanceRailDwell(
  state: RailDwellState,
  target: RailDwellTarget | null,
  now: number,
  dwellMs = RAIL_DWELL_MS
): RailDwellState {
  if (target === null) {
    return state.target === null && state.yielded === null ? state : EMPTY_RAIL_DWELL
  }
  if (target !== state.target) return { target, since: now, yielded: null }
  if (state.yielded === target || now - state.since < dwellMs) return state
  return { ...state, yielded: target }
}

/** Milliseconds until the current target should be checked again. */
export function railDwellDelay(
  state: RailDwellState,
  now: number,
  dwellMs = RAIL_DWELL_MS
): number | null {
  if (state.target === null || state.yielded !== null) return null
  return Math.max(0, dwellMs - (now - state.since))
}

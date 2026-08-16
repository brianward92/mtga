export const RAIL_DWELL_MS = 250

export type RailPanel = 'hud' | 'sheet'

export interface RailDwellState {
  readonly target: RailPanel | null
  readonly since: number
  readonly yielded: RailPanel | null
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

/** Pure dwell transition; the renderer owns the timer and DOM side effects. */
export function advanceRailDwell(
  state: RailDwellState,
  target: RailPanel | null,
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

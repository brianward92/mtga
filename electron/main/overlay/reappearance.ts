/** Grace period before showing the overlay after Arena returns. */
export const OVERLAY_REAPPEARANCE_DELAY_MS = 250

type OverlayReappearancePhase = 'unknown' | 'lost' | 'waiting' | 'ready'

/** Pure state carried between Arena-presence observations. */
export interface OverlayReappearanceState {
  readonly phase: OverlayReappearancePhase
  readonly readyAt: number | null
}

/** Initial state before Arena presence has been observed. */
export const INITIAL_OVERLAY_REAPPEARANCE: OverlayReappearanceState = {
  phase: 'unknown',
  readyAt: null
}

/**
 * Pure lost/found transition. The first observation may show immediately;
 * only a real lost -> found transition gets a grace period.
 */
export function advanceOverlayReappearance(
  state: OverlayReappearanceState,
  found: boolean,
  now: number,
  delayMs = OVERLAY_REAPPEARANCE_DELAY_MS
): OverlayReappearanceState {
  if (!found) {
    return state.phase === 'lost' ? state : { phase: 'lost', readyAt: null }
  }

  if (state.phase === 'unknown' || state.phase === 'ready') {
    return state.phase === 'ready' ? state : { phase: 'ready', readyAt: null }
  }

  if (state.phase === 'lost') {
    return { phase: 'waiting', readyAt: now + Math.max(0, delayMs) }
  }

  if (state.readyAt !== null && now >= state.readyAt) {
    return { phase: 'ready', readyAt: null }
  }
  return state
}

/** Remaining time before sync should re-check the overlay, if any. */
export function overlayReappearanceDelay(
  state: OverlayReappearanceState,
  now: number
): number | null {
  if (state.phase !== 'waiting' || state.readyAt === null) return null
  return Math.max(0, state.readyAt - now)
}

/** Final visibility gate; Arena must still own the foreground at show time. */
export function mayShowOverlay(
  state: OverlayReappearanceState,
  wanted: boolean,
  arenaFrontmost: boolean
): boolean {
  return state.phase === 'ready' && wanted && arenaFrontmost
}

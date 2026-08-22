import type { DraftState } from '../../shared/state'

/**
 * How long the completed draft summary remains visible before returning idle.
 * Long enough to cover a whole deckbuilding session — the deckbuild advice is
 * the point of the complete phase; dismissing the sheet still idles early.
 */
export const COMPLETE_LINGER_MS = 30 * 60_000

/** Completion initially reveals the pool; later toggles in that phase stick. */
export function sheetOpenForPhaseTransition(
  previous: DraftState['phase'],
  next: DraftState['phase'],
  currentlyOpen: boolean
): boolean {
  return next === 'complete' && previous !== 'complete' ? true : currentlyOpen
}

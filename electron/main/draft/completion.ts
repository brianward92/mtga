import type { DraftState } from '../../shared/state'

/** How long the completed draft summary remains visible before returning idle. */
export const COMPLETE_LINGER_MS = 15_000

/** Completion initially reveals the pool; later toggles in that phase stick. */
export function sheetOpenForPhaseTransition(
  previous: DraftState['phase'],
  next: DraftState['phase'],
  currentlyOpen: boolean
): boolean {
  return next === 'complete' && previous !== 'complete' ? true : currentlyOpen
}

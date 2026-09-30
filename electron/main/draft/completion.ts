import type { DraftState } from '../../shared/state'

/** Completion initially reveals the pool; later toggles in that phase stick. */
export function sheetOpenForPhaseTransition(
  previous: DraftState['phase'],
  next: DraftState['phase'],
  currentlyOpen: boolean
): boolean {
  return next === 'complete' && previous !== 'complete' ? true : currentlyOpen
}

/**
 * How old a recorded draft may be and still be restored from history.
 *
 * A restored draft is presented as complete with a live pool, so an unbounded
 * rule means opening the app months later resurrects a stale one. Two days
 * covers finishing a draft the next evening, which is the case this is for.
 */
export const RESTORE_MAX_AGE_MS = 2 * 24 * 60 * 60_000

import type { DraftState } from '../../shared/state'

/** Minimal application state needed to decide overlay and badge activity. */
export interface OverlayActivity {
  arenaFound: boolean
  arenaFrontmost: boolean
  overlayAvailable: boolean
  calibrating: boolean
  phase: DraftState['phase']
  cardCount: number
  badgesEnabled: boolean
  hudEnabled: boolean
}

/** Whether any overlay content should be visible for the current app state. */
export function wantsOverlayContent(activity: OverlayActivity): boolean {
  if (!activity.arenaFound) return false
  if (activity.calibrating) return true
  if (activity.phase !== 'idle') return activity.badgesEnabled || activity.hudEnabled
  return activity.hudEnabled
}

/** Whether live pack badges need cursor polling and optional window capture. */
export function badgesAreLive(activity: OverlayActivity): boolean {
  return activity.overlayAvailable && activity.badgesEnabled && activity.phase === 'active' &&
    activity.cardCount > 0 && activity.arenaFrontmost && wantsOverlayContent(activity)
}

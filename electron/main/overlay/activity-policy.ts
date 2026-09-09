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
  /** The drafter is in Arena's own menus: our overlay steps aside entirely. */
  standAside: boolean
  /** Arena is showing the draft or the deckbuilder, not Home or the store. */
  inDraftScene: boolean
}

/**
 * Arena screens the overlay belongs on. A draft stays active while the drafter
 * navigates away — the pod is still theirs — so phase alone is not enough:
 * without this the pack grid draws over the Home screen.
 */
const DRAFT_SCENES = new Set(['Draft', 'DeckBuilder'])

/**
 * Whether Arena is on a screen the overlay belongs on.
 *
 * An unknown scene counts as yes. Older logs, or a session that started
 * mid-draft, may never carry a SceneChange, and blanking the overlay because a
 * line is missing would be worse than the occasional stray draw.
 */
export function isDraftScene(scene: string | null | undefined): boolean {
  return !scene || DRAFT_SCENES.has(scene)
}

/** Whether any overlay content should be visible for the current app state. */
export function wantsOverlayContent(activity: OverlayActivity): boolean {
  if (!activity.arenaFound) return false
  if (activity.calibrating) return true
  if (activity.standAside) return false
  if (!activity.inDraftScene) return false
  if (activity.phase !== 'idle') return activity.badgesEnabled || activity.hudEnabled
  return activity.hudEnabled
}

/** Whether live pack badges need cursor polling and optional window capture. */
export function badgesAreLive(activity: OverlayActivity): boolean {
  return activity.overlayAvailable && activity.badgesEnabled && activity.phase === 'active' &&
    activity.cardCount > 0 && activity.arenaFrontmost && wantsOverlayContent(activity)
}

import type { DraftState, HudCorner } from '../../shared/state'

type Phase = DraftState['phase']

/** Badges are meaningful only while Arena is showing a non-empty draft pack. */
export function badgesShouldRender(
  phase: Phase,
  cardCount: number,
  enabled: boolean,
  calibrating: boolean,
  hasLayout: boolean
): boolean {
  return phase === 'active' && cardCount > 0 && enabled && !calibrating && hasLayout
}

/** The pool rail never follows the overlay onto Home, deck, or other idle screens. */
export function sheetShouldRender(phase: Phase, requestedOpen: boolean): boolean {
  return phase !== 'idle' && requestedOpen
}

/** Idle is a fixed, tiny status glyph; draft and completion views keep the user's corner. */
export function hudCornerForPhase(phase: Phase, preferred: HudCorner): HudCorner {
  return phase === 'idle' ? 'tr' : preferred
}

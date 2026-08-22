/** Geometry and presentation state for the full Arena right-column sidebar. */
import { sidebarShellFrame, sidebarSide, type Rect } from '../../shared/layout'
import type { DraftState, LayerState } from '../../shared/state'

const SIDEBAR_INSET = 6

interface ViewSize {
  readonly width: number
  readonly height: number
}

export { sidebarShellFrame, sidebarSide }

/** Rounded visual panel inside the opaque sidebar's six-pixel ownership gutter. */
export function sidebarPanelFrame(view: ViewSize): Rect {
  const shell = sidebarShellFrame(view)
  if (shell.width === 0 || shell.height === 0) return shell
  const inset = Math.min(SIDEBAR_INSET, shell.width / 2, shell.height / 2)
  return {
    x: shell.x + inset,
    y: shell.y + inset,
    width: Math.max(0, shell.width - inset * 2),
    height: Math.max(0, shell.height - inset * 2)
  }
}

/**
 * Renderer-ready sidebar state.
 *
 * The sidebar owns its strip of the window outright: neither `hudCovered` nor
 * an Arena preview landing on it may fade it. The pool and the top picks are
 * what the drafter is reading, and a rail that ghosted out whenever Arena drew
 * something behind it was worse than one that simply covers that content.
 */
export function sidebarPresentation(
  phase: DraftState['phase'],
  enabled: boolean,
  view: ViewSize,
  layer: Pick<LayerState, 'regions' | 'selectedCell' | 'hudCovered'>
): { open: boolean } {
  return { open: enabled && (phase === 'active' || phase === 'complete') }
}

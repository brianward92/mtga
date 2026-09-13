/** Geometry and presentation state for the full Arena right-column sidebar. */
import { intersects } from '../../shared/hover'
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
 * The sidebar yields to Arena's hover preview: while the predicted preview (or
 * its flavour-text box) lands on the sidebar's strip, the sidebar fades so the
 * card the drafter is inspecting stays readable. The fade tracks the prediction
 * live rather than latching on a selected cell — a rail that stayed ghosted
 * after the cursor left was worse than one that simply covers that content.
 */
export function sidebarPresentation(
  phase: DraftState['phase'],
  enabled: boolean,
  view: ViewSize,
  layer: Pick<LayerState, 'regions' | 'selectedCell' | 'hudCovered'>
): { open: boolean; faded: boolean } {
  const open = enabled && (phase === 'active' || phase === 'complete')
  if (!open) return { open, faded: false }
  const shell = sidebarShellFrame(view, sidebarSide(phase))
  const faded = layer.regions.some(r => intersects(r, shell))
  return { open, faded }
}

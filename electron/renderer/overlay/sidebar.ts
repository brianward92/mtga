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

/** The sidebar owns its column and stays opaque during Arena previews. */
export function sidebarPresentation(
  phase: DraftState['phase'],
  enabled: boolean,
  _layer: Pick<LayerState, 'regions'>
): { open: boolean; faded: boolean } {
  const open = enabled && (phase === 'active' || phase === 'complete')
  return { open, faded: false }
}

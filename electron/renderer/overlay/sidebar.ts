/** Geometry and presentation state for the full Arena right-column sidebar. */
import { arenaContentBox, type Rect } from '../../shared/layout'
import type { DraftState, LayerState } from '../../shared/state'
import { intersects } from '../../shared/hover'
import { isFiniteNumber } from './shared'

const SIDEBAR_LEFT_FRACTION = 0.74
const SIDEBAR_TOP_FRACTION = 0.115
const SIDEBAR_INSET = 6

interface ViewSize {
  readonly width: number
  readonly height: number
}

/** Full opaque, pointer-owning Arena strip; visual content is inset inside it. */
export function sidebarShellFrame(view: ViewSize): Rect {
  const width = isFiniteNumber(view.width) ? Math.max(0, view.width) : 0
  const height = isFiniteNumber(view.height) ? Math.max(0, view.height) : 0
  if (width === 0 || height === 0) return { x: 0, y: 0, width: 0, height: 0 }
  // Arena's own right rail sits in its centred, height-scaled content box, so
  // ours starts there too — and always runs to the window's right/bottom edge.
  const box = arenaContentBox({ width, height })
  const x = Math.max(0, Math.min(width, box.x + box.width * SIDEBAR_LEFT_FRACTION))
  const y = height * SIDEBAR_TOP_FRACTION
  return { x, y, width: width - x, height: height - y }
}

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

/** Only a predicted Arena card-preview region may fade the sidebar. */
export function previewIntersectsSidebar(view: ViewSize, regions: ReadonlyArray<Rect>): boolean {
  const shell = sidebarShellFrame(view)
  return shell.width > 0 && shell.height > 0 && regions.some(region => intersects(shell, region))
}

/** Renderer-ready sidebar state, intentionally independent of `hudCovered`. */
export function sidebarPresentation(
  phase: DraftState['phase'],
  enabled: boolean,
  view: ViewSize,
  layer: Pick<LayerState, 'regions' | 'selectedCell' | 'hudCovered'>
): { open: boolean; previewCovered: boolean } {
  const open = enabled && (phase === 'active' || phase === 'complete')
  const inspectingPackCard = layer.selectedCell !== null && layer.selectedCell >= 0
  return {
    open,
    previewCovered: open && (
      previewIntersectsSidebar(view, layer.regions) ||
      (phase === 'active' && inspectingPackCard)
    )
  }
}

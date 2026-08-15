/**
 * Pure geometry for gluing the overlay panel to the Arena window.
 *
 * No Electron imports — everything here is plain math over rects so it unit
 * tests without mocks (the badge system's renderer/badges/layout.ts sets the
 * precedent). Two jobs:
 *
 *   1. Anchoring: capture the panel's position as an edge-affine, fractional
 *      offset inside (or beside) the Arena rect, then re-derive concrete
 *      bounds + a content zoom whenever Arena moves or resizes. Fractions of
 *      the Arena rect — not absolute offsets — so the panel tracks both
 *      moves and resizes; edge affinity (nearest side wins) keeps a panel
 *      docked at Arena's right edge glued to that edge as the window grows.
 *
 *   2. Magnetic snapping: candidate edges (screen work area + Arena) and the
 *      nearest-within-threshold pick used by manual drags.
 */

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export type HSide = 'left' | 'right'
export type VSide = 'top' | 'bottom'

/** The followed panel corner, e.g. bottom-right of a panel docked there. */
export interface AnchorSides {
  hSide: HSide
  vSide: VSide
}

export interface PanelAnchor extends AnchorSides {
  /**
   * Distance from the Arena side to the panel's same side, as a fraction of
   * Arena width/height. Negative when the panel sits outside Arena — those
   * offsets re-scale with the PANEL's size on apply (an outside-docked panel
   * must stay flush however Arena resizes), while non-negative ones scale
   * with Arena's size (an inside panel keeps its relative position).
   */
  fx: number
  fy: number
  /** Arena rect at capture — the scale baselines. */
  baseArenaWidth: number
  baseArenaHeight: number
  /** Content zoom at capture. */
  baseZoom: number
  /** Panel size at capture (window px, i.e. already at baseZoom). */
  baseWidth: number
  baseHeight: number
}

// Drag snapping: edges within this distance of a target pull flush.
export const SNAP_THRESHOLD = 20

// Content zoom limits while scaling with Arena (absolute, not per-capture).
export const ZOOM_MIN = 0.6
export const ZOOM_MAX = 1.8

// Panel size limits. MAX grows with zoom so a scaled-up panel isn't
// artificially saturated; MIN never shrinks (content becomes unusable).
export const PANEL_MIN_WIDTH = 240
export const PANEL_MIN_HEIGHT = 36
export const PANEL_MAX_WIDTH = 720
export const PANEL_MAX_HEIGHT = 1200

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value))
}

/** Clamp a panel size, allowing the ceiling to scale up with content zoom. */
export function clampPanelSize(
  width: number,
  height: number,
  zoom = 1
): { width: number; height: number } {
  const zoomCeil = Math.max(1, zoom)
  return {
    width: Math.round(clamp(width, PANEL_MIN_WIDTH, PANEL_MAX_WIDTH * zoomCeil)),
    height: Math.round(clamp(height, PANEL_MIN_HEIGHT, PANEL_MAX_HEIGHT * zoomCeil))
  }
}

/** Nearest Arena side per axis — the side the panel is glued to. */
export function chooseSides(arena: Rect, bounds: Rect): AnchorSides {
  const dLeft = bounds.x - arena.x
  const dRight = arena.x + arena.width - (bounds.x + bounds.width)
  const dTop = bounds.y - arena.y
  const dBottom = arena.y + arena.height - (bounds.y + bounds.height)
  return {
    hSide: Math.abs(dLeft) <= Math.abs(dRight) ? 'left' : 'right',
    vSide: Math.abs(dTop) <= Math.abs(dBottom) ? 'top' : 'bottom'
  }
}

/** Record how the panel currently sits relative to the Arena rect. */
export function captureAnchor(arena: Rect, bounds: Rect, zoom: number): PanelAnchor {
  const { hSide, vSide } = chooseSides(arena, bounds)
  const fx = hSide === 'left'
    ? (bounds.x - arena.x) / arena.width
    : (arena.x + arena.width - (bounds.x + bounds.width)) / arena.width
  const fy = vSide === 'top'
    ? (bounds.y - arena.y) / arena.height
    : (arena.y + arena.height - (bounds.y + bounds.height)) / arena.height
  return {
    hSide,
    vSide,
    fx,
    fy,
    baseArenaWidth: arena.width,
    baseArenaHeight: arena.height,
    baseZoom: zoom,
    baseWidth: bounds.width,
    baseHeight: bounds.height
  }
}

export interface ApplyAnchorOptions {
  /**
   * false in content-hugging densities (draft verdict/mini): the renderer
   * owns the height there, so only x/y/width/zoom are derived and
   * currentHeight is passed through.
   */
  scaleHeight: boolean
  currentHeight: number
}

/**
 * Concrete panel bounds + content zoom for a (possibly moved/resized) Arena
 * rect. Zoom tracks Arena height relative to the capture baseline, clamped;
 * size scales by the same effective factor so the CSS-zoomed content keeps a
 * constant layout viewport.
 */
export function applyAnchor(
  anchor: PanelAnchor,
  arena: Rect,
  opts: ApplyAnchorOptions
): { bounds: Rect; zoom: number } {
  // Zoom floor: never let base*s dip under the size minimums — a floor-clamped
  // size with a smaller CSS zoom would widen the layout viewport and reflow
  // the content instead of shrinking it uniformly. (baseWidth >= PANEL_MIN
  // always, so the floor never exceeds baseZoom <= ZOOM_MAX.)
  let zoomFloor = Math.max(ZOOM_MIN, (anchor.baseZoom * PANEL_MIN_WIDTH) / anchor.baseWidth)
  if (opts.scaleHeight) {
    zoomFloor = Math.max(zoomFloor, (anchor.baseZoom * PANEL_MIN_HEIGHT) / anchor.baseHeight)
  }
  const zoom = clamp(
    anchor.baseZoom * (arena.height / anchor.baseArenaHeight),
    Math.min(zoomFloor, ZOOM_MAX),
    ZOOM_MAX
  )
  const s = zoom / anchor.baseZoom
  const size = clampPanelSize(
    anchor.baseWidth * s,
    opts.scaleHeight ? anchor.baseHeight * s : opts.currentHeight,
    zoom
  )
  const height = opts.scaleHeight ? size.height : opts.currentHeight

  // Inside offsets (fx >= 0) scale with Arena; outside offsets (fx < 0)
  // scale with the panel so a flush outside dock stays flush through any
  // resize (its magnitude is panel-sized, not Arena-sized).
  const edgeX = anchor.fx >= 0
    ? anchor.fx * arena.width
    : anchor.fx * anchor.baseArenaWidth * (size.width / anchor.baseWidth)
  const edgeY = anchor.fy >= 0
    ? anchor.fy * arena.height
    : anchor.fy * anchor.baseArenaHeight * (height / anchor.baseHeight)

  const x = anchor.hSide === 'left'
    ? arena.x + edgeX
    : arena.x + arena.width - edgeX - size.width
  const y = anchor.vSide === 'top'
    ? arena.y + edgeY
    : arena.y + arena.height - edgeY - height

  return {
    bounds: { x: Math.round(x), y: Math.round(y), width: size.width, height },
    zoom
  }
}

/**
 * Snap targets for a manual drag: screen work-area edges always; when Arena
 * is live, its edges too — aligned inside its corners or docked flush
 * against its outside.
 */
export function snapCandidates(
  workArea: Rect,
  size: { width: number; height: number },
  arena: Rect | null
): { x: number[]; y: number[] } {
  const x = [workArea.x, workArea.x + workArea.width - size.width]
  const y = [workArea.y, workArea.y + workArea.height - size.height]
  if (arena) {
    x.push(
      arena.x,                            // inside-left
      arena.x + arena.width - size.width, // inside-right
      arena.x + arena.width,              // docked outside-right
      arena.x - size.width                // docked outside-left
    )
    y.push(
      arena.y,                              // inside-top
      arena.y + arena.height - size.height, // inside-bottom
      arena.y + arena.height,               // docked below
      arena.y - size.height                 // docked above
    )
  }
  return { x, y }
}

/** Nearest candidate within the snap threshold, or the original value. */
export function snapAxis(
  value: number,
  candidates: number[],
  threshold = SNAP_THRESHOLD
): number {
  let best = value
  let bestDist = threshold + 1
  for (const c of candidates) {
    const d = Math.abs(value - c)
    if (d < bestDist) {
      best = c
      bestDist = d
    }
  }
  return best
}

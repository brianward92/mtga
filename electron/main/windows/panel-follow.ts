/**
 * Glues the overlay panel to the Arena window ("follow" mode).
 *
 * Consumes the ArenaGeometryPoller stream (via main/index.ts): on the first
 * found rect it captures an anchor from wherever the panel currently sits —
 * never moving it — and from then on re-derives bounds + content zoom on
 * every Arena move/resize. Losing Arena simply drops the anchor; the panel
 * free-floats where it is and re-anchors in place when Arena returns, so
 * nothing ever teleports.
 *
 * Precedence rules (each guards a real race, see the drag pipeline in
 * renderer/overlay/window-controls.ts):
 *   - A user drag/resize always wins: follow application is suppressed while
 *     a gesture is recent, and the anchor is recaptured on gesture end.
 *     Suppression is timestamp-based, not paired start/end calls — a
 *     micro-drag can legitimately end without an overlay-move-end.
 *   - Mode/density reshapes animate from main: recapture is deferred until
 *     the animation has settled rather than reading mid-flight bounds.
 *   - A hidden or minimized panel is never repositioned.
 */

import { BrowserWindow } from 'electron'
import { ArenaRect } from '../arena-geometry'
import {
  AnchorSides,
  PanelAnchor,
  applyAnchor,
  captureAnchor,
  clampPanelSize
} from './panel-anchor'
import {
  applyFollowBounds,
  getDraftDensity,
  getFollowZoom,
  getOverlayMode,
  isOverlayPresented,
  setFollowZoom
} from './overlay'

/** Ignore geometry while a user gesture happened this recently (ms). */
const GESTURE_SUPPRESS_MS = 1200
/** Mode/density reshapes animate; wait this long before trusting bounds. */
const RESHAPE_SETTLE_MS = 500

export interface PanelFollowDeps {
  getWindow(): BrowserWindow | null
  /** The "Glue Overlay to Arena" preference. */
  isEnabled(): boolean
  /** Fresh Arena rect, or null unless the poller currently sees Arena. */
  getArena(): ArenaRect | null
}

export class PanelFollow {
  private anchor: PanelAnchor | null = null
  private lastGestureAt = 0
  private recaptureTimer: NodeJS.Timeout | null = null

  constructor(private readonly deps: PanelFollowDeps) {}

  /**
   * The corner the panel is glued to (content resizes should preserve it).
   * Null while a reshape is settling — the anchor may predate the reshape,
   * and misdirecting a content resize is worse than one top-left-anchored
   * frame.
   */
  getAnchorSides(): AnchorSides | null {
    if (!this.anchor || this.recaptureTimer || !this.deps.isEnabled()) return null
    return { hSide: this.anchor.hSide, vSide: this.anchor.vSide }
  }

  /** Poller 'geometry': first sight anchors in place, later ones follow. */
  handleGeometry(rect: ArenaRect): void {
    const window = this.window()
    if (!window || !this.deps.isEnabled()) return
    if (!isOverlayPresented(window)) {
      // Never reposition a hidden/minimized panel; re-anchor when shown.
      this.anchor = null
      return
    }
    if (Date.now() - this.lastGestureAt < GESTURE_SUPPRESS_MS) return
    if (this.recaptureTimer) return // reshape in flight — bounds not settled

    if (!this.anchor) {
      this.anchor = captureAnchor(rect, window.getBounds(), getFollowZoom())
      return
    }

    const current = window.getBounds()
    const scaleHeight = !(getOverlayMode() === 'draft' && getDraftDensity() !== 'full')
    const { bounds, zoom } = applyAnchor(this.anchor, rect, {
      scaleHeight,
      currentHeight: current.height
    })
    if (
      bounds.x !== current.x || bounds.y !== current.y ||
      bounds.width !== current.width || bounds.height !== current.height
    ) {
      applyFollowBounds(window, bounds)
    }
    if (Math.abs(zoom - getFollowZoom()) > 0.01) {
      setFollowZoom(window, zoom)
    }
  }

  /** Poller 'lost': free-float in place; re-anchor on the next found rect. */
  handleLost(): void {
    this.anchor = null
  }

  /** Any in-progress drag/resize traffic (start + every move). */
  noteUserActivity(): void {
    this.lastGestureAt = Date.now()
  }

  /** Drag/resize finished where the user wanted it — re-anchor there. */
  noteUserGestureEnd(): void {
    this.lastGestureAt = 0
    this.recaptureNow()
  }

  /** Mode/density/calibration reshaped the window (animated from main). */
  noteReshape(): void {
    if (this.recaptureTimer) clearTimeout(this.recaptureTimer)
    this.recaptureTimer = setTimeout(() => {
      this.recaptureTimer = null
      this.recaptureNow()
    }, RESHAPE_SETTLE_MS)
  }

  /** Pref or visibility changed. Disabling restores unscaled content. */
  refresh(): void {
    if (this.deps.isEnabled()) {
      // A reshape is animating: its timer will recapture from settled
      // bounds; capturing now would freeze mid-flight geometry.
      if (this.recaptureTimer) return
      this.recaptureNow()
      return
    }
    this.anchor = null
    const window = this.window()
    const zoom = getFollowZoom()
    if (window && zoom !== 1) {
      const b = window.getBounds()
      setFollowZoom(window, 1)
      applyFollowBounds(window, {
        x: b.x,
        y: b.y,
        ...clampPanelSize(b.width / zoom, b.height / zoom, 1)
      })
    }
  }

  dispose(): void {
    if (this.recaptureTimer) clearTimeout(this.recaptureTimer)
    this.recaptureTimer = null
  }

  private recaptureNow(): void {
    const window = this.window()
    const arena = this.deps.getArena()
    if (window && arena && this.deps.isEnabled() && isOverlayPresented(window)) {
      this.anchor = captureAnchor(arena, window.getBounds(), getFollowZoom())
    } else {
      this.anchor = null
    }
  }

  private window(): BrowserWindow | null {
    const window = this.deps.getWindow()
    return window && !window.isDestroyed() ? window : null
  }
}

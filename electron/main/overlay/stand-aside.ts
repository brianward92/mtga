/**
 * "Arena's own UI wins": while the drafter reaches into Arena's menu bar
 * (Packs/Store/… and the gear that opens Options), the overlay steps aside —
 * Arena draws its menus and modals inside its own window, so nothing else can
 * be layered under them.
 *
 * Deliberately simple and self-healing: the overlay is out of the way only
 * while the cursor is up there, plus a short grace so passing back down does
 * not flicker. There is no long-lived hidden state to get stuck in — an
 * overlay that vanishes for tens of seconds reads as a broken app.
 *
 * Cursor-only, so it needs no permissions and no window capture.
 */
import { arenaContentBox } from '../../shared/layout'

/** Bottom of Arena's own menu bar, as a fraction of the window height. */
export const CHROME_BAND_FRACTION = 0.145
/**
 * Top of the band: above it is the macOS title bar, which is where the window
 * gets dragged — grabbing it must not read as reaching for Arena's menus.
 */
export const CHROME_BAND_TOP_FRACTION = 0.05
/** The cursor must rest in the band this long: sweeping past is not intent. */
export const CHROME_DWELL_MS = 250
/** How long the overlay stays away after the cursor leaves the band. */
export const LEAVE_GRACE_MS = 1_500
/** Moving or resizing the window suppresses the whole behaviour briefly. */
export const WINDOW_MOVE_GRACE_MS = 700

export interface Point { x: number; y: number }
export interface Rect { x: number; y: number; width: number; height: number }

/** True when the cursor sits in Arena's menu bar (window-relative point). */
export function inChromeBand(local: Point, rect: Pick<Rect, 'width' | 'height'>): boolean {
  if (rect.width <= 0 || rect.height <= 0) return false
  if (local.y < rect.height * CHROME_BAND_TOP_FRACTION) return false
  if (local.y > rect.height * CHROME_BAND_FRACTION) return false
  const box = arenaContentBox(rect)
  return local.x >= box.x && local.x <= box.x + box.width
}

export class StandAside {
  private inBandSince: number | null = null
  private awayUntil = 0
  private suppressUntil = 0
  private wasActive = false

  /** True while the overlay should stay out of Arena's way. */
  get active(): boolean { return this.wasActive }

  /** Feed a cursor sample; returns true when the visible state changed. */
  sample(local: Point, rect: Pick<Rect, 'width' | 'height'>, now: number): boolean {
    if (now < this.suppressUntil) {
      this.inBandSince = null
      this.awayUntil = 0
      return this.settle(false)
    }
    if (inChromeBand(local, rect)) {
      if (this.inBandSince === null) this.inBandSince = now
      const dwelt = now - this.inBandSince >= CHROME_DWELL_MS
      if (dwelt) this.awayUntil = now + LEAVE_GRACE_MS
      return this.settle(dwelt)
    }
    this.inBandSince = null
    return this.settle(now < this.awayUntil)
  }

  /**
   * The window moved or resized: the drafter is arranging their screen, not
   * opening Arena's menus (dragging holds the cursor near the band).
   */
  noteWindowMoved(now: number): boolean {
    this.suppressUntil = now + WINDOW_MOVE_GRACE_MS
    return this.release()
  }

  /** The draft moved on (or the user asked): come back immediately. */
  release(): boolean {
    this.inBandSince = null
    this.awayUntil = 0
    return this.settle(false)
  }

  private settle(active: boolean): boolean {
    if (active === this.wasActive) return false
    this.wasActive = active
    return true
  }
}

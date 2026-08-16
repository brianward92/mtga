/**
 * "Arena's own UI wins": while the drafter reaches into Arena's top menu bar
 * (Home/Packs/Store/… and the gear that opens Options), the overlay steps
 * aside completely — Arena draws its menus and modals inside its own window,
 * so nothing else can be z-ordered under them.
 *
 * Detection is cursor-only (no permissions, no capture): entering the chrome
 * band latches "stand aside" until the draft moves on (a new pack or pick),
 * a timeout expires, or the user toggles the overlay back by hand.
 */
import { arenaContentBox } from '../../shared/layout'

/** Fraction of the window height occupied by Arena's title + menu bar. */
export const CHROME_BAND_FRACTION = 0.145
/** How long the overlay stays out of the way with no other signal. */
export const STAND_ASIDE_TIMEOUT_MS = 25_000
/** The cursor must rest in the menu bar this long: sweeping past is not intent. */
export const CHROME_DWELL_MS = 250

export interface Point { x: number; y: number }
export interface Rect { x: number; y: number; width: number; height: number }

/** True when the cursor sits in Arena's top menu bar (window-relative point). */
export function inChromeBand(local: Point, rect: Pick<Rect, 'width' | 'height'>): boolean {
  if (rect.width <= 0 || rect.height <= 0) return false
  if (local.y < 0 || local.y > rect.height * CHROME_BAND_FRACTION) return false
  const box = arenaContentBox(rect)
  return local.x >= box.x && local.x <= box.x + box.width
}

/**
 * Latch: `sample` while the overlay is up, `release` when the draft advances
 * or the user asks for the overlay back.
 */
export class StandAside {
  private since: number | null = null
  private enteredAt: number | null = null

  /** True while the overlay should stay hidden. */
  get active(): boolean { return this.since !== null }

  /** Feed a cursor sample; returns true when the state changed. */
  sample(local: Point, rect: Pick<Rect, 'width' | 'height'>, now: number): boolean {
    if (inChromeBand(local, rect)) {
      if (this.enteredAt === null) this.enteredAt = now
      if (now - this.enteredAt < CHROME_DWELL_MS) return false
      const changed = this.since === null
      this.since = now
      return changed
    }
    this.enteredAt = null
    if (this.since !== null && now - this.since >= STAND_ASIDE_TIMEOUT_MS) {
      this.since = null
      return true
    }
    return false
  }

  /** The draft moved on (or the user asked): come back. */
  release(): boolean {
    this.enteredAt = null
    if (this.since === null) return false
    this.since = null
    return true
  }
}

/**
 * "Arena's own UI wins": when the drafter CLICKS into Arena's menu bar
 * (Packs/Store/… and the gear that opens Options), the overlay steps aside —
 * Arena draws its menus and modals inside its own window, so nothing else can
 * be layered under them.
 *
 * Deliberately click-driven. Hovering the band used to be enough, but merely
 * moving the cursor up there is not leaving the draft screen, and an overlay
 * that blinks out under a passing cursor reads as a broken app. A click into
 * the band means the drafter has actually opened something in front of the
 * draft; closing Options with Escape (or the next pick landing) brings us back.
 *
 * Input-driven, with no window capture.
 */
import { arenaContentBox, sidebarShellFrame, type SidebarSide } from '../../shared/layout'

/** Bottom of Arena's own menu bar, as a fraction of the window height. */
export const CHROME_BAND_FRACTION = 0.145
/**
 * Top of the band: above it is the macOS title bar, which is where the window
 * gets dragged — grabbing it must not read as reaching for Arena's menus.
 */
export const CHROME_BAND_TOP_FRACTION = 0.05
/** Moving or resizing the window suppresses the whole behaviour briefly. */
export const WINDOW_MOVE_GRACE_MS = 700

export interface Point { x: number; y: number }
export interface Rect { x: number; y: number; width: number; height: number }

/** True when the point sits in Arena's menu bar (window-relative). */
export function inChromeBand(
  local: Point,
  rect: Pick<Rect, 'width' | 'height'> & { titleBarHeight?: number },
  side: SidebarSide = 'right'
): boolean {
  if (rect.width <= 0 || rect.height <= 0) return false
  const top = rect.titleBarHeight === 0 ? 0 : rect.height * CHROME_BAND_TOP_FRACTION
  if (local.y < top) return false
  if (local.y > rect.height * CHROME_BAND_FRACTION) return false
  // Our own sidebar is not Arena's menu bar. Its top edge reaches up into the
  // band; only the sidebar's real rect is excused, because Arena's gear sits
  // just above it and clicking that must still step us aside.
  const sidebar = sidebarShellFrame(rect as { width: number; height: number }, side)
  if (sidebar.width > 0 && local.y >= sidebar.y &&
    local.x >= sidebar.x && local.x < sidebar.x + sidebar.width) return false
  const box = arenaContentBox(rect)
  return local.x >= box.x && local.x <= box.x + box.width
}

export class StandAside {
  private suppressUntil = 0
  private wasActive = false
  private menuDepth = 0

  /** True while the overlay should stay out of Arena's way. */
  get active(): boolean { return this.wasActive }

  /**
   * Feed a mouse-down (window-relative); returns true when visibility changed.
   *
   * A menu click opens an exclusive Arena interaction. Keep it latched
   * through settings clicks and fullscreen transitions.
   */
  noteClick(local: Point, rect: Pick<Rect, 'width' | 'height'> & { titleBarHeight?: number }, now: number, side: SidebarSide = 'right'): boolean {
    const x = local.x / rect.width, y = local.y / rect.height
    if (this.wasActive) {
      // Menu choices are in the centre of the game. They must never release
      // the overlay merely because they are below the navigation bar.
      if (x >= 0.28 && x <= 0.73 && y >= 0.18 && y <= 0.84) {
        if (this.menuDepth === 1 && y >= 0.35 && y <= 0.55) this.menuDepth = 2
        return false
      }
      // Arena's back arrow returns from a settings subpage to Options.
      if (x >= 0.04 && x <= 0.16 && y >= 0.18 && y <= 0.36) {
        if (this.menuDepth > 1) { this.menuDepth--; return false }
        return this.release()
      }
      if (inChromeBand(local, rect, side)) return false
      // Remain hidden across ambiguous clicks; Escape or a new draft event
      // is the reliable way back. A settings backdrop is not the draft.
      return false
    }
    if (now < this.suppressUntil) return false
    if (!inChromeBand(local, rect, side)) return false
    this.menuDepth = 1
    return this.settle(true)
  }

  /**
   * The window moved or resized: the drafter is arranging their screen, not
   * opening Arena's menus (dragging holds the cursor near the band).
   */
  noteWindowMoved(now: number): boolean {
    this.suppressUntil = now + WINDOW_MOVE_GRACE_MS
    return false
  }

  /** Escape returns through a settings subpage before closing Options. */
  noteEscape(): boolean {
    if (!this.wasActive) { this.menuDepth = 1; return this.settle(true) }
    if (this.menuDepth > 1) { this.menuDepth--; return false }
    return this.release()
  }

  /** The draft moved on (or the user asked): come back immediately. */
  release(): boolean {
    this.menuDepth = 0
    return this.settle(false)
  }

  private settle(active: boolean): boolean {
    if (active === this.wasActive) return false
    this.wasActive = active
    return true
  }
}

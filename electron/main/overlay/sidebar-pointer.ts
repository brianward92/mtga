/**
 * Who owns the pointer over the sidebar strip.
 *
 * macOS delivers every mouse-moved event to the active application wherever
 * the pointer is; a window on top that takes the mouse changes nothing about
 * that. Arena is the active application, so with the pointer resting on the
 * sidebar Arena still saw it over its drafted-pool column underneath and
 * popped previews out from under the strip. Taking the mouse for the window
 * only made the strip opaque to clicks.
 *
 * The only way to make the strip a dead zone is to be the active application
 * ourselves while the pointer is on it. Mouse-moved then reaches only the
 * window under the pointer: our opaque strip, so Arena sees nothing there,
 * while over the transparent rest of the overlay the pointer still reaches
 * Arena, so pack previews keep working. When the pointer leaves the strip
 * Arena gets activation back, so its next click lands as a click and not as
 * an activation.
 *
 * Pure: the process wiring (Electron activation, the native helper) lives in
 * main/index.ts.
 */
import { sidebarShellFrame, type SidebarSide } from '../../shared/layout'

export interface Point { x: number; y: number }
export interface Size { width: number; height: number }

/** True when a window-relative point lies on the sidebar strip. */
export function pointOnSidebar(local: Point, view: Size, side: SidebarSide): boolean {
  const r = sidebarShellFrame(view, side)
  return r.width > 0 && r.height > 0 &&
    local.x >= r.x && local.x < r.x + r.width && local.y >= r.y && local.y < r.y + r.height
}

/** What to do as the pointer's relationship with the strip changes. */
export type SidebarPointerAction = 'claim' | 'release'

export class SidebarPointer {
  private owned = false

  /** Whether the strip currently holds the pointer (and activation). */
  get active(): boolean { return this.owned }

  /**
   * Feed whether the pointer is on an open, visible strip. Returns the
   * transition to perform, or null when nothing changed.
   */
  update(onStrip: boolean): SidebarPointerAction | null {
    if (onStrip === this.owned) return null
    this.owned = onStrip
    return onStrip ? 'claim' : 'release'
  }
}

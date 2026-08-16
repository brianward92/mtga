/**
 * Pointer ownership for the joined HUD + sheet rail.
 *
 * This owns dwell timers, yield classes, topology reconciliation, and the
 * overlay window's interactive state. Pack-card hover remains in overlay.ts.
 */
import {
  EMPTY_RAIL_DWELL,
  advanceRailDwell,
  pointInRailBounds,
  railDwellDelay,
  railDwellIncludes,
  railDwellTarget,
  railTopology,
  reconcileRailDwellTopology,
  type RailDwellState,
  type RailDwellTarget,
  type RailPanel,
  type RailTopology
} from './rail-dwell'

/** Coordinates pointer dwell and click-through behavior for the HUD/sheet rail. */
export class RailInteraction {
  private interactive = false
  private dwell: RailDwellState = EMPTY_RAIL_DWELL
  private dwellTimer: number | null = null
  private topology: RailTopology = 'none'

  constructor(
    private readonly hudRoot: HTMLElement,
    private readonly sheetRoot: HTMLElement,
    private readonly setWindowInteractive: (on: boolean) => void,
    private readonly sidebarRoot: HTMLElement | null = null
  ) {}

  /** Reconcile dwell state after a render may have changed rail geometry. */
  syncTopology(): void {
    const next = this.measuredTopology()
    if (next !== this.topology) {
      this.dwell = reconcileRailDwellTopology(this.dwell, this.topology, next)
      this.topology = next
      this.clearDwellTimer()
      // A shortcut/phase/pref transition can move the rail out from under a
      // stationary cursor. Resume click-through until forwarded movement
      // establishes a target in the new topology.
      this.setInteractive(false)
    }
    if (this.sidebarRoot?.classList.contains('open')) this.resetDwell()
    // Hud.update replaces its base class string; preserve a valid active yield.
    this.applyYield()
  }

  /** Process one forwarded pointer move; true means pack hover must stay clear. */
  handlePointerMove(element: Element | null, x: number, y: number): boolean {
    const hit = !!(element && element.closest('.interactive'))
    // The full draft sidebar owns Arena's right column. It must remain opaque
    // and interactive on dwell; only predicted pack-preview state may fade it.
    if (this.sidebarRoot?.classList.contains('open')) {
      this.resetDwell()
      this.setInteractive(hit)
      return hit
    }
    const railTarget = this.railTargetAt(element, x, y)
    const yielded = this.updateDwell(railTarget)
    this.setInteractive(hit && !yielded)
    return hit || railTarget !== null
  }

  /** Release pointer ownership and cancel any pending rail dwell. */
  releasePointer(): void {
    this.updateDwell(null)
    this.setInteractive(false)
  }

  private setInteractive(on: boolean): void {
    if (on === this.interactive) return
    this.interactive = on
    this.setWindowInteractive(on)
  }

  private panelVisible(panel: RailPanel): boolean {
    if (document.body.classList.contains('calibrating')) return false
    if (panel === 'hud') {
      return this.hudRoot.classList.contains('interactive') &&
        !this.hudRoot.classList.contains('hidden') &&
        !this.hudRoot.classList.contains('covered')
    }
    return this.sheetRoot.classList.contains('interactive') && this.sheetRoot.classList.contains('open')
  }

  private measuredTopology(): RailTopology {
    const hudVisible = this.panelVisible('hud')
    const sheetVisible = this.panelVisible('sheet')
    let joined = false
    if (hudVisible && sheetVisible) {
      const hudBounds = this.hudRoot.getBoundingClientRect()
      const sheetBounds = this.sheetRoot.getBoundingClientRect()
      joined = sheetBounds.height > 0 && (
        (this.sheetRoot.classList.contains('stack-below') && Math.abs(hudBounds.bottom - sheetBounds.top) <= 1) ||
        (this.sheetRoot.classList.contains('stack-above') && Math.abs(sheetBounds.bottom - hudBounds.top) <= 1)
      )
    }
    return railTopology(hudVisible, sheetVisible, joined)
  }

  private applyYield(): void {
    this.hudRoot.classList.toggle('yield', railDwellIncludes(this.dwell.yielded, 'hud'))
    this.sheetRoot.classList.toggle('yield', railDwellIncludes(this.dwell.yielded, 'sheet'))
  }

  private railTargetAt(element: Element | null, x: number, y: number): RailDwellTarget | null {
    // Buttons opt back into pointer events inside a yielded rail. Check them
    // before the bounds fallback so entering one immediately restores both
    // joined panels and their clicks.
    if (element?.closest('button, .hud-icon, .sheet-close')) return null
    const joined = this.topology === 'rail'
    if (this.dwell.yielded !== null) {
      // Map a bounds hit through the current topology. Opening/closing or
      // hiding a sibling starts a fresh dwell for the new surface.
      if (railDwellIncludes(this.dwell.yielded, 'hud') && this.panelVisible('hud') &&
        pointInRailBounds(x, y, this.hudRoot.getBoundingClientRect())) {
        return railDwellTarget('hud', joined)
      }
      if (railDwellIncludes(this.dwell.yielded, 'sheet') && this.panelVisible('sheet') &&
        pointInRailBounds(x, y, this.sheetRoot.getBoundingClientRect())) {
        return railDwellTarget('sheet', joined)
      }
    }
    if (!element) return null
    const panel = element.closest<HTMLElement>('.hud.interactive, .sheet.interactive')
    if (panel === this.hudRoot) return railDwellTarget('hud', joined)
    if (panel === this.sheetRoot) return railDwellTarget('sheet', joined)
    return null
  }

  private updateDwell(target: RailDwellTarget | null, now = performance.now()): boolean {
    const previousYield = this.dwell.yielded
    this.dwell = advanceRailDwell(this.dwell, target, now)
    if (previousYield !== this.dwell.yielded) this.applyYield()

    this.clearDwellTimer()
    const delay = railDwellDelay(this.dwell, now)
    if (delay !== null) {
      this.dwellTimer = window.setTimeout(() => {
        this.dwellTimer = null
        this.updateDwell(this.dwell.target)
      }, delay)
    }

    if (this.dwell.yielded !== null) this.setInteractive(false)
    return this.dwell.yielded !== null
  }

  private clearDwellTimer(): void {
    if (this.dwellTimer === null) return
    window.clearTimeout(this.dwellTimer)
    this.dwellTimer = null
  }

  private resetDwell(): void {
    this.clearDwellTimer()
    if (this.dwell === EMPTY_RAIL_DWELL) return
    this.dwell = EMPTY_RAIL_DWELL
    this.applyYield()
  }
}

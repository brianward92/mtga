/**
 * Binds Arena presence/geometry to the overlay window while preserving the
 * short lost→found reappearance delay. Kept Electron-free so the real poller
 * and timer lifecycle can be exercised together in tests.
 */
import type { ArenaRect } from '../arena-geometry'
import {
  INITIAL_OVERLAY_REAPPEARANCE,
  advanceOverlayReappearance,
  mayShowOverlay,
  overlayReappearanceDelay,
  type OverlayReappearanceState
} from './reappearance'

interface OverlayGeometrySyncDeps {
  targetAvailable: () => boolean
  arenaFound: () => boolean
  arenaRect: () => ArenaRect | null
  arenaFrontmost: () => boolean
  contentWanted: () => boolean
  setRect: (rect: ArenaRect) => void
  show: () => void
  hide: () => void
  afterSync?: () => void
  now?: () => number
}

/** Synchronizes an overlay target with Arena geometry and reappearance state. */
export class OverlayGeometrySync {
  private state: OverlayReappearanceState = INITIAL_OVERLAY_REAPPEARANCE
  private timer: NodeJS.Timeout | null = null
  private token = 0

  constructor(private readonly deps: OverlayGeometrySyncDeps) {}

  /** Apply the latest presence, bounds, foreground, and visibility inputs. */
  sync(): void {
    if (!this.deps.targetAvailable()) {
      this.cancelTimer()
      return
    }

    const now = this.deps.now?.() ?? Date.now()
    const rect = this.deps.arenaRect()
    const found = this.deps.arenaFound() && rect !== null
    this.state = advanceOverlayReappearance(this.state, found, now)
    const delay = overlayReappearanceDelay(this.state, now)
    if (delay === null) this.cancelTimer()
    else this.schedule(delay)

    // Preserve the last bounds while lost; the target is hidden below and a
    // fresh found observation replaces them before any delayed re-show.
    if (rect) this.deps.setRect(rect)
    if (mayShowOverlay(this.state, found && this.deps.contentWanted(), this.deps.arenaFrontmost())) {
      this.deps.show()
    } else {
      this.deps.hide()
    }
    this.deps.afterSync?.()
  }

  /** Cancel pending reappearance and return to the unobserved state. */
  reset(): void {
    this.cancelTimer()
    this.state = INITIAL_OVERLAY_REAPPEARANCE
  }

  /** Release the pending timer and reset state. */
  dispose(): void { this.reset() }

  private cancelTimer(): void {
    this.token += 1
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private schedule(delayMs: number): void {
    this.cancelTimer()
    const token = this.token
    this.timer = setTimeout(() => {
      if (token !== this.token) return
      this.timer = null
      this.sync()
    }, delayMs)
  }
}

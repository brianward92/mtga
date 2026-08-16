/**
 * Arena layer awareness for the overlay.
 *
 * Arena is one native window; its hover previews and modals are drawn INSIDE
 * it, so no overlay can be z-ordered between them and the pack. We approximate
 * proper layering: with window capture (native helper, one-shot screenshots),
 * keep a "clear" baseline of the pack and per-cell diff each frame — a cell
 * whose pixels changed is covered by something (preview of any shape, modal
 * scrim) and its badge lifts; whole-pack darkening / no pack on screen lifts
 * everything. Without capture, predict the hover preview from the cursor.
 */
import { EventEmitter } from 'events'
import { screen } from 'electron'
import type { ArenaGeometryPoller, ArenaRect, HelperFrame } from '../arena-geometry'
import { packLayout, type CalibrationConfig, type Rect } from '../../shared/layout'
import {
  HoverPreviewIntent,
  hoveredCardIndex,
  intersects,
  isRightmostGridColumn,
  predictPopout,
  previewCoveredCellIndices
} from '../../shared/hover'
import { detectOcclusion, scaleRect, cardness, CARDNESS_MIN, ABS_DARK, meanLuminanceInRect, frameFromBytes, type GrayFrame } from './occlusion'

import type { LayerState } from '../../shared/state'

const EMPTY: LayerState = { cells: [], regions: [], covered: false, hudCovered: false }
/** Inputs the layer detector reads from main-process application state. */
interface LayerDeps {
  poller: ArenaGeometryPoller
  /** Number of cards in the live pack (0 when none). */
  packCount: () => number
  /** Card names in Arena display order, used to identify split previews. */
  names?: () => string[]
  config: (rect: ArenaRect) => CalibrationConfig
  /** Whether badges are wanted right now (draft live, enabled, visible). */
  active: () => boolean
}

/** Detects Arena content covering badges, with a cursor-prediction fallback. */
export class LayerDetector extends EventEmitter {
  private baseline: GrayFrame | null = null
  private baselineCardness = 0
  private lastFrameAt = 0
  private last: LayerState = EMPTY
  private lastKey = ''
  private hudRect: Rect | null = null
  private layoutKey = ''
  private layoutCache: ReturnType<typeof packLayout> | null = null
  private fallbackTimer: NodeJS.Timeout | null = null
  /** Enter dwell + leave grace for the cursor prediction fallback. */
  private hoverIntent = new HoverPreviewIntent()

  constructor(private deps: LayerDeps) {
    super()
    deps.poller.on('frame', (f: HelperFrame) => this.onFrame(f))
  }

  /** Most recently published layer state. */
  get state(): LayerState { return this.last }

  /** Renderer tells us where its HUD is (window px) so we can lift it too. */
  setHudRect(rect: Rect | null): void { this.hudRect = rect }

  /** New pack / new draft: the clear baseline no longer applies. */
  resetBaseline(): void {
    this.baseline = null
    this.baselineCardness = 0
  }

  /**
   * Start the cursor fallback only while badges are live. Main calls this
   * whenever draft, preference, calibration, or Arena visibility changes.
   */
  syncActivity(): void {
    if (this.deps.active()) {
      if (!this.fallbackTimer) this.fallbackTimer = setInterval(() => this.fallbackTick(), 50)
      return
    }
    if (this.fallbackTimer) clearInterval(this.fallbackTimer)
    this.fallbackTimer = null
    this.hoverIntent.reset()
    this.publish(EMPTY)
  }

  /** Stop fallback polling and release its timer. */
  dispose(): void {
    if (this.fallbackTimer) clearInterval(this.fallbackTimer)
    this.fallbackTimer = null
  }

  private layout(rect: ArenaRect, count: number) {
    const key = `${rect.width}x${rect.height}:${count}`
    if (this.layoutKey !== key || !this.layoutCache) {
      this.layoutKey = key
      this.layoutCache = packLayout({ width: rect.width, height: rect.height }, count, this.deps.config(rect))
    }
    return this.layoutCache
  }

  private publish(next: LayerState): void {
    const key = `${next.covered ? 1 : 0}|${next.hudCovered ? 1 : 0}|${next.cells.join(',')}|` +
      next.regions.map(r => [r.x, r.y, r.width, r.height].map(Math.round).join(',')).join(';')
    if (key === this.lastKey) return
    this.lastKey = key
    this.last = next
    this.emit('change', next)
  }

  private cursorLocal(rect: ArenaRect): { x: number; y: number } {
    // Test seam: the e2e harness fakes the Arena window over the whole screen,
    // so the real OS cursor would "hover" cells at random.
    if (process.env.MTGA_E2E === '1') return { x: -1, y: -1 }
    const c = screen.getCursorScreenPoint()
    return { x: c.x - rect.x, y: c.y - rect.y }
  }

  private onFrame(hf: HelperFrame): void {
    this.lastFrameAt = Date.now()
    const rect = this.deps.poller.lastKnown
    const count = this.deps.packCount()
    if (!this.deps.active() || !rect || count === 0) { this.publish(EMPTY); return }
    const view = { width: rect.width, height: rect.height }
    const layout = this.layout(rect, count)
    const cellRects = layout.cards.map(c => c.card)
    const hoveredIdx = hoveredCardIndex(this.cursorLocal(rect), cellRects)

    const frame = frameFromBytes(hf.width, hf.height, hf.data)
    const fsize = { width: frame.width, height: frame.height }
    const packPx = scaleRect(layout.pack, view, fsize)
    const cellsPx = cellRects.map(r => scaleRect(r, view, fsize))
    const hudPx = this.hudRect ? scaleRect(this.hudRect, view, fsize) : null
    const result = detectOcclusion(frame, this.baseline, packPx, cellsPx, hudPx)

    const packLum = meanLuminanceInRect(frame, packPx)
    const score = cardness(frame, packPx, cellsPx) ?? 0
    const packOnScreen = score >= CARDNESS_MIN && packLum !== null && packLum >= ABS_DARK

    const sizeChanged = this.baseline !== null && (frame.width !== this.baseline.width || frame.height !== this.baseline.height)
    if (packOnScreen && hoveredIdx < 0 && (this.baseline === null || sizeChanged || score >= this.baselineCardness * 0.9)) {
      this.baseline = frame
      this.baselineCardness = score
    }

    if (!packOnScreen && (hoveredIdx < 0 || result.packCovered)) {
      this.publish({ cells: [], regions: [], covered: true, hudCovered: result.packCovered })
      return
    }
    if (this.baseline) {
      this.publish({ cells: result.coveredCells.filter(i => i !== hoveredIdx), regions: [], covered: result.packCovered, hudCovered: result.extraCovered || result.packCovered })
      return
    }
    this.predict(hoveredIdx, cellRects, view, this.deps.config(rect).maxCols)
  }

  private predict(
    hoveredIdx: number,
    cellRects: Rect[],
    view: { width: number; height: number },
    maxCols: number
  ): void {
    const name = hoveredIdx >= 0 ? this.deps.names?.()[hoveredIdx] : undefined
    const split = typeof name === 'string' && name.includes(' // ')
    const flipLeft = isRightmostGridColumn(hoveredIdx, maxCols)
    const regions = hoveredIdx >= 0 ? predictPopout(cellRects[hoveredIdx], view, { split, flipLeft }) : []
    const cells = previewCoveredCellIndices(cellRects, hoveredIdx, regions)
    const hudCovered = !!this.hudRect && regions.some(r => intersects(r, this.hudRect!))
    this.publish({ cells, regions, covered: false, hudCovered })
  }

  /**
   * No frame stream (no capture permission / helper missing): cursor
   * prediction with dwell hysteresis — Arena only pops its preview after the
   * cursor rests on a card, so lifting neighbours the instant the cursor
   * sweeps across a row would just make the badges flap.
   */
  private fallbackTick(): void {
    const rect = this.deps.poller.lastKnown
    const count = this.deps.packCount()
    if (!this.deps.active() || !rect || count === 0) { this.publish(EMPTY); this.hoverIntent.reset(); return }
    if (Date.now() - this.lastFrameAt < 1500) { this.hoverIntent.reset(); return }
    const view = { width: rect.width, height: rect.height }
    const cellRects = this.layout(rect, count).cards.map(c => c.card)
    const idx = hoveredCardIndex(this.cursorLocal(rect), cellRects)
    const now = Date.now()
    const intendedIdx = this.hoverIntent.update(idx, now)
    this.predict(intendedIdx, cellRects, view, this.deps.config(rect).maxCols)
  }
}

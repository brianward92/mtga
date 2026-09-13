/**
 * Arena layer awareness for the overlay.
 *
 * Arena is one native window; its hover previews and modals are drawn INSIDE
 * it, so no overlay can be z-ordered between them and the pack. The overlay
 * steps aside instead. The cursor is the signal: once it has rested on a pack
 * card, Arena's preview is taken to be up, every other badge lifts and the
 * sidebar fades, until the cursor leaves the card. Arena's preview lands in
 * more places than can be predicted (keyword panels, token pairs, right-hand
 * pops under the sidebar), so nothing is left standing next to it.
 *
 * With window capture (native helper, one-shot screenshots) a "clear" baseline
 * of the pack is kept and each frame is diffed per cell, which additionally
 * catches modal scrims and the pack leaving the screen.
 */
import { EventEmitter } from 'events'
import { screen } from 'electron'
import type { ArenaGeometryPoller, ArenaRect, HelperFrame } from '../arena-geometry'
import { packLayout, type CalibrationConfig, type Rect } from '../../shared/layout'
import { HoverPreviewIntent, hoveredCardIndex, isRightmostGridColumn, predictPopout } from '../../shared/hover'
import { detectOcclusion, scaleRect, cardness, CARDNESS_MIN, ABS_DARK, meanLuminanceInRect, frameFromBytes, type GrayFrame } from './occlusion'

import type { LayerState } from '../../shared/state'

const EMPTY: LayerState = { cells: [], regions: [], covered: false }
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
  private layoutKey = ''
  private layoutCache: ReturnType<typeof packLayout> | null = null
  private fallbackTimer: NodeJS.Timeout | null = null
  /** Enter dwell + leave grace: Arena only pops its preview once the cursor rests. */
  private hoverIntent = new HoverPreviewIntent()

  constructor(private deps: LayerDeps) {
    super()
    deps.poller.on('frame', (f: HelperFrame) => this.onFrame(f))
  }

  /** Most recently published layer state. */
  get state(): LayerState { return this.last }

  /** New pack / new draft: the clear baseline no longer applies. */
  resetBaseline(): void {
    this.baseline = null
    this.baselineCardness = 0
    this.hoverIntent.reset()
    this.publish(EMPTY)
  }

  /**
   * Start the cursor poll only while badges are live. Main calls this
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

  /** Stop cursor polling and release its timer. */
  dispose(): void {
    if (this.fallbackTimer) clearInterval(this.fallbackTimer)
    this.fallbackTimer = null
    this.hoverIntent.reset()
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
    const key = `${next.covered ? 1 : 0}|${next.cells.join(',')}|` +
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
    if (!this.deps.active() || !rect || count === 0) {
      this.hoverIntent.reset()
      this.publish(EMPTY)
      return
    }
    const view = { width: rect.width, height: rect.height }
    const layout = this.layout(rect, count)
    const cellRects = layout.cards.map(c => c.card)
    const hoveredIdx = hoveredCardIndex(this.cursorLocal(rect), cellRects)
    const previewIdx = this.hoverIntent.update(hoveredIdx, Date.now())

    const frame = frameFromBytes(hf.width, hf.height, hf.data)
    const fsize = { width: frame.width, height: frame.height }
    const packPx = scaleRect(layout.pack, view, fsize)
    const cellsPx = cellRects.map(r => scaleRect(r, view, fsize))
    const result = detectOcclusion(frame, this.baseline, packPx, cellsPx)

    const packLum = meanLuminanceInRect(frame, packPx)
    const score = cardness(frame, packPx, cellsPx) ?? 0
    const packOnScreen = score >= CARDNESS_MIN && packLum !== null && packLum >= ABS_DARK

    const sizeChanged = this.baseline !== null && (frame.width !== this.baseline.width || frame.height !== this.baseline.height)
    if (packOnScreen && hoveredIdx < 0 && (this.baseline === null || sizeChanged || score >= this.baselineCardness * 0.9)) {
      this.baseline = frame
      this.baselineCardness = score
    }

    if (!packOnScreen && (hoveredIdx < 0 || result.packCovered)) {
      this.publish({ cells: [], regions: [], covered: true })
      return
    }
    const preview = this.preview(previewIdx, cellRects, view, this.deps.config(rect).maxCols)
    const cells = [...new Set([...preview.cells, ...result.coveredCells])].filter(i => i !== hoveredIdx).sort((a, b) => a - b)
    this.publish({ cells, regions: preview.regions, covered: result.packCovered })
  }

  /** What steps aside while the cursor rests on `previewIdx` (-1: nothing). */
  private preview(
    previewIdx: number,
    cellRects: Rect[],
    view: { width: number; height: number },
    maxCols: number
  ): { cells: number[]; regions: Rect[] } {
    if (previewIdx < 0) return { cells: [], regions: [] }
    const name = this.deps.names?.()[previewIdx]
    const split = typeof name === 'string' && name.includes(' // ')
    const flipLeft = isRightmostGridColumn(previewIdx, maxCols)
    const regions = predictPopout(cellRects[previewIdx], view, { split, flipLeft })
    const cells = cellRects.map((_, i) => i).filter(i => i !== previewIdx)
    return { cells, regions }
  }

  /** Cursor-only path, used whenever no frames are flowing. */
  private fallbackTick(): void {
    const rect = this.deps.poller.lastKnown
    const count = this.deps.packCount()
    if (!this.deps.active() || !rect || count === 0) {
      this.publish(EMPTY)
      this.hoverIntent.reset()
      return
    }
    // Frames are flowing: onFrame owns the hover intent.
    if (Date.now() - this.lastFrameAt < 1500) return
    const view = { width: rect.width, height: rect.height }
    const cellRects = this.layout(rect, count).cards.map(c => c.card)
    const idx = hoveredCardIndex(this.cursorLocal(rect), cellRects)
    const previewIdx = this.hoverIntent.update(idx, Date.now())
    const preview = this.preview(previewIdx, cellRects, view, this.deps.config(rect).maxCols)
    this.publish({ cells: preview.cells, regions: preview.regions, covered: false })
  }
}

/**
 * Arena UI-layer awareness for the badge overlay.
 *
 * Arena is one native window; its hover preview and modal menus (Options,
 * etc.) are drawn INSIDE it, so an always-on-top overlay can never be
 * z-ordered between them and the pack. Approximation, in order of quality:
 *
 *  1. Frame diff (needs macOS Screen Recording): capture Arena's window (our
 *     own windows are excluded from a window capture), remember a "clear"
 *     baseline of the pack while nothing is hovered, and per-cell compare each
 *     new frame against it. A cell whose pixels changed is covered by
 *     something — a card preview of any shape, a Room card's landscape
 *     preview, a modal scrim — and its badge lifts. Whole-pack darkening
 *     (modal) is caught the same way.
 *  2. Fallback without permission: geometric prediction of the hover preview
 *     (renderer/badges/hover.ts), driven from the cursor position.
 */
import { systemPreferences } from 'electron'
import type { Rect } from '../../renderer/badges/layout'

/** Mean |Δluminance| (0..255) over a cell above which it counts as covered. */
export const CELL_DIFF_THRESHOLD = 22
/** Pack-area brightness ratio vs. baseline below which the pack is covered. */
export const COVERED_RATIO = 0.62
/** Absolute pack-area luminance floor: a modal scrim over face-up cards. */
export const ABS_DARK = 48

export interface GrayFrame {
  width: number
  height: number
  /** Row-major luminance, 0..255. */
  data: Float32Array
}

/** BGRA bitmap → luminance frame. */
export function toGray(bitmap: Buffer, size: { width: number; height: number }): GrayFrame {
  const data = new Float32Array(size.width * size.height)
  for (let i = 0, p = 0; i < data.length; i++, p += 4) {
    data[i] = 0.299 * bitmap[p + 2] + 0.587 * bitmap[p + 1] + 0.114 * bitmap[p]
  }
  return { width: size.width, height: size.height, data }
}

/** Mean luminance inside a rect given in frame px. */
export function meanIn(frame: GrayFrame, r: Rect): number | null {
  const x0 = Math.max(0, Math.floor(r.x)), y0 = Math.max(0, Math.floor(r.y))
  const x1 = Math.min(frame.width, Math.ceil(r.x + r.width))
  const y1 = Math.min(frame.height, Math.ceil(r.y + r.height))
  if (x1 <= x0 || y1 <= y0) return null
  let sum = 0, n = 0
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { sum += frame.data[y * frame.width + x]; n++ }
  return n ? sum / n : null
}

/** Mean |a-b| inside a rect; null when rect is empty or sizes mismatch. */
export function meanDiffIn(a: GrayFrame, b: GrayFrame, r: Rect): number | null {
  if (a.width !== b.width || a.height !== b.height) return null
  const x0 = Math.max(0, Math.floor(r.x)), y0 = Math.max(0, Math.floor(r.y))
  const x1 = Math.min(a.width, Math.ceil(r.x + r.width))
  const y1 = Math.min(a.height, Math.ceil(r.y + r.height))
  if (x1 <= x0 || y1 <= y0) return null
  let sum = 0, n = 0
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = y * a.width + x
    sum += Math.abs(a.data[i] - b.data[i]); n++
  }
  return n ? sum / n : null
}

/** Scale an Arena-window-relative rect (pts) into frame px. */
export function scaleRect(r: Rect, from: { width: number; height: number }, to: { width: number; height: number }): Rect {
  const sx = to.width / from.width, sy = to.height / from.height
  return { x: r.x * sx, y: r.y * sy, width: r.width * sx, height: r.height * sy }
}

/**
 * "Cardness": how much the card cells stand out from the gaps around them.
 * A face-up pack scores high (bright frames/text boxes vs. dark background);
 * the Home screen, a deck list, or a modal scrim score low. Used to gate the
 * baseline and to hide badges when the pack simply is not on screen.
 */
export const CARDNESS_MIN = 14

export function cardness(frame: GrayFrame, pack: Rect, cells: Rect[]): number | null {
  const x0 = Math.max(0, Math.floor(pack.x)), y0 = Math.max(0, Math.floor(pack.y))
  const x1 = Math.min(frame.width, Math.ceil(pack.x + pack.width))
  const y1 = Math.min(frame.height, Math.ceil(pack.y + pack.height))
  if (x1 <= x0 || y1 <= y0 || cells.length === 0) return null
  let inSum = 0, inN = 0, outSum = 0, outN = 0
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const v = frame.data[y * frame.width + x]
      let inside = false
      for (const c of cells) {
        if (x >= c.x && x < c.x + c.width && y >= c.y && y < c.y + c.height) { inside = true; break }
      }
      if (inside) { inSum += v; inN++ } else { outSum += v; outN++ }
    }
  }
  if (!inN || !outN) return null
  return inSum / inN - outSum / outN
}

export interface OcclusionResult {
  /** Indices of pack cells that look covered. */
  coveredCells: number[]
  /** Whole pack area looks covered (modal scrim). */
  packCovered: boolean
  /** The extra rect (panel) looks covered. */
  extraCovered: boolean
}

/**
 * Decide occlusion for one frame against a baseline. Pure.
 * `cells` / `extra` are rects in FRAME px.
 */
export function detectOcclusion(
  frame: GrayFrame,
  baseline: GrayFrame | null,
  pack: Rect,
  cells: Rect[],
  extra: Rect | null
): OcclusionResult {
  const lum = meanIn(frame, pack)
  const baseLum = baseline ? meanIn(baseline, pack) : null
  const packCovered =
    (lum !== null && lum < ABS_DARK) ||
    (lum !== null && baseLum !== null && baseLum > 0 && lum < baseLum * COVERED_RATIO)
  const coveredCells: number[] = []
  let extraCovered = false
  if (baseline) {
    cells.forEach((cell, i) => {
      const d = meanDiffIn(frame, baseline, cell)
      if (d !== null && d > CELL_DIFF_THRESHOLD) coveredCells.push(i)
    })
    if (extra) {
      const d = meanDiffIn(frame, baseline, extra)
      extraCovered = d !== null && d > CELL_DIFF_THRESHOLD
    }
  }
  return { coveredCells, packCovered, extraCovered }
}

/** macOS Screen Recording status for this app (drives the menu-bar hint). */
export function screenCaptureGranted(): boolean {
  return process.platform !== 'darwin' || systemPreferences.getMediaAccessStatus('screen') === 'granted'
}

/** Build a GrayFrame from the helper's raw luminance bytes (no copy). */
export function frameFromBytes(width: number, height: number, bytes: Uint8Array): GrayFrame {
  return { width, height, data: Float32Array.from(bytes) }
}

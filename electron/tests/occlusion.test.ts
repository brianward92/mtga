import { describe, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ desktopCapturer: {}, systemPreferences: {} }))
import { detectOcclusion, toGray, type GrayFrame, CELL_DIFF_THRESHOLD } from '../main/windows/occlusion'

function frame(w: number, h: number, fill: (x: number, y: number) => number): GrayFrame {
  const data = new Float32Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = fill(x, y)
  return { width: w, height: h, data }
}

const pack = { x: 0, y: 0, width: 40, height: 20 }
const cells = [
  { x: 0, y: 0, width: 10, height: 10 },
  { x: 10, y: 0, width: 10, height: 10 },
  { x: 20, y: 0, width: 10, height: 10 }
]

describe('detectOcclusion', () => {
  it('flags only the cells whose pixels changed vs baseline', () => {
    const base = frame(40, 20, () => 120)
    const now = frame(40, 20, (x) => (x >= 10 && x < 20 ? 200 : 120)) // preview over cell 1
    const r = detectOcclusion(now, base, pack, cells, null)
    expect(r.coveredCells).toEqual([1])
    expect(r.packCovered).toBe(false)
  })

  it('treats a whole-pack darkening as a modal', () => {
    const base = frame(40, 20, () => 140)
    const now = frame(40, 20, () => 60)
    const r = detectOcclusion(now, base, pack, cells, null)
    expect(r.packCovered).toBe(true)
    expect(r.coveredCells).toEqual([0, 1, 2])
  })

  it('reports the extra (panel) rect separately', () => {
    const base = frame(40, 20, () => 100)
    const now = frame(40, 20, (x) => (x >= 30 ? 100 + CELL_DIFF_THRESHOLD * 2 : 100))
    const r = detectOcclusion(now, base, pack, cells, { x: 30, y: 0, width: 10, height: 20 })
    expect(r.extraCovered).toBe(true)
    expect(r.coveredCells).toEqual([])
  })

  it('without a baseline only the absolute-dark rule applies', () => {
    const dark = frame(40, 20, () => 20)
    expect(detectOcclusion(dark, null, pack, cells, null).packCovered).toBe(true)
    const lit = frame(40, 20, () => 120)
    expect(detectOcclusion(lit, null, pack, cells, null)).toEqual({ coveredCells: [], packCovered: false, extraCovered: false })
  })

  it('toGray converts BGRA', () => {
    const b = Buffer.from([255, 255, 255, 255, 0, 0, 0, 255])
    const g = toGray(b, { width: 2, height: 1 })
    expect(g.data[0]).toBeCloseTo(255, 3)
    expect(g.data[1]).toBe(0)
  })
})

import { cardness, CARDNESS_MIN } from '../main/windows/occlusion'
describe('cardness', () => {
  const pack = { x: 0, y: 0, width: 40, height: 20 }
  const cells = [{ x: 2, y: 2, width: 16, height: 16 }, { x: 22, y: 2, width: 16, height: 16 }]
  const mk = (fill: (x: number, y: number) => number) => {
    const d = new Float32Array(40 * 20)
    for (let y = 0; y < 20; y++) for (let x = 0; x < 40; x++) d[y * 40 + x] = fill(x, y)
    return { width: 40, height: 20, data: d }
  }
  it('is high when cells are brighter than gaps (a pack is showing)', () => {
    const inCell = (x: number, y: number) => cells.some(c => x >= c.x && x < c.x + c.width && y >= c.y && y < c.y + c.height)
    expect(cardness(mk((x, y) => (inCell(x, y) ? 150 : 40)), pack, cells)!).toBeGreaterThan(CARDNESS_MIN)
  })
  it('is ~0 for uniform content (no pack)', () => {
    expect(Math.abs(cardness(mk(() => 90), pack, cells)!)).toBeLessThan(1)
  })
})

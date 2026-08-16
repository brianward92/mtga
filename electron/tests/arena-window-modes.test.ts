import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { ArenaGeometryPoller, type ArenaRect } from '../main/arena-geometry'
import { ARENA_CONTENT_ASPECT, arenaContentBox } from '../shared/layout'

const POLL_MS = 25
const pollers: ArenaGeometryPoller[] = []
const tempDirs: string[] = []

function writeRect(file: string, rect: ArenaRect): void {
  writeFileSync(file, JSON.stringify({ ...rect, frontmost: true }))
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  for (const poller of pollers.splice(0)) poller.stop()
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  expect(vi.getTimerCount()).toBe(0)
  vi.useRealTimers()
})

describe('Arena content box across window modes and displays', () => {
  it.each([
    ['windowed', { x: 180, y: 71, width: 1280, height: 748 }],
    ['borderless', { x: 0, y: 0, width: 1512, height: 982 }],
    ['second-display fullscreen', { x: -3024, y: -196, width: 3024, height: 1964 }]
  ] as const)('uses local size, not the global origin, in %s mode', (_mode, rect) => {
    const box = arenaContentBox(rect)

    expect(box).toEqual(arenaContentBox({ width: rect.width, height: rect.height }))
    expect(box.width).toBeCloseTo(rect.height * ARENA_CONTENT_ASPECT, 8)
    expect(box.x + box.width / 2).toBeCloseTo(rect.width / 2, 8)
  })

  it('scales identically for a DPI-shaped 2x rect without applying an implicit conversion', () => {
    const points = arenaContentBox({ width: 1512, height: 982 })
    const doubled = arenaContentBox({ width: 3024, height: 1964 })

    expect(doubled.x).toBeCloseTo(points.x * 2, 8)
    expect(doubled.width).toBeCloseTo(points.width * 2, 8)
  })
})

describe('ArenaGeometryPoller rect transitions', () => {
  it('tracks window modes, display origins, and a lost/refound Space exactly', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mtga-arena-window-modes-'))
    tempDirs.push(dir)
    const file = join(dir, 'arena.json')
    const windowed = { x: 180, y: 71, width: 1280, height: 748 }
    const borderless = { x: 0, y: 0, width: 1512, height: 982 }
    const secondDisplay = { x: -3024, y: -196, width: 3024, height: 1964 }
    const originOnlyMove = { ...secondDisplay, x: 1512, y: 240 }
    writeRect(file, windowed)

    const geometry: ArenaRect[] = []
    let lost = 0
    const poller = new ArenaGeometryPoller({ fakeArenaFile: file, fakePollMs: POLL_MS })
    poller.on('geometry', rect => geometry.push({ ...rect }))
    poller.on('lost', () => { lost += 1 })
    pollers.push(poller)
    poller.start()

    expect(poller.isFound()).toBe(true)
    expect(poller.lastKnown).toEqual(windowed)
    expect(geometry).toEqual([windowed])

    // Helper heartbeats with an unchanged rect do not churn overlay bounds.
    vi.advanceTimersByTime(POLL_MS * 2)
    expect(geometry).toEqual([windowed])

    writeRect(file, borderless)
    vi.advanceTimersByTime(POLL_MS)
    writeRect(file, secondDisplay)
    vi.advanceTimersByTime(POLL_MS)
    writeRect(file, originOnlyMove)
    vi.advanceTimersByTime(POLL_MS)
    expect(geometry).toEqual([windowed, borderless, secondDisplay, originOnlyMove])
    expect(poller.lastKnown).toEqual(originOnlyMove)

    // Moving Arena to another Space makes its on-screen CGWindow disappear.
    unlinkSync(file)
    vi.advanceTimersByTime(POLL_MS)
    expect(poller.isFound()).toBe(false)
    expect(poller.lastKnown).toEqual(originOnlyMove)
    expect(lost).toBe(1)
    vi.advanceTimersByTime(POLL_MS * 2)
    expect(lost).toBe(1)

    // Refinding emits fresh geometry even when the cached rect is unchanged.
    writeRect(file, originOnlyMove)
    vi.advanceTimersByTime(POLL_MS)
    expect(poller.isFound()).toBe(true)
    expect(geometry).toEqual([
      windowed,
      borderless,
      secondDisplay,
      originOnlyMove,
      originOnlyMove
    ])
  })
})

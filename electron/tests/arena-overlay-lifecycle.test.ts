import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { ArenaGeometryPoller, type ArenaRect } from '../main/arena-geometry'
import { OverlayGeometrySync } from '../main/overlay/geometry-sync'

const POLL_MS = 50
const pollers: ArenaGeometryPoller[] = []
const controllers: OverlayGeometrySync[] = []
const tempDirs: string[] = []

function writeRect(file: string, rect: ArenaRect): void {
  writeFileSync(file, JSON.stringify({ ...rect, frontmost: true }))
}

function harness(file: string) {
  let targetAvailable = false
  let visible = false
  let bounds: ArenaRect | null = null
  let showCount = 0
  let hideCount = 0
  const poller = new ArenaGeometryPoller({ fakeArenaFile: file, fakePollMs: POLL_MS })
  const controller = new OverlayGeometrySync({
    targetAvailable: () => targetAvailable,
    arenaFound: () => poller.isFound(),
    arenaRect: () => poller.lastKnown,
    arenaFrontmost: () => poller.arenaFrontmost,
    contentWanted: () => true,
    setRect: rect => { bounds = { ...rect } },
    show: () => { if (!visible) { visible = true; showCount += 1 } },
    hide: () => { if (visible) { visible = false; hideCount += 1 } },
    now: () => Date.now()
  })
  const sync = (): void => controller.sync()
  poller.on('geometry', sync)
  poller.on('lost', sync)
  poller.on('frontmost', sync)
  pollers.push(poller)
  controllers.push(controller)
  poller.start()
  return {
    poller,
    attachTarget: () => { targetAvailable = true; controller.sync() },
    state: () => ({ visible, bounds, showCount, hideCount })
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(0)
})

afterEach(() => {
  for (const poller of pollers.splice(0)) poller.stop()
  for (const controller of controllers.splice(0)) controller.dispose()
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  expect(vi.getTimerCount()).toBe(0)
  vi.useRealTimers()
})

describe('Arena poller → overlay lifecycle', () => {
  it('keeps first-launch overlay content hidden until an Arena rect appears', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mtga-arena-startup-'))
    tempDirs.push(dir)
    const file = join(dir, 'arena.json')
    const life = harness(file)

    // Production starts the poller before attaching the hidden BrowserWindow.
    expect(life.poller.isFound()).toBe(false)
    expect(life.poller.lastKnown).toBeNull()
    expect(life.state()).toEqual({ visible: false, bounds: null, showCount: 0, hideCount: 0 })
    life.attachTarget()
    expect(life.state()).toEqual({ visible: false, bounds: null, showCount: 0, hideCount: 0 })

    const rect = { x: 10, y: 33, width: 1512, height: 949 }
    writeRect(file, rect)
    vi.advanceTimersByTime(POLL_MS)
    expect(life.poller.isFound()).toBe(true)
    expect(life.state()).toMatchObject({ visible: false, bounds: rect, showCount: 0 })

    vi.advanceTimersByTime(249)
    expect(life.state().visible).toBe(false)
    vi.advanceTimersByTime(1)
    expect(life.state()).toMatchObject({ visible: true, bounds: rect, showCount: 1 })
  })

  it('survives present → deleted → present and cancels stale reappearance', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mtga-arena-relaunch-'))
    tempDirs.push(dir)
    const file = join(dir, 'arena.json')
    const first = { x: 0, y: 30, width: 1200, height: 760 }
    const pending = { x: 20, y: 40, width: 1300, height: 800 }
    const relaunched = { x: 40, y: 50, width: 1400, height: 860 }
    writeRect(file, first)
    const life = harness(file)
    life.attachTarget()

    // An Arena rect present on the first observation shows immediately.
    expect(life.state()).toEqual({ visible: true, bounds: first, showCount: 1, hideCount: 0 })

    unlinkSync(file)
    vi.advanceTimersByTime(POLL_MS)
    expect(life.poller.isFound()).toBe(false)
    expect(life.poller.lastKnown).toEqual(first) // poller intentionally retains its geometry cache while lost
    expect(life.state()).toEqual({ visible: false, bounds: first, showCount: 1, hideCount: 1 })

    // A new rect updates bounds but waits before showing after a loss.
    writeRect(file, pending)
    vi.advanceTimersByTime(POLL_MS)
    expect(life.state()).toEqual({ visible: false, bounds: pending, showCount: 1, hideCount: 1 })

    // Losing Arena during that wait must cancel the pending show timer.
    unlinkSync(file)
    vi.advanceTimersByTime(POLL_MS)
    vi.advanceTimersByTime(500)
    expect(life.state()).toEqual({ visible: false, bounds: pending, showCount: 1, hideCount: 1 })

    writeRect(file, relaunched)
    vi.advanceTimersByTime(POLL_MS)
    expect(life.state()).toMatchObject({ visible: false, bounds: relaunched, showCount: 1 })
    vi.advanceTimersByTime(249)
    expect(life.state().visible).toBe(false)
    vi.advanceTimersByTime(1)
    expect(life.state()).toEqual({ visible: true, bounds: relaunched, showCount: 2, hideCount: 1 })
  })
})

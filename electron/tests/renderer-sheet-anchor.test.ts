import { describe, expect, it } from 'vitest'
import { EMPTY_STATE } from '../shared/state'
import {
  previewIntersectsSidebar,
  sidebarPanelFrame,
  sidebarPresentation,
  sidebarShellFrame
} from '../renderer/overlay/sidebar'
import { Sheet } from '../renderer/overlay/sheet'
import type { Store } from '../renderer/overlay/types'

describe('full right-column sidebar geometry', () => {
  it.each([
    [{ width: 1024, height: 768 }, { x: 778.24, y: 107.52, width: 245.76, height: 660.48 }, { x: 784.24, y: 113.52, width: 233.76, height: 648.48 }],
    [{ width: 1512, height: 949 }, { x: 1149.12, y: 132.86, width: 362.88, height: 816.14 }, { x: 1155.12, y: 138.86, width: 350.88, height: 804.14 }],
    [{ width: 3440, height: 1440 }, { x: 2614.4, y: 201.6, width: 825.6, height: 1238.4 }, { x: 2620.4, y: 207.6, width: 813.6, height: 1226.4 }]
  ] as const)('owns 76%%/14%% through the edges and insets one panel at %j', (view, shellExpected, panelExpected) => {
    const shell = sidebarShellFrame(view)
    const panel = sidebarPanelFrame(view)

    for (const key of ['x', 'y', 'width', 'height'] as const) {
      expect(shell[key]).toBeCloseTo(shellExpected[key], 8)
      expect(panel[key]).toBeCloseTo(panelExpected[key], 8)
    }
    expect(shell.x + shell.width).toBeCloseTo(view.width, 8)
    expect(shell.y + shell.height).toBeCloseTo(view.height, 8)
    expect(panel.x - shell.x).toBeCloseTo(6, 8)
    expect(panel.y - shell.y).toBeCloseTo(6, 8)
    expect(shell.x + shell.width - (panel.x + panel.width)).toBeCloseTo(6, 8)
    expect(shell.y + shell.height - (panel.y + panel.height)).toBeCloseTo(6, 8)
  })

  it('returns empty frames for invalid views', () => {
    expect(sidebarShellFrame({ width: 0, height: 949 })).toEqual({ x: 0, y: 0, width: 0, height: 0 })
    expect(sidebarPanelFrame({ width: NaN, height: 949 })).toEqual({ x: 0, y: 0, width: 0, height: 0 })
  })

  it('fades only for positive-area predicted-preview intersection', () => {
    const view = { width: 1512, height: 949 }
    const rail = sidebarShellFrame(view)
    const intersecting = { x: rail.x - 10, y: rail.y + 20, width: 20, height: 100 }
    const left = { x: 100, y: 200, width: 200, height: 300 }
    const edgeTouch = { x: rail.x - 20, y: rail.y + 20, width: 20, height: 100 }

    expect(previewIntersectsSidebar(view, [intersecting])).toBe(true)
    expect(previewIntersectsSidebar(view, [left])).toBe(false)
    expect(previewIntersectsSidebar(view, [edgeTouch])).toBe(false)
    expect(previewIntersectsSidebar(view, [])).toBe(false)
  })

  it('ignores modal/capture hudCovered and respects phase/master visibility', () => {
    const view = { width: 1512, height: 949 }
    const region = { x: 1200, y: 200, width: 200, height: 300 }

    expect(sidebarPresentation('active', true, view, { regions: [], hudCovered: true }))
      .toEqual({ open: true, previewCovered: false })
    expect(sidebarPresentation('active', true, view, { regions: [region], hudCovered: false }))
      .toEqual({ open: true, previewCovered: true })
    expect(sidebarPresentation('active', false, view, { regions: [region], hudCovered: false }))
      .toEqual({ open: false, previewCovered: false })
    expect(sidebarPresentation('idle', true, view, { regions: [region], hudCovered: false }))
      .toEqual({ open: false, previewCovered: false })
  })
})

class FakeClassList {
  private readonly names = new Set<string>()
  add(...names: string[]): void { names.forEach(name => this.names.add(name)) }
  remove(...names: string[]): void { names.forEach(name => this.names.delete(name)) }
  contains(name: string): boolean { return this.names.has(name) }
  toggle(name: string, force?: boolean): boolean {
    const on = force ?? !this.names.has(name)
    if (on) this.names.add(name); else this.names.delete(name)
    return on
  }
}

class FakeElement {
  readonly classList = new FakeClassList()
  readonly dataset: Record<string, string> = {}
  textContent = ''
  className = ''
  innerHTML = ''
  ariaHidden = ''
  private readonly children = new Map<string, FakeElement>()

  child(selector: string): FakeElement {
    const child = new FakeElement()
    this.children.set(selector, child)
    return child
  }
  querySelector(selector: string): FakeElement | null { return this.children.get(selector) ?? null }
  setAttribute(name: string, value: string): void { if (name === 'aria-hidden') this.ariaHidden = value }
}

function sheetHarness(sheetOpen = false) {
  const root = new FakeElement()
  const pool = root.child('#sheetPool')
  const rating = new FakeElement()
  const sheet = new Sheet(root as unknown as HTMLElement, rating as unknown as HTMLElement)
  const store: Store = {
    state: { ...EMPTY_STATE, phase: 'active', seq: 1 },
    prefs: { badges: true, hud: true, hudCorner: 'bl', layerDetection: false },
    layer: { cells: [], regions: [], covered: false, hudCovered: false },
    calibrate: { active: false, count: 14, config: {} as never, arenaFound: true },
    sheetOpen,
    hoverCell: -1,
    view: { width: 1512, height: 949 }
  }
  return { root, pool, rating, sheet, store }
}

describe('pinned sidebar pool DOM', () => {
  it('constructs from the real minimal skeleton and ignores a closed legacy toggle', () => {
    const { root, pool, rating, sheet, store } = sheetHarness(false)
    sheet.update(store)

    expect(root.classList.contains('open')).toBe(true)
    expect(root.ariaHidden).toBe('false')
    expect(root.dataset.testid).toBe('sheet')
    expect(rating.textContent).toBe('Pool rating —')
    expect(pool.innerHTML).toContain('No cards yet')
  })

  it('closes pool content with the master HUD preference or idle phase', () => {
    const { root, sheet, store } = sheetHarness(true)
    sheet.update(store)
    store.prefs.hud = false
    sheet.update(store)
    expect(root.classList.contains('open')).toBe(false)
    expect(root.ariaHidden).toBe('true')

    store.prefs.hud = true
    store.state = { ...store.state, phase: 'idle', seq: 2 }
    sheet.update(store)
    expect(root.classList.contains('open')).toBe(false)
  })
})

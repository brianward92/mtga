import { afterEach, describe, expect, it, vi } from 'vitest'
import { CalibrateLayer } from '../renderer/overlay/calibrate'
import type { Store } from '../renderer/overlay/types'
import { applyCalibrationOp, DEFAULT_CALIBRATION, packLayout, type Rect } from '../shared/layout'

class FakeClassList {
  private readonly names = new Set<string>()
  toggle(name: string, force?: boolean): boolean {
    const on = force ?? !this.names.has(name)
    if (on) this.names.add(name); else this.names.delete(name)
    return on
  }
}

class FakeElement {
  className = ''
  hidden = false
  textContent = ''
  readonly style: Record<string, string> = {}
  readonly dataset: Record<string, string> = {}
  readonly classList = new FakeClassList()
  readonly children: FakeElement[] = []
  readonly queries = new Map<string, FakeElement>()

  appendChild(child: FakeElement): FakeElement { this.children.push(child); return child }
  append(...children: FakeElement[]): void { this.children.push(...children) }
  querySelector(selector: string): FakeElement | null { return this.queries.get(selector) ?? null }
  querySelectorAll(): FakeElement[] { return [] }
  addEventListener(): void {}
}

function expectPlaced(element: FakeElement, rect: Rect): void {
  expect(element.style).toMatchObject({
    left: `${rect.x.toFixed(1)}px`,
    top: `${rect.y.toFixed(1)}px`,
    width: `${rect.width.toFixed(1)}px`,
    height: `${rect.height.toFixed(1)}px`
  })
}

afterEach(() => vi.unstubAllGlobals())

describe('CalibrateLayer letterbox geometry', () => {
  it('repaints its frame, first card, and badge from content-box nudge/scale ops at 1280x748', () => {
    vi.stubGlobal('document', { createElement: () => new FakeElement() })
    const ghostRoot = new FakeElement()
    const panel = new FakeElement()
    panel.queries.set('#calStatus', new FakeElement())
    panel.queries.set('#calSave', new FakeElement())
    panel.queries.set('#calCancel', new FakeElement())
    const layer = new CalibrateLayer(
      ghostRoot as unknown as HTMLElement,
      panel as unknown as HTMLElement,
      vi.fn()
    )
    const view = { width: 1280, height: 748 }
    const store = {
      view,
      calibrate: { active: true, count: 14, config: DEFAULT_CALIBRATION, arenaFound: true }
    } as unknown as Store

    layer.update(store)
    const frame = ghostRoot.children[0]
    const firstCard = ghostRoot.children[1]
    const firstBadge = ghostRoot.children[2]
    let expected = packLayout(view, 14, DEFAULT_CALIBRATION)
    expectPlaced(frame, expected.pack)
    expectPlaced(firstCard, expected.cards[0].card)
    expectPlaced(firstBadge, expected.cards[0].badge)

    store.calibrate.config = applyCalibrationOp(DEFAULT_CALIBRATION, {
      type: 'nudge', dx: 1, dy: 1
    })
    layer.update(store)
    expected = packLayout(view, 14, store.calibrate.config)
    expectPlaced(frame, expected.pack)
    expectPlaced(firstCard, expected.cards[0].card)
    expectPlaced(firstBadge, expected.cards[0].badge)

    store.calibrate.config = applyCalibrationOp(DEFAULT_CALIBRATION, {
      type: 'scale', dir: 1
    })
    layer.update(store)
    expected = packLayout(view, 14, store.calibrate.config)
    expectPlaced(frame, expected.pack)
    expectPlaced(firstCard, expected.cards[0].card)
    expectPlaced(firstBadge, expected.cards[0].badge)
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RailInteraction } from '../renderer/overlay/rail-interaction'

class FakeClassList {
  private readonly names = new Set<string>()

  constructor(...names: string[]) { names.forEach(name => this.names.add(name)) }

  add(...names: string[]): void { names.forEach(name => this.names.add(name)) }
  remove(...names: string[]): void { names.forEach(name => this.names.delete(name)) }
  contains(name: string): boolean { return this.names.has(name) }
  toggle(name: string, force?: boolean): boolean {
    const enabled = force ?? !this.names.has(name)
    if (enabled) this.names.add(name)
    else this.names.delete(name)
    return enabled
  }
}

class FakeElement {
  readonly classList: FakeClassList
  panel: FakeElement | null = null
  button = false

  constructor(
    classes: string[],
    private readonly bounds = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }
  ) {
    this.classList = new FakeClassList(...classes)
  }

  closest(selector: string): FakeElement | null {
    if (selector === 'button, .hud-icon, .sheet-close') return this.button ? this : null
    if (selector === '.interactive') return this.panel?.classList.contains('interactive') ? this.panel : null
    if (selector === '.hud.interactive, .sheet.interactive') return this.panel
    return null
  }

  getBoundingClientRect() { return this.bounds }
}

function harness() {
  const hud = new FakeElement(
    ['hud', 'interactive'],
    { left: 700, top: 20, right: 980, bottom: 200, width: 280, height: 180 }
  )
  const sheet = new FakeElement(
    ['sheet', 'interactive', 'open', 'stack-below'],
    { left: 700, top: 200, right: 980, bottom: 800, width: 280, height: 600 }
  )
  const changes: boolean[] = []
  const rail = new RailInteraction(
    hud as unknown as HTMLElement,
    sheet as unknown as HTMLElement,
    on => changes.push(on)
  )
  const body = new FakeElement([])
  body.panel = sheet
  const button = new FakeElement([])
  button.panel = hud
  button.button = true
  rail.syncTopology()
  return { rail, hud, sheet, body, button, changes }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(0)
  vi.stubGlobal('document', { body: { classList: new FakeClassList() } })
  vi.stubGlobal('performance', { now: () => Date.now() })
  vi.stubGlobal('window', {
    setTimeout: (handler: () => void, delay: number) => setTimeout(handler, delay),
    clearTimeout: (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer)
  })
})

afterEach(() => {
  expect(vi.getTimerCount()).toBe(0)
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('rail interaction controller', () => {
  it('yields a joined rail together and restores both panels on a button', () => {
    const { rail, hud, sheet, body, button, changes } = harness()

    expect(rail.handlePointerMove(body as unknown as Element, 800, 260)).toBe(true)
    expect(changes).toEqual([true])
    vi.advanceTimersByTime(250)
    expect(hud.classList.contains('yield')).toBe(true)
    expect(sheet.classList.contains('yield')).toBe(true)
    expect(changes).toEqual([true, false])

    expect(rail.handlePointerMove(button as unknown as Element, 900, 100)).toBe(true)
    expect(hud.classList.contains('yield')).toBe(false)
    expect(sheet.classList.contains('yield')).toBe(false)
    expect(changes).toEqual([true, false, true])
    rail.releasePointer()
  })

  it('cancels a pending dwell when the rendered topology changes', () => {
    const { rail, hud, sheet, body, changes } = harness()

    rail.handlePointerMove(body as unknown as Element, 800, 260)
    sheet.classList.remove('open')
    rail.syncTopology()
    vi.advanceTimersByTime(500)

    expect(hud.classList.contains('yield')).toBe(false)
    expect(sheet.classList.contains('yield')).toBe(false)
    expect(changes).toEqual([true, false])
    rail.releasePointer()
  })
})

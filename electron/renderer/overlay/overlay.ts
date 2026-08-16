/**
 * The overlay page: one transparent, click-through window over Arena.
 *
 * Main pushes whole DraftState snapshots (+ prefs, layer awareness,
 * calibration mode, commands); this file owns the store, coalesces renders
 * into one requestAnimationFrame, hit-tests the cursor for interactivity
 * (window.overlay.setInteractive) and pack-cell hover, and delegates
 * drawing to the layers: badges (frames/chips), hud, sheet, calibrate.
 */
import { EMPTY_STATE } from '../../shared/state'
import { DEFAULT_CALIBRATION, packLayout, type PackLayout } from '../../shared/layout'
import { hoveredCardIndex } from '../../shared/hover'
import type { CalibrateState, Command, DraftState, LayerState, Store, ViewPrefs } from './types'
import { BadgeLayer } from './badges'
import { Hud } from './hud'
import { Sheet } from './sheet'
import { CalibrateLayer } from './calibrate'
import { draftStateAdvanced, sameCalibrateState, sameLayerState, sameViewPrefs } from './render-change'
import {
  EMPTY_RAIL_DWELL,
  advanceRailDwell,
  pointInRailBounds,
  railDwellDelay,
  type RailDwellState,
  type RailPanel
} from './rail-dwell'

const EMPTY_LAYER: LayerState = { cells: [], regions: [], covered: false, hudCovered: false }
const EMPTY_CALIBRATE: CalibrateState = { active: false, count: 14, config: { ...DEFAULT_CALIBRATION }, arenaFound: false }
const DEFAULT_PREFS: ViewPrefs = { badges: true, hud: true, hudCorner: 'tr', layerDetection: false }

const store: Store = {
  state: { ...EMPTY_STATE },
  prefs: { ...DEFAULT_PREFS },
  layer: EMPTY_LAYER,
  calibrate: EMPTY_CALIBRATE,
  sheetOpen: true,
  hoverCell: -1,
  view: { width: window.innerWidth, height: window.innerHeight }
}

const bridge = window.overlay
const hudRoot = document.getElementById('hud')!
const sheetRoot = document.getElementById('sheet')!
const badges = new BadgeLayer(document.getElementById('badges')!)
const hud = new Hud(hudRoot, action)
const sheet = new Sheet(sheetRoot, action)
const calibrate = new CalibrateLayer(document.getElementById('ghosts')!, document.getElementById('calPanel')!, action)

function action(name: string, data?: unknown): void {
  bridge?.action(name, data)
}

// ---------------------------------------------------------------------------
// Render scheduling
// ---------------------------------------------------------------------------

let raf = 0
function schedule(): void {
  if (raf) return
  raf = requestAnimationFrame(() => { raf = 0; render() })
}

function render(): void {
  // Nothing to paint while hidden; main re-syncs and we repaint on show.
  if (document.visibilityState === 'hidden') return
  store.view = { width: window.innerWidth, height: window.innerHeight }
  if (store.view.width <= 0 || store.view.height <= 0) return
  document.body.classList.toggle('calibrating', store.calibrate.active)
  const layout = currentLayout()
  badges.update(store, layout)
  hud.update(store)
  calibrate.update(store)
  // One layout read per frame, after all writes above: main lifts the HUD
  // when Arena covers it, and the sheet stacks against it on the same rail.
  const hudRect = hud.reportRect(rect => bridge?.setHudRect(rect))
  sheet.update(store, hudRect)
}

// ---------------------------------------------------------------------------
// Pack layout (shared by badges + hover hit-testing), cached per view/count/config
// ---------------------------------------------------------------------------

let layoutKey = ''
let layoutCache: PackLayout | null = null

function currentLayout(): PackLayout | null {
  const count = store.state.phase === 'active' ? store.state.cards.length : 0
  if (count === 0) { layoutKey = ''; layoutCache = null; return null }
  const cfg = store.calibrate.config
  const key = `${store.view.width}x${store.view.height}:${count}:${JSON.stringify(cfg)}`
  if (key !== layoutKey || !layoutCache) {
    layoutKey = key
    layoutCache = packLayout(store.view, count, cfg)
  }
  return layoutCache
}

// ---------------------------------------------------------------------------
// Cursor: interactivity + pack-cell hover
// ---------------------------------------------------------------------------

let interactive = false
let railDwell: RailDwellState = EMPTY_RAIL_DWELL
let railDwellTimer: number | null = null

function setInteractive(on: boolean): void {
  if (on === interactive) return
  interactive = on
  bridge?.setInteractive(on)
}

function railBodyAt(el: Element | null, x: number, y: number): RailPanel | null {
  // Buttons opt back into pointer events inside a yielded panel. Check them
  // before the bounds fallback so entering one immediately restores clicks.
  if (el?.closest('button, .hud-icon, .sheet-close')) return null
  if (railDwell.yielded !== null) {
    const root = railDwell.yielded === 'hud' ? hudRoot : sheetRoot
    if (pointInRailBounds(x, y, root.getBoundingClientRect())) return railDwell.yielded
  }
  if (!el) return null
  const panel = el.closest<HTMLElement>('.hud.interactive, .sheet.interactive')
  if (panel === hudRoot) return 'hud'
  if (panel === sheetRoot) return 'sheet'
  return null
}

function updateRailDwell(target: RailPanel | null, now = performance.now()): boolean {
  const previousYield = railDwell.yielded
  railDwell = advanceRailDwell(railDwell, target, now)

  if (previousYield !== railDwell.yielded) {
    hudRoot.classList.toggle('yield', railDwell.yielded === 'hud')
    sheetRoot.classList.toggle('yield', railDwell.yielded === 'sheet')
  }

  if (railDwellTimer !== null) {
    window.clearTimeout(railDwellTimer)
    railDwellTimer = null
  }
  const delay = railDwellDelay(railDwell, now)
  if (delay !== null) {
    railDwellTimer = window.setTimeout(() => {
      railDwellTimer = null
      updateRailDwell(railDwell.target)
    }, delay)
  }

  if (railDwell.yielded !== null) setInteractive(false)
  return railDwell.yielded !== null
}

function setHoverCell(cell: number): void {
  if (cell === store.hoverCell) return
  store.hoverCell = cell
  schedule()
}

document.addEventListener('mousemove', e => {
  const el = document.elementFromPoint(e.clientX, e.clientY)
  const hit = !!(el && el.closest('.interactive'))
  const railBody = railBodyAt(el, e.clientX, e.clientY)
  const yielded = updateRailDwell(railBody)
  setInteractive(hit && !yielded)
  if (hit || railBody !== null || store.calibrate.active) { setHoverCell(-1); return }
  const layout = currentLayout()
  if (!layout) { setHoverCell(-1); return }
  setHoverCell(hoveredCardIndex({ x: e.clientX, y: e.clientY }, layout.cards.map(s => s.card)))
}, { passive: true })

document.addEventListener('mouseleave', () => { updateRailDwell(null); setInteractive(false); setHoverCell(-1) })
window.addEventListener('blur', () => { updateRailDwell(null); setInteractive(false) })

// ---------------------------------------------------------------------------
// Bridge events
// ---------------------------------------------------------------------------

function onState(raw: unknown): void {
  const next = raw as DraftState | null
  if (!next || typeof next !== 'object') return
  if (next === store.state || (typeof next.seq === 'number' && !draftStateAdvanced(store.state.seq, next.seq))) return
  const packChanged = next.pack !== store.state.pack || next.pick !== store.state.pick || next.cards.length !== store.state.cards.length
  store.state = next
  if (packChanged) store.hoverCell = -1
  schedule()
}

function onPrefs(raw: unknown): void {
  const p = raw as Partial<ViewPrefs> | null
  if (!p || typeof p !== 'object') return
  const next: ViewPrefs = {
    badges: p.badges !== false,
    hud: p.hud !== false,
    hudCorner: p.hudCorner === 'tl' || p.hudCorner === 'tr' || p.hudCorner === 'bl' || p.hudCorner === 'br' ? p.hudCorner : 'tr',
    layerDetection: p.layerDetection !== false
  }
  if (sameViewPrefs(store.prefs, next)) return
  store.prefs = next
  schedule()
}

function onLayer(raw: unknown): void {
  const l = raw as Partial<LayerState> | null
  const next: LayerState = {
    cells: Array.isArray(l?.cells) ? l!.cells : [],
    regions: Array.isArray(l?.regions) ? l!.regions : [],
    covered: l?.covered === true,
    hudCovered: l?.hudCovered === true
  }
  if (sameLayerState(store.layer, next)) return
  store.layer = next
  schedule()
}

function onCalibrate(raw: unknown): void {
  const c = raw as Partial<CalibrateState> | null
  const next: CalibrateState = {
    active: c?.active === true,
    count: c?.count === 13 || c?.count === 15 ? c.count : 14,
    config: c?.config && typeof c.config === 'object' ? { ...DEFAULT_CALIBRATION, ...c.config } : { ...DEFAULT_CALIBRATION },
    arenaFound: c?.arenaFound === true
  }
  if (sameCalibrateState(store.calibrate, next)) return
  store.calibrate = next
  if (store.calibrate.active) store.hoverCell = -1
  schedule()
}

function onCommand(raw: unknown): void {
  const cmd = raw as Command | null
  switch (cmd?.name) {
    case 'toggle-sheet': {
      // Main owns the truth; it sends the resulting state with the command.
      const open = (cmd?.data as { open?: boolean } | undefined)?.open
      const next = typeof open === 'boolean' ? open : !store.sheetOpen
      if (next === store.sheetOpen) break
      store.sheetOpen = next
      schedule()
      break
    }
    default:
      break
  }
}

function init(): void {
  window.addEventListener('resize', schedule)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') schedule() })

  if (!bridge) { render(); return }
  bridge.onState(onState)
  bridge.onPrefs(onPrefs)
  bridge.onLayer(onLayer)
  bridge.onCalibrate(onCalibrate)
  bridge.onCommand(onCommand)
  // Late attach: pull whatever main already has.
  void bridge.getState().then(onState).catch(() => undefined)
  void bridge.getPrefs().then(onPrefs).catch(() => undefined)
  render()
}

init()

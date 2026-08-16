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
const badges = new BadgeLayer(document.getElementById('badges')!)
const hud = new Hud(document.getElementById('hud')!, action, schedule)
const sheet = new Sheet(document.getElementById('sheet')!, action)
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

function setInteractive(on: boolean): void {
  if (on === interactive) return
  interactive = on
  bridge?.setInteractive(on)
}

function setHoverCell(cell: number): void {
  if (cell === store.hoverCell) return
  store.hoverCell = cell
  schedule()
}

document.addEventListener('mousemove', e => {
  const el = document.elementFromPoint(e.clientX, e.clientY)
  const hit = !!(el && el.closest('.interactive'))
  setInteractive(hit)
  if (hit || store.calibrate.active) { setHoverCell(-1); return }
  const layout = currentLayout()
  if (!layout) { setHoverCell(-1); return }
  setHoverCell(hoveredCardIndex({ x: e.clientX, y: e.clientY }, layout.cards.map(s => s.card)))
}, { passive: true })

document.addEventListener('mouseleave', () => { setInteractive(false); setHoverCell(-1) })
window.addEventListener('blur', () => { setInteractive(false) })

// ---------------------------------------------------------------------------
// Bridge events
// ---------------------------------------------------------------------------

function onState(raw: unknown): void {
  const next = raw as DraftState | null
  if (!next || typeof next !== 'object') return
  if (typeof next.seq === 'number' && next.seq < store.state.seq) return // stale push
  const packChanged = next.pack !== store.state.pack || next.pick !== store.state.pick || next.cards.length !== store.state.cards.length
  store.state = next
  if (packChanged) store.hoverCell = -1
  schedule()
}

function onPrefs(raw: unknown): void {
  const p = raw as Partial<ViewPrefs> | null
  if (!p || typeof p !== 'object') return
  store.prefs = {
    badges: p.badges !== false,
    hud: p.hud !== false,
    hudCorner: p.hudCorner === 'tl' || p.hudCorner === 'tr' || p.hudCorner === 'bl' || p.hudCorner === 'br' ? p.hudCorner : 'tr',
    layerDetection: p.layerDetection !== false
  }
  schedule()
}

function onLayer(raw: unknown): void {
  const l = raw as Partial<LayerState> | null
  store.layer = {
    cells: Array.isArray(l?.cells) ? l!.cells : [],
    regions: Array.isArray(l?.regions) ? l!.regions : [],
    covered: l?.covered === true,
    hudCovered: l?.hudCovered === true
  }
  schedule()
}

function onCalibrate(raw: unknown): void {
  const c = raw as Partial<CalibrateState> | null
  store.calibrate = {
    active: c?.active === true,
    count: c?.count === 13 || c?.count === 15 ? c.count : 14,
    config: c?.config && typeof c.config === 'object' ? { ...DEFAULT_CALIBRATION, ...c.config } : { ...DEFAULT_CALIBRATION },
    arenaFound: c?.arenaFound === true
  }
  if (store.calibrate.active) store.hoverCell = -1
  schedule()
}

function onCommand(raw: unknown): void {
  const cmd = raw as Command | null
  switch (cmd?.name) {
    case 'toggle-sheet': {
      // Main owns the truth; it sends the resulting state with the command.
      const open = (cmd?.data as { open?: boolean } | undefined)?.open
      store.sheetOpen = typeof open === 'boolean' ? open : !store.sheetOpen
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

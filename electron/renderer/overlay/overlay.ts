/**
 * The overlay page: one transparent, click-through window over Arena.
 *
 * Main pushes whole DraftState snapshots (+ prefs, layer awareness,
 * calibration mode, commands); this file owns the store, coalesces renders
 * into one requestAnimationFrame, hit-tests the cursor for interactivity
 * (window.overlay.setInteractive) and pack-cell hover, and delegates
 * drawing to the layers: badges (frames/chips), hud, sheet, calibrate.
 */
import { EMPTY_STATE, type CalibrateState, type DraftState, type LayerState } from '../../shared/state'
import { DEFAULT_CALIBRATION, packLayout, type PackLayout } from '../../shared/layout'
import { hoveredCardIndex } from '../../shared/hover'
import type { OverlayCommand, Store, ViewPrefs } from './types'
import { BadgeLayer } from './badges'
import { Hud } from './hud'
import { Sheet } from './sheet'
import { CalibrateLayer } from './calibrate'
import { draftStateAdvanced, sameCalibrateState, sameLayerState, sameViewPrefs } from './render-change'
import { RailInteraction } from './rail-interaction'
import { sidebarPresentation } from './sidebar'

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
const railRoot = document.getElementById('draftRail')!
const hudRoot = document.getElementById('hud')!
const sheetRoot = document.getElementById('sheet')!
const sheetBody = sheetRoot.querySelector<HTMLElement>('.sheet-body')!
const badges = new BadgeLayer(document.getElementById('badges')!)
const hud = new Hud(hudRoot, action)
const sheet = new Sheet(sheetRoot, document.getElementById('sheetRating')!)
const calibrate = new CalibrateLayer(document.getElementById('ghosts')!, document.getElementById('calPanel')!, action)
const railInteraction = new RailInteraction(hudRoot, sheetRoot, on => bridge?.setInteractive(on), railRoot)

function action(name: string, data?: unknown): void {
  bridge?.action(name, data)
}

// ---------------------------------------------------------------------------
// Render scheduling
// ---------------------------------------------------------------------------

let raf = 0
let resetSheetScroll = false
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
  const sidebarEnabled = store.prefs.hud && !store.calibrate.active
  const sidebar = sidebarPresentation(store.state.phase, sidebarEnabled, store.view, store.layer)
  railRoot.classList.toggle('open', sidebar.open)
  railRoot.classList.toggle('interactive', sidebar.open)
  railRoot.classList.toggle('preview-covered', sidebar.previewCovered)
  // The idle glyph remains nested here while the full-column owner is closed.
  railRoot.setAttribute('aria-hidden', sidebarEnabled ? 'false' : 'true')
  const layout = currentLayout()
  badges.update(store, layout)
  hud.update(store)
  calibrate.update(store)
  // Main still receives the header rect for preview prediction telemetry;
  // renderer-owned sidebar fading uses the full pure rail frame above.
  hud.reportRect(rect => bridge?.setHudRect(rect))
  sheet.update(store)
  if (resetSheetScroll) {
    sheetBody.scrollTop = 0
    resetSheetScroll = false
  }
  railInteraction.syncTopology()
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
// Cursor: rail interactivity + pack-cell hover
// ---------------------------------------------------------------------------

function setHoverCell(cell: number): void {
  if (cell === store.hoverCell) return
  store.hoverCell = cell
  schedule()
}

document.addEventListener('mousemove', e => {
  const el = document.elementFromPoint(e.clientX, e.clientY)
  const blocksPackHover = railInteraction.handlePointerMove(el, e.clientX, e.clientY)
  if (blocksPackHover || store.calibrate.active) { setHoverCell(-1); return }
  const layout = currentLayout()
  if (!layout) { setHoverCell(-1); return }
  setHoverCell(hoveredCardIndex({ x: e.clientX, y: e.clientY }, layout.cards.map(s => s.card)))
}, { passive: true })

document.addEventListener('mouseleave', () => { railInteraction.releasePointer(); setHoverCell(-1) })
window.addEventListener('blur', () => railInteraction.releasePointer())

// ---------------------------------------------------------------------------
// Bridge events
// ---------------------------------------------------------------------------

function onState(raw: unknown): void {
  const next = raw as DraftState | null
  if (!next || typeof next !== 'object') return
  if (next === store.state || (typeof next.seq === 'number' && !draftStateAdvanced(store.state.seq, next.seq))) return
  const packChanged = next.pack !== store.state.pack || next.pick !== store.state.pick || next.cards.length !== store.state.cards.length
  if (next.phase === 'complete' && store.state.phase !== 'complete') resetSheetScroll = true
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
  const cmd = raw as OverlayCommand | null
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
  // Deliberately absent in production. The source E2E uses this to prove the
  // same predicted-region fade/restore path while main's real cursor polling
  // is disabled for deterministic screenshots.
  if (bridge.e2e) {
    document.addEventListener('mtga:e2e-layer', event => {
      onLayer((event as CustomEvent<unknown>).detail)
    })
  }
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

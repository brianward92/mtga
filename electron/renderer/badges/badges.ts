/**
 * Badge overlay renderer — flame chips anchored on the Arena pack cards.
 *
 * The window covers the Arena window exactly (main keeps the bounds in sync
 * via the geometry poller), so layout.ts maps card index -> window-relative
 * rect directly from window.innerWidth/Height. Badges speak the SAME
 * conviction language as the panel (imported from ../overlay/conviction and
 * ../overlay/flames — never re-derived):
 *
 *   top pick   — conviction flames + band label pill (OBVIOUS BOMB/SLAM/…)
 *                + head-to-head dominance % (when the band shows one)
 *   the rest   — set-percentile flames + head-to-head % vs the card ranked
 *                directly above
 *
 * Honesty rules carry over: heuristic/fallback scores cap the label at SLAM
 * (the conviction/flames modules enforce it) and chips get a ≈ marker.
 *
 * Lifecycle: render on draft-pack (percentile flames from cached ratings),
 * upgrade on draft-scores, CLEAR on draft-pick, hide on draft-end and on
 * tier-list packs (P1P1 pack contents are unknown — no cards to anchor to).
 */

import {
  packLayout,
  normalizeCalibration,
  CalibrationConfig,
  Rect
} from './layout'
import {
  Conviction,
  bandConviction,
  dominanceFromEvs,
  runnerDominance,
  percentileOfSortedAsc,
  formatDominancePct
} from '../overlay/conviction'
import { flamesFromPercentile } from '../overlay/flames'
import { convictionCapped } from '../overlay/model-tag'
import { modelGradeFromPercentile, type ModelGrade } from '../overlay/grades'
import { arenaDisplayOrder } from './display-order'
import { intersects } from './hover'

// ---------------------------------------------------------------------------
// Payload types (mirror main/index.ts)
// ---------------------------------------------------------------------------

interface DraftCardRow {
  grpId: number
  name: string | null
  rarity: string | null
  colors: string | null
  type: string | null
  evP1p1: number | null
  ev: number | null
  prob: number | null
  rank: number | null
}

interface DraftPackPayload {
  pack: number
  pick: number
  isTierList: boolean
  cards: DraftCardRow[]
}

interface ModelInfo {
  id: string
  kind: string
  fallback: boolean | string | null
}

interface DraftScoresPayload {
  pack: number
  pick: number
  model: ModelInfo | null
  cards: DraftCardRow[]
}

interface ServerStatusPayload {
  status: 'green' | 'amber' | 'red'
  model: ModelInfo | null
}

interface DraftStatePayload {
  active: boolean
  pack: DraftPackPayload | null
  scores: DraftScoresPayload | null
  serverStatus: ServerStatusPayload | null
  setEvP1p1Sorted: number[] | null
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let config: CalibrationConfig = normalizeCalibration({})
let currentPack: DraftPackPayload | null = null
let currentScores: DraftScoresPayload | null = null
let setEvSorted: number[] | null = null
let serverStatus: ServerStatusPayload = { status: 'red', model: null }
/** True between a pick and the next pack — badges hide (stale otherwise). */
let cleared = false
let calibrate: { active: boolean; count: number } = { active: false, count: 14 }
/** Regions Arena's hover preview is predicted to cover (window px). */
let hoverRegions: Rect[] = []
/** Cells (display order) main detected as covered by Arena UI. */
let coveredCells = new Set<number>()
/** True while an Arena modal's scrim covers the pack. */
let covered = false

const root = document.getElementById('badgeRoot')!

// ---------------------------------------------------------------------------
// Conviction plumbing (same rules as the panel)
// ---------------------------------------------------------------------------

/**
 * Same cap semantics as the panel (model-tag.ts): the ≈ marker and the SLAM
 * cap apply to true heuristics or degraded status — not to a trained model
 * borrowed across formats (fallback), whose logits are real.
 */
function isHeuristic(): boolean {
  return convictionCapped(currentScores?.model ?? serverStatus.model, serverStatus.status)
}

function setPctFor(row: DraftCardRow): number | null {
  if (row.evP1p1 === null || !Number.isFinite(row.evP1p1) || !setEvSorted) return null
  return percentileOfSortedAsc(row.evP1p1, setEvSorted)
}

function rarityClass(rarity: string | null): string {
  switch ((rarity ?? '').toLowerCase()) {
    case 'mythic': return 'rarity-mythic'
    case 'rare': return 'rarity-rare'
    case 'uncommon': return 'rarity-uncommon'
    default: return 'rarity-common'
  }
}

interface ChipModel {
  rarity: string | null
  flames: number | null
  label: string | null
  pct: string | null
  top: boolean
  heuristic: boolean
  /** Set-relative P1P1 grade letter (null when the set curve is unknown). */
  grade: ModelGrade | null
  /** 1-based rank within this pack by live EV; null before scores arrive. */
  rank: number | null
}

function gradeOf(row: DraftCardRow): ModelGrade | null {
  return modelGradeFromPercentile(setPctFor(row))?.grade ?? null
}

/**
 * One chip model per pack card, in PackCards (= layout) order.
 * Null entries render nothing (no data worth drawing for that card).
 */
function buildChips(cards: DraftCardRow[]): Array<ChipModel | null> {
  const heuristic = isHeuristic()

  const scoredByGrp = currentScores && currentScores.cards.length > 0
    ? new Map(currentScores.cards.map(c => [c.grpId, c]))
    : null

  // Pre-scores: honest percentile flames from the cached ratings only
  if (!scoredByGrp) {
    return cards.map(row => {
      const pct = setPctFor(row)
      const rating = pct !== null ? flamesFromPercentile(pct * 100, { heuristic }) : null
      if (!rating) return null
      return {
        rarity: row.rarity, flames: rating.flames, label: null, pct: null, top: false, heuristic,
        grade: gradeOf(row), rank: null
      }
    })
  }

  // Rank the pack by EV (nulls last) to find the top pick + adjacent gaps
  const entries = cards.map(row => ({ row, ev: scoredByGrp.get(row.grpId)?.ev ?? null }))
  const ranked = [...entries].sort((a, b) => {
    const ae = a.ev !== null && Number.isFinite(a.ev) ? a.ev : null
    const be = b.ev !== null && Number.isFinite(b.ev) ? b.ev : null
    if (ae !== null && be !== null) return be - ae
    if (ae !== null) return -1
    if (be !== null) return 1
    return 0
  })
  const positionByGrp = new Map(ranked.map((e, i) => [e.row.grpId, i]))

  const dominance = dominanceFromEvs(entries.map(e => e.ev))
  const top = ranked[0] ?? null
  const conviction: Conviction | null = dominance !== null && top
    ? bandConviction(dominance, setPctFor(top.row), { heuristic })
    : null

  return cards.map(row => {
    const position = positionByGrp.get(row.grpId) ?? -1
    const isTop = position === 0

    if (isTop && conviction) {
      return {
        rarity: row.rarity,
        flames: conviction.flames,
        label: conviction.label,
        pct: conviction.showPct ? formatDominancePct(conviction.dominance) : null,
        top: true,
        heuristic,
        grade: gradeOf(row),
        rank: 1
      }
    }

    const pct = setPctFor(row)
    const rating = pct !== null ? flamesFromPercentile(pct * 100, { heuristic }) : null
    const h2h = position > 0
      ? runnerDominance(ranked[position].ev, ranked[position - 1].ev)
      : null

    if (!rating && h2h === null) return null
    return {
      rarity: row.rarity,
      flames: rating?.flames ?? null,
      // <2 scored EVs: the top card falls back to percentile flames + label
      label: isTop ? rating?.label ?? null : null,
      pct: h2h !== null ? formatDominancePct(h2h) : null,
      top: isTop,
      heuristic,
      grade: gradeOf(row),
      rank: position >= 0 && ranked[position].ev !== null ? position + 1 : null
    }
  })
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function flamesHtml(flames: number): string {
  let html = '<span class="b-flames">'
  for (let i = 0; i < 5; i++) {
    html += `<span class="b-flame ${i < flames ? 'lit' : 'unlit'}">🔥</span>`
  }
  return html + '</span>'
}

function positionStyle(rect: Rect): string {
  return `left:${rect.x.toFixed(1)}px;top:${rect.y.toFixed(1)}px;` +
    `width:${rect.width.toFixed(1)}px;height:${rect.height.toFixed(1)}px`
}

/** Strength tier that drives the card frame colour. */
function tierClass(chip: ChipModel): string {
  if (chip.top) return 'tier-top'
  const g = chip.grade
  if (g) {
    if (g.startsWith('A')) return 'tier-a'
    if (g.startsWith('B')) return 'tier-b'
    if (g.startsWith('C')) return 'tier-c'
    return 'tier-d'
  }
  const f = chip.flames ?? 0
  return f >= 4 ? 'tier-a' : f >= 3 ? 'tier-b' : f >= 2 ? 'tier-c' : 'tier-d'
}

function chipHtml(chip: ChipModel, rect: Rect, cell: number): string {
  const label = '' // conviction label lives on the frame's bottom-right corner
  const grade = chip.grade ? `<span class="b-grade">${chip.grade}</span>` : ''
  const flames = chip.flames !== null ? flamesHtml(chip.flames) : ''
  const pct = chip.pct ? `<span class="b-pct">${chip.pct}</span>` : ''
  const heur = chip.heuristic ? '<span class="b-heur">≈</span>' : ''
  const classes = ['badge-chip', rarityClass(chip.rarity), tierClass(chip), chip.top ? 'top' : 'dim',
    underHover(rect, cell) ? 'behind' : ''].join(' ')
  // Centered on the card and sized to content (a fixed width clips the grade).
  const style = `left:${(rect.x + rect.width / 2).toFixed(1)}px;top:${rect.y.toFixed(1)}px;` +
    `height:${rect.height.toFixed(1)}px;max-width:${(rect.width * 1.25).toFixed(1)}px`
  return `<div class="${classes}" style="${style}">${label}${grade}${flames}${pct}${heur}</div>`
}

/**
 * Frame that surrounds the whole card face, tinted by strength, with a rank
 * tag (top three only) in the bottom-left corner — over the artist credit,
 * never the name, mana cost, or P/T. Radius tracks Arena's card corner.
 */
function underHover(rect: Rect, cell: number): boolean {
  return coveredCells.has(cell) || hoverRegions.some(r => intersects(r, rect))
}

function frameHtml(chip: ChipModel, card: Rect, cell: number): string {
  const radius = Math.max(4, card.width * 0.045)
  const rank = chip.rank !== null && chip.rank <= 3
    ? `<span class="b-rank">#${chip.rank}</span>` : ''
  const label = chip.label ? `<span class="b-label">${chip.label}</span>` : ''
  const classes = ['card-frame', tierClass(chip), chip.top ? 'top' : '', underHover(card, cell) ? 'behind' : ''].join(' ')
  return `<div class="${classes}" style="${positionStyle(card)};border-radius:${radius.toFixed(1)}px">${rank}${label}</div>`
}

function renderGhosts(view: { width: number; height: number }): void {
  const layout = packLayout(view, calibrate.count, config)
  const frame = `<div class="ghost-frame" style="${positionStyle(layout.pack)}"></div>`
  const cells = layout.cards.map((slot, i) => `
    <div class="ghost-card" style="${positionStyle(slot.card)}"><span class="ghost-num">${i + 1}</span></div>
    <div class="ghost-badge" style="${positionStyle(slot.badge)}"></div>
  `).join('')
  root.innerHTML = frame + cells
}

function render(): void {
  // Hidden window: skip all DOM work. Main also stops sending draft events
  // while hidden (belt and braces) and re-syncs state when the window shows;
  // the visibilitychange hook below repaints from whatever state we hold.
  if (document.visibilityState === 'hidden') return

  const view = { width: window.innerWidth, height: window.innerHeight }
  if (view.width <= 0 || view.height <= 0) return
  root.classList.toggle('covered', covered)

  if (calibrate.active) {
    renderGhosts(view)
    return
  }

  // Tier-list "packs" are the set's top cards, not what's on screen — and
  // between picks the pack is stale. Nothing honest to anchor: draw nothing.
  if (cleared || !currentPack || currentPack.isTierList || currentPack.cards.length === 0) {
    root.innerHTML = ''
    return
  }

  const cards = currentPack.cards
  const layout = packLayout(view, cards.length, config)
  const chips = buildChips(cards)
  // Layout cells are Arena's on-screen order, not the log's PackCards order.
  const order = arenaDisplayOrder(cards)
  root.innerHTML = order
    .map((cardIndex, cell) => {
      const chip = chips[cardIndex]
      const slot = layout.cards[cell]
      if (!chip || !slot) return ''
      return frameHtml(chip, slot.card, cell) + chipHtml(chip, slot.badge, cell)
    })
    .join('')
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

function init(): void {
  if (!window.mtgaTracker) return

  // Main re-bounds this window whenever Arena moves/resizes; coalesce the
  // resize storm during a live drag-resize into one paint per frame.
  let resizeRaf = 0
  window.addEventListener('resize', () => {
    if (resizeRaf) return
    resizeRaf = requestAnimationFrame(() => { resizeRaf = 0; render() })
  })

  // Renders skipped while hidden happen here instead, once visible
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') render()
  })

  window.mtgaTracker.onBadgeView((data: unknown) => {
    const view = data as { config?: unknown }
    config = normalizeCalibration(view?.config)
    render()
  })

  window.mtgaTracker.onBadgeLayer((data: unknown) => {
    const payload = data as { regions?: Rect[]; cells?: number[]; covered?: boolean }
    hoverRegions = Array.isArray(payload?.regions) ? payload.regions : []
    coveredCells = new Set(Array.isArray(payload?.cells) ? payload.cells : [])
    covered = payload?.covered === true
    render()
  })

  window.mtgaTracker.onCalibrateMode((data: unknown) => {
    const mode = data as { active?: boolean; count?: number; config?: unknown }
    calibrate = {
      active: mode?.active === true,
      count: mode?.count === 13 || mode?.count === 15 ? mode.count : 14
    }
    if (mode?.config) config = normalizeCalibration(mode.config)
    render()
  })

  window.mtgaTracker.onDraftStart(() => {
    currentPack = null
    currentScores = null
    setEvSorted = null
    cleared = false
    render()
  })

  window.mtgaTracker.onDraftPack((data: unknown) => {
    const pack = data as DraftPackPayload
    // A refresh of the same pack (stats/art arrived) keeps its live scores.
    const samePack = !!currentScores && !pack.isTierList &&
      currentScores.pack === pack.pack && currentScores.pick === pack.pick
    currentPack = pack
    if (!pack.isTierList && !samePack) currentScores = null
    cleared = false
    render()
  })

  window.mtgaTracker.onDraftScores((data: unknown) => {
    const scores = data as DraftScoresPayload
    if (!currentPack || currentPack.isTierList) return
    if (scores.pack !== currentPack.pack || scores.pick !== currentPack.pick) return
    currentScores = scores
    render()
  })

  window.mtgaTracker.onDraftPick(() => {
    cleared = true
    render()
  })

  window.mtgaTracker.onDraftEnd(() => {
    currentPack = null
    currentScores = null
    cleared = false
    render()
  })

  window.mtgaTracker.onDraftRatings((data: unknown) => {
    setEvSorted = (data as { setEvP1p1Sorted: number[] | null })?.setEvP1p1Sorted ?? null
    render()
  })

  window.mtgaTracker.onServerStatus((data: unknown) => {
    serverStatus = data as ServerStatusPayload
    render()
  })

  // Late attach: pull any in-progress draft from the main process
  void window.mtgaTracker.getDraftState().then((raw: unknown) => {
    const state = raw as DraftStatePayload | null
    if (!state) return
    if (state.serverStatus) serverStatus = state.serverStatus
    if (!state.active) return
    setEvSorted = state.setEvP1p1Sorted ?? null
    if (state.pack) currentPack = state.pack
    if (state.scores && state.pack &&
        state.scores.pack === state.pack.pack && state.scores.pick === state.pack.pick) {
      currentScores = state.scores
    }
    render()
  })
}

init()

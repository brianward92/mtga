/**
 * Draft overlay view.
 *
 * Takes over the panel between draft-start and draft-end. Three densities
 * (see density.ts), cycled by the grip button:
 *
 *   verdict — THE PICK: name + flame rating (model conviction), model grade,
 *             two runner-ups, and a compact pool color summary
 *   full    — verdict + ranked pack table (grade/GIH/ALSA) + pool curve +
 *             collapsible pick history
 *   mini    — grip + one line: top pick name only
 *
 * A persistent 17Lands attribution footer stays visible in every density
 * (license requirement).
 */

import { effectiveZoom, escapeHtml, renderManaCost, renderManaSymbol, formatWinRate, formatRelativeAge } from './shared'
import { Density, nextDensity, normalizeDensity, densityClass, densityTitle, DENSITY_CYCLE } from './density'
import { FlameRating, flamesFromPercentile } from './flames'
import { convictionCapped, modelTag, modelVersionTag } from './model-tag'
import {
  Conviction,
  bandConviction,
  dominanceFromEvs,
  runnerDominance,
  percentileOfSortedAsc,
  formatDominancePct,
  formatSplit
} from './conviction'
import {
  ModelGradeResult,
  modelGradeForScore,
  modelGradeFromPercentile,
  modelGradeTitle,
  modelGradeClass
} from './grades'

// ---------------------------------------------------------------------------
// Payload types (mirror main/index.ts)
// ---------------------------------------------------------------------------

interface DraftCardRow {
  grpId: number
  name: string | null
  manaCost: string
  type: string
  rarity: string | null
  colors: string
  manaValue: number | null
  gihWr: number | null
  alsa: number | null
  evP1p1: number | null
  ev: number | null
  prob: number | null
  tierPct: number | null
  rank: number | null
  imageUrl: string | null
}

interface DraftStartPayload {
  draftId: string | null
  eventName: string | null
  set: string | null
  format: string | null
  isBotDraft: boolean
  picksCount: number
}

interface DraftPackPayload {
  pack: number
  pick: number
  isTierList: boolean
  note: string | null
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

interface HistoryEntry {
  pack: number
  pick: number
  grpIds: number[]
  names: string[]
  packNames: string[]
}

interface DraftPickPayload {
  pack: number | null
  pick: number | null
  grpIds: number[]
  pickedNames: string[]
  picksCount: number
  pool: DraftCardRow[]
  history: HistoryEntry[]
}

interface DraftEndPayload {
  set: string | null
  format: string | null
  picksCount: number
  pool: DraftCardRow[]
}

interface ServerStatusPayload {
  status: 'green' | 'amber' | 'red'
  model: ModelInfo | null
  stale: boolean
  fetchedAt: string | null
}

interface DraftStatePayload {
  active: boolean
  start: DraftStartPayload | null
  pack: DraftPackPayload | null
  scores: DraftScoresPayload | null
  pick: DraftPickPayload | null
  end: DraftEndPayload | null
  serverStatus: ServerStatusPayload | null
  detailedLogsEnabled: boolean | null
  /** ev_p1p1 for every rated card in the set, sorted ascending. */
  setEvP1p1Sorted: number[] | null
}

interface DraftRatingsPayload {
  setEvP1p1Sorted: number[] | null
}

// Arena drafts: 3 packs x 14 picks
const TOTAL_PICKS = 42

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let draftActive = false
let session: DraftStartPayload | null = null
let currentPack: DraftPackPayload | null = null
let currentScores: DraftScoresPayload | null = null
/** Set-wide ev_p1p1 distribution (sorted asc), cached for set percentiles. */
let setEvSorted: number[] | null = null
let pool: DraftCardRow[] = []
let history: HistoryEntry[] = []
let picksCount = 0
let serverStatus: ServerStatusPayload = { status: 'red', model: null, stale: false, fetchedAt: null }
let historyExpanded = false
const expandedHistoryKeys = new Set<string>()
let density: Density = 'verdict'
let endTimer: number | null = null
/** Set when scores land so the flame row staggers in exactly once. */
let animateFlames = false
let agreeGlowTimer: number | null = null
let heightSyncRaf = 0

// DOM elements
const overlay = document.getElementById('overlay')!
const draftView = document.getElementById('draftView')!
const draftGrip = document.getElementById('draftGrip')!
const draftEventChip = document.getElementById('draftEventChip')!
const draftPickPos = document.getElementById('draftPickPos')!
const serverDot = document.getElementById('serverDot')!
const densityBtn = document.getElementById('densityBtn')!
const draftNote = document.getElementById('draftNote')!
const verdictView = document.getElementById('verdictView')!
const miniLine = document.getElementById('miniLine')!
const packTable = document.getElementById('packTable')!
const poolStrip = document.getElementById('poolStrip')!
const historyToggle = document.getElementById('historyToggle')!
const historyCount = document.getElementById('historyCount')!
const historyList = document.getElementById('historyList')!
const footerModel = document.getElementById('footerModel')!
const logWarning = document.getElementById('logWarning')!

// ---------------------------------------------------------------------------
// Public API (used by overlay.ts)
// ---------------------------------------------------------------------------

export function isDraftActive(): boolean {
  return draftActive
}

/** Cycle the density: verdict -> full -> mini -> verdict. */
export function cycleDraftDensity(): void {
  if (!draftActive) return
  applyDensity(nextDensity(density))
}

export function initDraftView(): void {
  if (!window.mtgaTracker) return

  historyToggle.addEventListener('click', () => {
    historyExpanded = !historyExpanded
    historyToggle.setAttribute('aria-expanded', String(historyExpanded))
    renderHistory()
  })

  // Expand/collapse a history entry's pack context (delegated: survives re-render)
  historyList.addEventListener('click', e => {
    const entry = (e.target as HTMLElement).closest('.history-entry') as HTMLElement | null
    if (!entry || !entry.dataset.key) return
    if (expandedHistoryKeys.has(entry.dataset.key)) {
      expandedHistoryKeys.delete(entry.dataset.key)
    } else {
      expandedHistoryKeys.add(entry.dataset.key)
    }
    entry.classList.toggle('expanded')
  })

  densityBtn.addEventListener('click', cycleDraftDensity)

  // Main may request a density cycle when Arena-anchored badges turn on.
  window.mtgaTracker.onDensityCycle(() => cycleDraftDensity())

  // Restore the last chosen density (defaults to verdict)
  void window.mtgaTracker.getOverlayPrefs().then(prefs => {
    density = normalizeDensity(prefs?.draftDensity)
    if (draftActive) applyDensity(density, { notify: false })
  })

  // If main resizes the window (density switch), verify our content fits
  window.addEventListener('resize', () => scheduleHeightSync())

  window.mtgaTracker.onDraftStart((data: unknown) => {
    handleDraftStart(data as DraftStartPayload)
  })

  window.mtgaTracker.onDraftPack((data: unknown) => {
    handleDraftPack(data as DraftPackPayload)
  })

  window.mtgaTracker.onDraftScores((data: unknown) => {
    handleDraftScores(data as DraftScoresPayload)
  })

  // Set-wide ev_p1p1 distribution (ratings prefetch) — powers setPct bands
  window.mtgaTracker.onDraftRatings((data: unknown) => {
    setEvSorted = (data as DraftRatingsPayload)?.setEvP1p1Sorted ?? null
    if (draftActive && currentPack) renderPickViews()
  })

  window.mtgaTracker.onDraftPick((data: unknown) => {
    handleDraftPick(data as DraftPickPayload)
  })

  window.mtgaTracker.onDraftEnd((data: unknown) => {
    handleDraftEnd(data as DraftEndPayload)
  })

  window.mtgaTracker.onServerStatus((data: unknown) => {
    serverStatus = data as ServerStatusPayload
    renderServerStatus()
  })

  window.mtgaTracker.onDetailedLogs((data: unknown) => {
    const { enabled } = data as { enabled: boolean }
    logWarning.style.display = enabled ? 'none' : 'block'
  })

  // Late attach: pull any in-progress draft from the main process
  void window.mtgaTracker.getDraftState().then((raw: unknown) => {
    const state = raw as DraftStatePayload | null
    if (!state) return
    if (state.serverStatus) {
      serverStatus = state.serverStatus
      renderServerStatus()
    }
    if (state.detailedLogsEnabled === false) {
      logWarning.style.display = 'block'
    }
    if (!state.active || !state.start) return

    handleDraftStart(state.start)
    setEvSorted = state.setEvP1p1Sorted ?? null
    if (state.pick) applyPickPayload(state.pick)
    if (state.pack) handleDraftPack(state.pack)
    if (state.scores) handleDraftScores(state.scores)
  })
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

function handleDraftStart(data: DraftStartPayload): void {
  session = data
  currentPack = null
  currentScores = null
  setEvSorted = null
  pool = []
  history = []
  picksCount = data.picksCount ?? 0
  expandedHistoryKeys.clear()
  if (endTimer !== null) {
    window.clearTimeout(endTimer)
    endTimer = null
  }

  enterDraftMode()
  renderHeader()
  renderServerStatus()
  renderWaiting()
  renderPool()
  renderHistory()
}

function handleDraftPack(data: DraftPackPayload): void {
  if (!draftActive) enterDraftMode()
  currentPack = data
  if (!data.isTierList) {
    currentScores = null
  }
  renderHeader()
  renderPickViews()
}

function handleDraftScores(data: DraftScoresPayload): void {
  if (!currentPack || currentPack.isTierList) return
  if (data.pack !== currentPack.pack || data.pick !== currentPack.pick) return
  currentScores = data
  animateFlames = true
  renderHeader()
  renderPickViews()
}

function handleDraftPick(data: DraftPickPayload): void {
  const forCurrentPack =
    currentPack !== null &&
    !currentPack.isTierList &&
    data.pack === currentPack.pack &&
    data.pick === currentPack.pick

  // Did the human take the model's top choice? Quiet ✨ on the grip.
  if (forCurrentPack && currentScores) {
    const top = sortRows(currentScores.cards)[0]
    if (top && data.grpIds.includes(top.grpId)) {
      showAgreementGlow()
    }
  }

  applyPickPayload(data)

  // Gentle highlight decay on the row the human actually took
  if (forCurrentPack) {
    for (const grpId of data.grpIds) {
      const row = packTable.querySelector(`[data-grpid="${grpId}"]`)
      if (row) {
        row.classList.remove('picked-glow')
        // restart the animation if the class was already applied
        void (row as HTMLElement).offsetWidth
        row.classList.add('picked-glow')
        window.setTimeout(() => row.classList.remove('picked-glow'), 450)
      }
    }
  }
}

function applyPickPayload(data: DraftPickPayload): void {
  pool = data.pool ?? []
  history = data.history ?? []
  picksCount = data.picksCount ?? history.length
  renderPool()
  renderHistory()
}

function handleDraftEnd(data: DraftEndPayload): void {
  pool = data.pool ?? pool
  picksCount = data.picksCount ?? picksCount
  currentPack = null
  currentScores = null

  // The ✨ agree-glow (1.4s) must not linger onto the "Draft complete" card
  if (agreeGlowTimer !== null) {
    window.clearTimeout(agreeGlowTimer)
    agreeGlowTimer = null
  }
  draftGrip.classList.remove('grip-agree')

  renderHeader()
  renderPool()
  renderHistory()
  draftNote.style.display = 'none'

  const completeHtml = `
    <div class="draft-complete">
      <div class="draft-complete-title">Draft complete</div>
      <div class="draft-complete-sub">${pool.length} cards drafted</div>
      <button class="draft-complete-dismiss" id="draftDismissBtn">Done</button>
    </div>
  `
  verdictView.innerHTML = completeHtml
  packTable.innerHTML = completeHtml.replace('draftDismissBtn', 'draftDismissBtn2')
  miniLine.innerHTML = '<span class="mini-name">Draft complete</span>'

  const dismiss = () => dismissDraft()
  document.getElementById('draftDismissBtn')?.addEventListener('click', dismiss)
  document.getElementById('draftDismissBtn2')?.addEventListener('click', dismiss)
  scheduleHeightSync()

  // Auto-dismiss after 10s if the button isn't used
  if (endTimer !== null) window.clearTimeout(endTimer)
  endTimer = window.setTimeout(dismiss, 10_000)
}

/** Hand the panel back to the match view (button, or the 10s timeout). */
function dismissDraft(): void {
  if (endTimer !== null) {
    window.clearTimeout(endTimer)
    endTimer = null
  }
  exitDraftMode()
  window.mtgaTracker.dismissDraft()
}

// ---------------------------------------------------------------------------
// Mode / density
// ---------------------------------------------------------------------------

function enterDraftMode(): void {
  draftActive = true
  overlay.classList.add('draft-mode')
  draftView.style.display = 'flex'
  applyDensity(density, { notify: false })
}

function exitDraftMode(): void {
  draftActive = false
  overlay.classList.remove('draft-mode')
  for (const d of DENSITY_CYCLE) overlay.classList.remove(densityClass(d))
  draftView.style.display = 'none'
}

function applyDensity(next: Density, opts: { notify?: boolean } = {}): void {
  density = next
  for (const d of DENSITY_CYCLE) overlay.classList.remove(densityClass(d))
  overlay.classList.add(densityClass(density))
  densityBtn.setAttribute('title', densityTitle(density))
  if (opts.notify !== false) {
    window.mtgaTracker.setOverlayDensity(density)
  }
  scheduleHeightSync()
}

/**
 * Verdict/mini densities size the window to the content (the window is
 * transparent but still swallows clicks wherever it extends — it must hug
 * the panel). Measured after layout; main clamps and applies.
 */
function scheduleHeightSync(): void {
  if (heightSyncRaf) cancelAnimationFrame(heightSyncRaf)
  heightSyncRaf = requestAnimationFrame(() => {
    heightSyncRaf = requestAnimationFrame(() => {
      heightSyncRaf = 0
      if (!draftActive || density === 'full') return
      const target = Math.ceil(overlay.getBoundingClientRect().height)
      if (target > 0 && Math.abs(target - window.innerHeight) > 2) {
        window.mtgaTracker.overlaySetSize(null, target, false)
      }
    })
  })
}

function showAgreementGlow(): void {
  if (agreeGlowTimer !== null) window.clearTimeout(agreeGlowTimer)
  draftGrip.classList.add('grip-agree')
  agreeGlowTimer = window.setTimeout(() => {
    draftGrip.classList.remove('grip-agree')
    agreeGlowTimer = null
  }, 1400)
}

// ---------------------------------------------------------------------------
// Ranking helpers
// ---------------------------------------------------------------------------

/** Pick the metric used for ranking this pack (ev > evP1p1 > gihWr). */
function sortMetric(row: DraftCardRow, rows: DraftCardRow[]): number | null {
  if (rows.some(r => r.ev !== null)) return row.ev
  if (rows.some(r => r.evP1p1 !== null)) return row.evP1p1
  return row.gihWr
}

function sortRows(rows: DraftCardRow[]): DraftCardRow[] {
  return [...rows].sort((a, b) => {
    // Unknown cards always last
    const aUnknown = a.name ? 0 : 1
    const bUnknown = b.name ? 0 : 1
    if (aUnknown !== bUnknown) return aUnknown - bUnknown

    const aMetric = sortMetric(a, rows)
    const bMetric = sortMetric(b, rows)
    if (aMetric !== null && bMetric !== null && aMetric !== bMetric) return bMetric - aMetric
    if (aMetric !== null && bMetric === null) return -1
    if (aMetric === null && bMetric !== null) return 1
    return (a.name ?? '').localeCompare(b.name ?? '')
  })
}

/** The rows currently on screen, ranked. */
function rankedRows(): DraftCardRow[] {
  if (!currentPack) return []
  const scored = currentScores?.cards ?? null
  return sortRows(scored && scored.length > 0 ? scored : currentPack.cards)
}

/**
 * Card art thumbnail. `imageUrl` is a local file:// URL written by the main
 * process's art cache — never a remote URL, so a row never triggers a network
 * fetch while rendering. Renders an empty placeholder until the art lands so
 * rows do not reflow when it does.
 */
function cardArtHtml(row: DraftCardRow): string {
  if (!row.imageUrl) return '<span class="pick-art pick-art-empty" aria-hidden="true"></span>'
  const alt = row.name ? `${escapeHtml(row.name)} card art` : 'Card art'
  return (
    `<img class="pick-art" src="${escapeHtml(row.imageUrl)}" alt="${alt}" ` +
    `loading="lazy" decoding="async">`
  )
}

function rarityClass(rarity: string | null): string {
  switch ((rarity ?? '').toLowerCase()) {
    case 'mythic': return 'rarity-mythic'
    case 'rare': return 'rarity-rare'
    case 'uncommon': return 'rarity-uncommon'
    default: return 'rarity-common'
  }
}

/** setPct: the row's ev_p1p1 percentile (0..1) within the whole set. */
function setPctFor(row: DraftCardRow): number | null {
  if (row.evP1p1 === null || !Number.isFinite(row.evP1p1) || !setEvSorted) return null
  return percentileOfSortedAsc(row.evP1p1, setEvSorted)
}

/** Stable intrinsic grade; current pool-conditioned logits only rank the pack. */
function gradeFor(row: DraftCardRow): ModelGradeResult | null {
  const fromScore = modelGradeForScore(row.evP1p1, setEvSorted)
  if (fromScore) return fromScore
  return currentPack?.isTierList && row.tierPct !== null
    ? modelGradeFromPercentile(row.tierPct / 100)
    : null
}

/**
 * Conviction for a live scored pack: head-to-head dominance of the top card
 * over the runner-up (sigmoid of the EV gap), banded with the set percentile.
 * Null when not applicable (tier list, scores pending, <2 scored cards).
 */
function packConviction(rows: DraftCardRow[]): Conviction | null {
  if (!currentPack || currentPack.isTierList || !currentScores) return null
  const dominance = dominanceFromEvs(rows.map(r => r.ev))
  if (dominance === null) return null
  return bandConviction(dominance, setPctFor(rows[0]), { heuristic: isHeuristic() })
}

/**
 * Percentile-based flame rating: tier percentile on P1P1, or the set
 * percentile when a scored pack has <2 EVs to compare head-to-head.
 */
function percentileFlamesFor(row: DraftCardRow): FlameRating | null {
  const heuristic = isHeuristic()
  if (currentPack?.isTierList) return flamesFromPercentile(row.tierPct, { heuristic })
  if (!currentScores) return null
  const setPct = setPctFor(row)
  return setPct !== null ? flamesFromPercentile(setPct * 100, { heuristic }) : null
}

/**
 * True when conviction bands must be capped at SLAM (honesty guard): a true
 * heuristic model (z-scores, not logits) or a degraded server status. A
 * trained model borrowed across formats (fallback=true) is NOT capped — its
 * logits are real; it gets a provenance tag instead (see model-tag.ts).
 */
function isHeuristic(): boolean {
  return convictionCapped(currentScores?.model ?? serverStatus.model, serverStatus.status)
}

function flameRowHtml(rating: FlameRating, opts: { small?: boolean; animate?: boolean } = {}): string {
  const size = opts.small ? 'flames-small' : ''
  const slots = Array.from({ length: 5 }, (_, i) => {
    const filled = i < rating.flames
    const delay = opts.animate && filled ? ` style="animation-delay: ${i * 120}ms"` : ''
    return `<span class="flame ${filled ? 'lit' : 'unlit'}${opts.animate && filled ? ' flame-in' : ''}"${delay}>🔥</span>`
  }).join('')
  return `<span class="flames ${size}" aria-label="${rating.flames} of 5">${slots}</span>`
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderHeader(): void {
  const set = session?.set ?? '?'
  const format = session?.format ? session.format.replace(/Draft$/, ' Draft').trim() : 'Draft'
  draftEventChip.textContent = `${set} · ${format}`

  if (currentPack && !currentPack.isTierList) {
    draftPickPos.textContent = `P${currentPack.pack}P${currentPack.pick}`
  } else if (currentPack?.isTierList) {
    draftPickPos.textContent = 'P1P1'
  } else {
    draftPickPos.textContent = ''
  }

  // 300px verdict width truncates full model ids: show just the version
  // segment ("v20260703"), full id + provenance in the tooltip.
  const model = currentScores?.model ?? serverStatus.model
  if (model) {
    footerModel.textContent = modelVersionTag(model.id)
    const tag = modelTag(model)
    footerModel.setAttribute('title', tag ? `${model.id} · ${tag.title}` : model.id)
  } else {
    footerModel.textContent = ''
    footerModel.removeAttribute('title')
  }
}

function renderServerStatus(): void {
  serverDot.className = `server-dot ${serverStatus.status}`
  const titles: Record<string, string> = {
    green: 'Server online — live model scores',
    amber: `Stats from cache${serverStatus.fetchedAt ? ` (fetched ${serverStatus.fetchedAt.slice(0, 10)})` : ''}`,
    red: 'Server offline — card names only'
  }
  serverDot.setAttribute('title', titles[serverStatus.status] ?? '')
  renderHeader()
}

/** Quiet single-line empty state — never a skeleton wall. */
function renderWaiting(): void {
  const waiting = '<div class="draft-empty">waiting for pack…</div>'
  verdictView.innerHTML = waiting
  packTable.innerHTML = waiting
  miniLine.innerHTML = '<span class="mini-name muted">waiting for pack…</span>'
  draftNote.style.display = 'none'
  scheduleHeightSync()
}

/** Re-render everything that depends on the current pack/scores. */
function renderPickViews(): void {
  if (!currentPack) {
    renderWaiting()
    return
  }

  if (currentPack.isTierList) {
    draftNote.textContent = 'Pack hidden by Arena — showing set tier list'
    draftNote.style.display = 'block'
  } else {
    draftNote.style.display = 'none'
  }

  const rows = rankedRows()
  renderVerdict(rows)
  renderPackTable(rows)
  renderMiniLine(rows)
  animateFlames = false
  scheduleHeightSync()
}

function verdictWhyHtml(row: DraftCardRow): string {
  const parts: string[] = []
  const grade = gradeFor(row)
  if (grade) {
    parts.push(`<span class="grade-value ${modelGradeClass(grade.grade)}" title="${modelGradeTitle(grade)}">Model grade ${grade.grade}</span>`)
  }
  if (row.gihWr !== null) parts.push(`GIH ${formatWinRate(row.gihWr)}`)
  if (row.alsa !== null && Number.isFinite(row.alsa)) parts.push(`ALSA ${row.alsa.toFixed(1)}`)
  return parts.length > 0 ? parts.join(' · ') : ''
}

/** Normalized 0..100 recommendation bar within this pack. */
function evBarPct(row: DraftCardRow, rows: DraftCardRow[]): number {
  const metrics = rows
    .map(r => sortMetric(r, rows))
    .filter((v): v is number => v !== null && Number.isFinite(v))
  if (metrics.length === 0) return 0
  const metric = sortMetric(row, rows)
  if (metric === null || !Number.isFinite(metric)) return 0
  const min = Math.min(...metrics)
  const max = Math.max(...metrics)
  return max > min ? ((metric - min) / (max - min)) * 100 : 100
}

/**
 * One runner-up line: rank, name, and its own head-to-head vs the card
 * ranked directly above it (sigmoid of the adjacent score gap). Tier-list
 * rows keep percentile flames; other fallbacks show the intrinsic grade.
 */
function runnerHtml(rows: DraftCardRow[], index: number): string {
  const row = rows[index]
  const name = row.name ?? 'Unknown card'
  const grade = gradeFor(row)
  const gradeFallback = grade
    ? `<span class="runner-grade ${modelGradeClass(grade.grade)}" title="${modelGradeTitle(grade)}">${grade.grade}</span>`
    : `<span class="runner-grade">—</span>`

  let right: string
  if (currentPack?.isTierList) {
    const rating = percentileFlamesFor(row)
    right = rating ? flameRowHtml(rating, { small: true }) : gradeFallback
  } else {
    const headToHead = runnerDominance(row.ev, rows[index - 1]?.ev)
    right = headToHead !== null
      ? `<span class="runner-pct" title="Pairwise model preference vs. the card above; not game win rate">${formatDominancePct(headToHead)}</span>`
      : gradeFallback
  }

  return `
    <div class="runner ${row.name ? '' : 'unknown-card'}">
      <span class="runner-rank">${index + 1}</span>
      <span class="runner-name ${rarityClass(row.rarity)}">${escapeHtml(name)}</span>
      ${right}
    </div>
  `
}

/** THE PICK: name large, conviction, model grade, and runner-ups. */
function renderVerdict(rows: DraftCardRow[]): void {
  if (rows.length === 0) {
    verdictView.innerHTML = '<div class="draft-empty">No cards in pack</div>'
    return
  }

  const top = rows[0]
  const conviction = packConviction(rows)
  const rating: FlameRating | null = conviction
    ? { flames: conviction.flames, label: conviction.label }
    : percentileFlamesFor(top)
  // Provenance tag (HEURISTIC / PREMIER MODEL / ZERO-SHOT) — model identity,
  // independent of the amber/red degradation indicators below.
  const tag = modelTag(currentScores?.model ?? serverStatus.model)
  const tagHtml = rating && tag
    ? `<span class="heuristic-tag" title="${escapeHtml(tag.title)}">${tag.text}</span>`
    : ''

  // Flame area: real conviction, or an honest quiet placeholder. The shown
  // percentage is always head-to-head dominance, never raw softmax.
  let flameArea: string
  if (rating) {
    const label = rating.label ? `<span class="flame-label">${rating.label}</span>` : ''
    const pct = conviction?.showPct
      ? `<span class="conviction-pct" title="Pairwise model preference vs. next-best card; not game win rate">${formatDominancePct(conviction.dominance)}</span>`
      : ''
    flameArea = `<div class="verdict-flames">${flameRowHtml(rating, { animate: animateFlames })}${label}${pct}${tagHtml}</div>`
  } else if (serverStatus.status === 'red') {
    flameArea = '<div class="verdict-flames"><span class="flame-pending">stats only</span></div>'
  } else if (serverStatus.status === 'amber') {
    // Serving the stale disk cache: scores will NOT arrive, so never claim
    // "scoring…" — say what the numbers are and how old they are.
    const age = formatRelativeAge(serverStatus.fetchedAt)
    flameArea = `<div class="verdict-flames"><span class="flame-pending">stats only (cached${age ? ` ${age}` : ''})</span></div>`
  } else {
    flameArea = '<div class="verdict-flames"><span class="flame-pending">scoring…</span></div>'
  }

  // "close call": top two side by side with their pairwise split (e.g. 52/48)
  const closeCall = conviction !== null && conviction.closeCall && rows.length > 1
  let topHtml: string
  if (closeCall && conviction) {
    const split = formatSplit(conviction.dominance)
    topHtml = `
      <div class="verdict-duo">
        ${[rows[0], rows[1]].map((row, i) => `
          <div class="verdict-duo-card">
            <div class="verdict-name small ${rarityClass(row.rarity)}">${escapeHtml(row.name ?? 'Unknown card')}</div>
            <div class="verdict-bar" title="Relative recommendation within this pack"><span style="width: ${evBarPct(row, rows).toFixed(0)}%"></span></div>
            <div class="verdict-duo-pct" title="Pairwise model preference vs. the other card; not game win rate">${split[i]}%</div>
          </div>
        `).join('')}
      </div>
      ${flameArea}
    `
  } else {
    topHtml = `
      <div class="verdict-top">
        <div class="verdict-name ${rarityClass(top.rarity)}">${escapeHtml(top.name ?? 'Unknown card')}</div>
        <span class="verdict-mana">${renderManaCost(top.manaCost)}</span>
      </div>
      ${flameArea}
      <div class="verdict-bar" title="Relative recommendation within this pack"><span style="width: ${evBarPct(top, rows).toFixed(0)}%"></span></div>
      <div class="verdict-why">${verdictWhyHtml(top)}</div>
    `
  }

  const runners = closeCall
    ? (rows.length > 2 ? runnerHtml(rows, 2) : '')
    : rows.slice(1, 3).map((_, i) => runnerHtml(rows, i + 1)).join('')

  verdictView.innerHTML = `
    ${topHtml}
    ${runners ? `<div class="verdict-runners">${runners}</div>` : ''}
    <div class="verdict-pool" id="verdictPool">${poolStripHtml()}</div>
  `
}

function renderMiniLine(rows: DraftCardRow[]): void {
  if (rows.length === 0) {
    miniLine.innerHTML = '<span class="mini-name muted">no cards</span>'
    return
  }
  const top = rows[0]
  miniLine.innerHTML = `
    <span class="mini-name ${rarityClass(top.rarity)}">${escapeHtml(top.name ?? 'Unknown card')}</span>
    <span class="mini-attr">17Lands.com</span>
  `
}

/**
 * Full ranked table with FLIP re-sorts: rows keyed by grpId animate to
 * their new position (140ms ease-out) instead of flashing a wholesale
 * re-render when scores land.
 */
function renderPackTable(rows: DraftCardRow[]): void {
  if (rows.length === 0) {
    packTable.innerHTML = '<div class="draft-empty">No cards in pack</div>'
    return
  }

  // FLIP: record where each row was
  const before = new Map<string, number>()
  packTable.querySelectorAll<HTMLElement>('[data-grpid]').forEach(el => {
    before.set(el.dataset.grpid!, el.getBoundingClientRect().top)
  })

  const header = `
    <div class="pick-row pick-row-header" role="row">
      <span class="pick-rank" role="columnheader">#</span>
      <span class="pick-card" role="columnheader">Card</span>
      <span class="pick-grade" role="columnheader" aria-label="Set-relative P1P1 model grade" title="Set-relative P1P1 model grade; live rank also considers this pack and your pool">Grade</span>
      <span class="pick-gih" role="columnheader">GIH</span>
      <span class="pick-alsa" role="columnheader">ALSA</span>
    </div>
  `

  const body = rows.map((row, index) => {
    const grade = gradeFor(row)
    const name = row.name ?? 'Unknown card'
    const classes = ['pick-row', index === 0 ? 'top-pick' : '', row.name ? '' : 'unknown-card']
      .filter(Boolean)
      .join(' ')

    return `
      <div class="${classes}" data-grpid="${row.grpId}" role="row">
        <span class="pick-rank" role="cell">${index + 1}</span>
        <span class="pick-card" role="cell">
          ${cardArtHtml(row)}
          <span class="pick-mana">${renderManaCost(row.manaCost)}</span>
          <span class="pick-name ${rarityClass(row.rarity)}">${escapeHtml(name)}</span>
        </span>
        <span class="pick-grade ${grade ? modelGradeClass(grade.grade) : ''}" role="cell"${grade ? ` title="${modelGradeTitle(grade)}"` : ''}>${grade?.grade ?? '—'}</span>
        <span class="pick-gih" role="cell">${formatWinRate(row.gihWr)}</span>
        <span class="pick-alsa" role="cell">${row.alsa !== null && Number.isFinite(row.alsa) ? row.alsa.toFixed(1) : '—'}</span>
      </div>
    `
  }).join('')

  packTable.setAttribute('role', 'table')
  packTable.setAttribute('aria-label', 'Ranked cards in this pack')
  packTable.innerHTML = header + body

  // FLIP: play each surviving row from its old position to its new one
  if (before.size > 0) {
    packTable.querySelectorAll<HTMLElement>('[data-grpid]').forEach(el => {
      const old = before.get(el.dataset.grpid!)
      if (old === undefined) {
        el.classList.add('row-enter')
        return
      }
      // Rect deltas are zoomed viewport px; the transform renders x zoom
      const delta = (old - el.getBoundingClientRect().top) / effectiveZoom()
      if (delta !== 0) {
        el.style.transition = 'none'
        el.style.transform = `translateY(${delta}px)`
        void el.offsetWidth // reflow so the transform lands before animating
        el.style.transition = 'transform 140ms ease-out'
        el.style.transform = ''
        window.setTimeout(() => {
          el.style.transition = ''
        }, 180)
      }
    })
  }
}

const POOL_COLORS = ['W', 'U', 'B', 'R', 'G'] as const
const POOL_COLOR_NAMES: Readonly<Record<(typeof POOL_COLORS)[number], string>> = {
  W: 'White',
  U: 'Blue',
  B: 'Black',
  R: 'Red',
  G: 'Green'
}

function poolColorCounts(): { counts: Record<string, number>; nonLands: DraftCardRow[] } {
  const nonLands = pool.filter(row => !(row.type || '').toLowerCase().includes('land'))
  const counts: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 }
  for (const row of nonLands) {
    for (const c of row.colors || '') {
      if (c in counts) counts[c]++
    }
  }
  return { counts, nonLands }
}

/**
 * Compact verdict pool summary: canonical color pips plus exact counts.
 * Multicolor cards contribute to each of their colors.
 */
function poolStripHtml(): string {
  const { counts } = poolColorCounts()
  const label = `Pool: ${picksCount} of ${TOTAL_PICKS} picks; ${POOL_COLORS
    .map(color => `${POOL_COLOR_NAMES[color]} ${counts[color]}`)
    .join(', ')}`
  const colors = POOL_COLORS.map(color => `
    <span class="pool-summary-color" title="${POOL_COLOR_NAMES[color]}: ${counts[color]}">
      ${renderManaSymbol(color, { decorative: true })}
      <span class="pool-summary-count">${counts[color]}</span>
    </span>
  `).join('')

  return `
    <div class="pool-summary" role="group" aria-label="${label}">
      <span class="pool-summary-title">Pool</span>
      <div class="pool-summary-colors">${colors}</div>
      <span class="pool-summary-progress">${picksCount}/${TOTAL_PICKS}</span>
    </div>
  `
}

/** Full-density pool block: color rows (pip + neutral bar + count) and curve. */
function renderPool(): void {
  const { counts, nonLands } = poolColorCounts()

  // Mana curve 1-7+
  const curve = [0, 0, 0, 0, 0, 0, 0] // bins for 1..6, 7+
  for (const row of nonLands) {
    if (row.manaValue === null) continue
    const bin = Math.min(Math.max(Math.round(row.manaValue), 1), 7) - 1
    curve[bin]++
  }
  const maxCurve = Math.max(1, ...curve)

  const colorBars = POOL_COLORS.map(color => `
    <span class="pool-color" role="img" aria-label="${POOL_COLOR_NAMES[color]}: ${counts[color]} cards" title="${POOL_COLOR_NAMES[color]}: ${counts[color]} cards">
      ${renderManaSymbol(color, { decorative: true })}
      <span class="pool-color-count" aria-hidden="true">${counts[color]}</span>
    </span>
  `).join('')

  const curveBars = curve.map((count, index) => `
    <div class="curve-col">
      <div class="curve-bar" style="height: ${(count / maxCurve) * 100}%"></div>
      <span class="curve-label">${index === 6 ? '7+' : index + 1}</span>
    </div>
  `).join('')

  poolStrip.innerHTML = `
    <div class="pool-header">
      <span class="pool-title">Pool</span>
      <span class="pool-count">${picksCount || pool.length}/${TOTAL_PICKS} picks</span>
    </div>
    <div class="pool-body">
      <div class="pool-colors" aria-label="Pool colors">${colorBars}</div>
      <div class="pool-curve">${curveBars}</div>
    </div>
  `

  // Keep the verdict strip in step (pool changes arrive on pick events)
  const verdictPool = document.getElementById('verdictPool')
  if (verdictPool) verdictPool.innerHTML = poolStripHtml()
  scheduleHeightSync()
}

function renderHistory(): void {
  historyCount.textContent = String(history.length)

  if (!historyExpanded) {
    historyList.innerHTML = ''
    historyList.style.display = 'none'
    return
  }

  historyList.style.display = 'block'
  if (history.length === 0) {
    historyList.innerHTML = '<div class="draft-empty">No picks yet</div>'
    return
  }

  historyList.innerHTML = [...history]
    .sort((a, b) => b.pack - a.pack || b.pick - a.pick)
    .map(entry => {
      const key = `${entry.pack}-${entry.pick}`
      return `
        <div class="history-entry ${expandedHistoryKeys.has(key) ? 'expanded' : ''}" data-key="${key}">
          <div class="history-line">
            <span class="history-pos">P${entry.pack}P${entry.pick}</span>
            <span class="history-name">${entry.names.map(escapeHtml).join(', ')}</span>
          </div>
          ${entry.packNames.length > 0
            ? `<div class="history-pack">${entry.packNames.map(escapeHtml).join(' · ')}</div>`
            : ''}
        </div>
      `
    })
    .join('')
}

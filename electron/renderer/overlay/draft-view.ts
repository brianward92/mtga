/**
 * Draft overlay view.
 *
 * Takes over the overlay panel between draft-start and draft-end:
 * header (set/format chip, PxPy, model chip, server status dot), pack table
 * sorted by model EV with the top pick highlighted, pool strip (color bars,
 * mana curve, pick count), collapsible pick history, and a persistent
 * 17Lands attribution footer.
 */

import { escapeHtml, renderManaCost, formatWinRate } from './shared'

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
  start: DraftStartPayload
  pack: DraftPackPayload | null
  scores: DraftScoresPayload | null
  pick: DraftPickPayload | null
  end: DraftEndPayload | null
  serverStatus: ServerStatusPayload | null
  detailedLogsEnabled: boolean | null
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let draftActive = false
let session: DraftStartPayload | null = null
let currentPack: DraftPackPayload | null = null
let currentScores: DraftScoresPayload | null = null
let pool: DraftCardRow[] = []
let history: HistoryEntry[] = []
let picksCount = 0
let serverStatus: ServerStatusPayload = { status: 'red', model: null, stale: false, fetchedAt: null }
let historyExpanded = false
/** 0 = full, 1 = mini (top-3), 2 = header-only */
let miniState = 0
let endTimer: number | null = null

// DOM elements
const overlay = document.getElementById('overlay')!
const overlayContent = document.getElementById('overlayContent')!
const overlayFooter = document.querySelector('.overlay-footer') as HTMLElement
const draftView = document.getElementById('draftView')!
const draftEventChip = document.getElementById('draftEventChip')!
const draftPickPos = document.getElementById('draftPickPos')!
const draftModelChip = document.getElementById('draftModelChip')!
const serverDot = document.getElementById('serverDot')!
const draftNote = document.getElementById('draftNote')!
const packTable = document.getElementById('packTable')!
const poolStrip = document.getElementById('poolStrip')!
const historyToggle = document.getElementById('historyToggle')!
const historyCount = document.getElementById('historyCount')!
const historyList = document.getElementById('historyList')!
const logWarning = document.getElementById('logWarning')!
const matchStatus = document.getElementById('matchStatus')!

// ---------------------------------------------------------------------------
// Public API (used by overlay.ts)
// ---------------------------------------------------------------------------

export function isDraftActive(): boolean {
  return draftActive
}

/** Cycle the minimize states in draft mode: full -> top-3 mini -> header-only. */
export function cycleDraftMini(): void {
  miniState = (miniState + 1) % 3
  applyMiniState()
}

export function initDraftView(): void {
  if (!window.mtgaTracker) return

  historyToggle.addEventListener('click', () => {
    historyExpanded = !historyExpanded
    historyToggle.setAttribute('aria-expanded', String(historyExpanded))
    renderHistory()
  })

  window.mtgaTracker.onDraftStart((data: unknown) => {
    handleDraftStart(data as DraftStartPayload)
  })

  window.mtgaTracker.onDraftPack((data: unknown) => {
    handleDraftPack(data as DraftPackPayload)
  })

  window.mtgaTracker.onDraftScores((data: unknown) => {
    handleDraftScores(data as DraftScoresPayload)
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
    if (!state.active) return

    handleDraftStart(state.start)
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
  pool = []
  history = []
  picksCount = data.picksCount ?? 0
  miniState = 0
  if (endTimer !== null) {
    window.clearTimeout(endTimer)
    endTimer = null
  }

  enterDraftMode()
  renderHeader()
  renderServerStatus()
  packTable.innerHTML = '<div class="draft-empty">Waiting for pack…</div>'
  draftNote.style.display = 'none'
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
  renderPack()
}

function handleDraftScores(data: DraftScoresPayload): void {
  if (!currentPack || currentPack.isTierList) return
  if (data.pack !== currentPack.pack || data.pick !== currentPack.pick) return
  currentScores = data
  renderHeader()
  renderPack()
}

function handleDraftPick(data: DraftPickPayload): void {
  applyPickPayload(data)

  // Flash the row the human actually took (agreement feedback)
  if (
    currentPack &&
    !currentPack.isTierList &&
    data.pack === currentPack.pack &&
    data.pick === currentPack.pick
  ) {
    for (const grpId of data.grpIds) {
      const row = packTable.querySelector(`[data-grpid="${grpId}"]`)
      if (row) {
        row.classList.add('picked-flash')
        window.setTimeout(() => row.classList.remove('picked-flash'), 1600)
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

  renderHeader()
  renderPool()
  renderHistory()
  draftNote.style.display = 'none'
  packTable.innerHTML = `
    <div class="draft-complete">
      <div class="draft-complete-title">Draft complete</div>
      <div class="draft-complete-sub">${pool.length} cards drafted</div>
    </div>
  `

  // Show the final pool for 10s, then hand the panel back to the match view
  if (endTimer !== null) window.clearTimeout(endTimer)
  endTimer = window.setTimeout(() => {
    exitDraftMode()
    endTimer = null
  }, 10_000)
}

// ---------------------------------------------------------------------------
// Mode / layout
// ---------------------------------------------------------------------------

function enterDraftMode(): void {
  draftActive = true
  overlay.classList.add('draft-mode')
  draftView.style.display = 'flex'
  overlayContent.style.display = 'none'
  if (overlayFooter) overlayFooter.style.display = 'none'
  matchStatus.textContent = 'Drafting'
  matchStatus.className = 'status in-match'
  applyMiniState()
}

function exitDraftMode(): void {
  draftActive = false
  miniState = 0
  overlay.classList.remove('draft-mode', 'draft-mini', 'draft-header-only')
  draftView.style.display = 'none'
  overlayContent.style.display = ''
  if (overlayFooter) overlayFooter.style.display = ''
  matchStatus.textContent = 'Waiting for match...'
  matchStatus.className = 'status'
}

function applyMiniState(): void {
  overlay.classList.toggle('draft-mini', miniState === 1)
  overlay.classList.toggle('draft-header-only', miniState === 2)
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

  const model = currentScores?.model ?? serverStatus.model
  if (model) {
    const fallback = model.fallback ? ' · fallback' : ''
    draftModelChip.textContent = `${model.id}${fallback}`
    draftModelChip.style.display = 'inline-flex'
  } else {
    draftModelChip.style.display = 'none'
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

function rarityClass(rarity: string | null): string {
  switch ((rarity ?? '').toLowerCase()) {
    case 'mythic': return 'rarity-mythic'
    case 'rare': return 'rarity-rare'
    case 'uncommon': return 'rarity-uncommon'
    default: return 'rarity-common'
  }
}

function formatEv(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—'
  return Math.abs(value) < 10 ? value.toFixed(2) : value.toFixed(1)
}

function renderPack(): void {
  if (!currentPack) return

  const scored = currentScores?.cards ?? null
  const rows = sortRows(scored && scored.length > 0 ? scored : currentPack.cards)

  if (currentPack.isTierList && currentPack.note) {
    draftNote.textContent = currentPack.note
    draftNote.style.display = 'block'
  } else {
    draftNote.style.display = 'none'
  }

  if (rows.length === 0) {
    packTable.innerHTML = '<div class="draft-empty">No cards in pack</div>'
    return
  }

  // Normalize the metric to a 0-100 bar within this pack
  const metrics = rows
    .map(row => sortMetric(row, rows))
    .filter((v): v is number => v !== null && Number.isFinite(v))
  const min = metrics.length > 0 ? Math.min(...metrics) : 0
  const max = metrics.length > 0 ? Math.max(...metrics) : 1
  const span = max - min

  const header = `
    <div class="pick-row pick-row-header">
      <span class="pick-rank">#</span>
      <span class="pick-card">Card</span>
      <span class="pick-ev">EV</span>
      <span class="pick-gih">GIH</span>
      <span class="pick-alsa">ALSA</span>
    </div>
  `

  const body = rows.map((row, index) => {
    const metric = sortMetric(row, rows)
    const barPct = metric === null ? 0 : span > 0 ? ((metric - min) / span) * 100 : 100
    const evShown = row.ev ?? row.evP1p1
    const name = row.name ?? 'Unknown card'
    const classes = ['pick-row', index === 0 ? 'top-pick' : '', row.name ? '' : 'unknown-card']
      .filter(Boolean)
      .join(' ')

    return `
      <div class="${classes}" data-grpid="${row.grpId}">
        <span class="pick-rank">${index + 1}</span>
        <span class="pick-card">
          <span class="pick-mana">${renderManaCost(row.manaCost)}</span>
          <span class="pick-name ${rarityClass(row.rarity)}">${escapeHtml(name)}</span>
        </span>
        <span class="pick-ev">
          <span class="ev-bar" style="width: ${barPct.toFixed(0)}%"></span>
          <span class="ev-val">${formatEv(evShown)}</span>
        </span>
        <span class="pick-gih">${formatWinRate(row.gihWr)}</span>
        <span class="pick-alsa">${row.alsa !== null && Number.isFinite(row.alsa) ? row.alsa.toFixed(1) : '—'}</span>
      </div>
    `
  }).join('')

  packTable.innerHTML = header + body
}

const POOL_COLORS = ['W', 'U', 'B', 'R', 'G'] as const

function renderPool(): void {
  const nonLands = pool.filter(row => !(row.type || '').toLowerCase().includes('land'))

  // Color commitment (multicolor cards count once per color)
  const colorCounts: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 }
  for (const row of nonLands) {
    for (const c of row.colors || '') {
      if (c in colorCounts) colorCounts[c]++
    }
  }
  const maxColor = Math.max(1, ...Object.values(colorCounts))

  // Mana curve 1-7+
  const curve = [0, 0, 0, 0, 0, 0, 0] // bins for 1..6, 7+
  for (const row of nonLands) {
    if (row.manaValue === null) continue
    const bin = Math.min(Math.max(Math.round(row.manaValue), 1), 7) - 1
    curve[bin]++
  }
  const maxCurve = Math.max(1, ...curve)

  const colorBars = POOL_COLORS.map(color => `
    <div class="pool-color">
      <span class="mana-symbol ${color}"></span>
      <div class="pool-color-track">
        <div class="pool-color-fill mana-fill-${color}" style="width: ${(colorCounts[color] / maxColor) * 100}%"></div>
      </div>
      <span class="pool-color-count">${colorCounts[color]}</span>
    </div>
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
      <span class="pool-count">${picksCount || pool.length} picks</span>
    </div>
    <div class="pool-body">
      <div class="pool-colors">${colorBars}</div>
      <div class="pool-curve">${curveBars}</div>
    </div>
  `
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
    .map((entry, index) => `
      <div class="history-entry" data-index="${index}">
        <div class="history-line">
          <span class="history-pos">P${entry.pack}P${entry.pick}</span>
          <span class="history-name">${entry.names.map(escapeHtml).join(', ')}</span>
        </div>
        ${entry.packNames.length > 0
          ? `<div class="history-pack">${entry.packNames.map(escapeHtml).join(' · ')}</div>`
          : ''}
      </div>
    `)
    .join('')

  // Tap a pick to expand its pack context
  historyList.querySelectorAll('.history-entry').forEach(el => {
    el.addEventListener('click', () => el.classList.toggle('expanded'))
  })
}

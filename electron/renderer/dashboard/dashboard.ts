/**
 * MTGA Tracker Dashboard
 * Main dashboard for viewing match history, stats, and inventory
 */

// Export to make this a proper ES module (avoids duplicate function errors in TS)
export {}

interface Match {
  id: string
  eventId: string
  format: string
  deckId: string | null
  deckName: string | null
  opponentName: string
  result: 'win' | 'loss' | 'draw'
  gameCount: number
  startedAt: string
  endedAt: string | null
  onPlay: boolean
  notes?: string
}

interface MatchStats {
  wins: number
  losses: number
  draws: number
  winRate: number
}

interface InventoryData {
  gems: number
  gold: number
  wcCommon: number
  wcUncommon: number
  wcRare: number
  wcMythic: number
  vaultProgress: number
  draftTokens?: number
  sealedTokens?: number
  boosters?: Array<{ count: number; name: string }>
}

interface DeckStats {
  name: string
  wins: number
  losses: number
  matches: number
  winRate: number
  archetype?: string
}

// DOM elements
const sections = document.querySelectorAll<HTMLElement>('.section')
const navItems = document.querySelectorAll<HTMLElement>('.nav-item')

// Stats elements
const totalWinsEl = document.getElementById('totalWins')!
const totalLossesEl = document.getElementById('totalLosses')!
const winRateEl = document.getElementById('winRate')!
const totalMatchesEl = document.getElementById('totalMatches')!

// Match lists
const recentMatchList = document.getElementById('recentMatchList')!
const fullMatchList = document.getElementById('fullMatchList')!

// Deck list
const deckList = document.getElementById('deckList')!

// Inventory elements
const gemsEl = document.getElementById('gems')!
const goldEl = document.getElementById('gold')!
const wcMythicEl = document.getElementById('wcMythic')!
const wcRareEl = document.getElementById('wcRare')!
const wcUncommonEl = document.getElementById('wcUncommon')!
const wcCommonEl = document.getElementById('wcCommon')!
const vaultProgressEl = document.getElementById('vaultProgress')!
const vaultLabelEl = document.getElementById('vaultLabel')!
const draftTokensEl = document.getElementById('draftTokens')!
const sealedTokensEl = document.getElementById('sealedTokens')!
const boostersContainer = document.getElementById('boostersContainer')!

// Collection elements
const collectionUniqueEl = document.getElementById('collectionUnique')!
const collectionTotalEl = document.getElementById('collectionTotal')!
const collectionSetFilter = document.getElementById('collectionSetFilter') as HTMLSelectElement
const collectionGrid = document.getElementById('collectionGrid')!

// Opponent elements
const opponentList = document.getElementById('opponentList')!

// Deck chart
const deckChartBars = document.getElementById('deckChartBars')!

// Deck import
const deckImportText = document.getElementById('deckImportText') as HTMLTextAreaElement
const deckImportBtn = document.getElementById('deckImportBtn')!
const deckImportClear = document.getElementById('deckImportClear')!

// Filters
const formatFilter = document.getElementById('formatFilter') as HTMLSelectElement
const resultFilter = document.getElementById('resultFilter') as HTMLSelectElement
const deckSearch = document.getElementById('deckSearch') as HTMLInputElement
const dateFrom = document.getElementById('dateFrom') as HTMLInputElement
const dateTo = document.getElementById('dateTo') as HTMLInputElement

// Export buttons
const exportCsvBtn = document.getElementById('exportCsvBtn')!
const exportJsonBtn = document.getElementById('exportJsonBtn')!

// View All button
const viewAllBtn = document.getElementById('viewAllMatches')!

// State
let allMatches: Match[] = []
let currentInventory: InventoryData | null = null
let collectionData: Record<number, number> = {}
let allSets: string[] = []
let currentSelectedSet: string = ''
let currentEditingMatch: Match | null = null
let deckArchetypes: Record<string, string> = {}  // deckName -> archetype

// Load deck archetypes from localStorage
function loadDeckArchetypes(): void {
  const saved = localStorage.getItem('mtga_deck_archetypes')
  if (saved) {
    deckArchetypes = JSON.parse(saved)
  }
}

function saveDeckArchetypes(): void {
  localStorage.setItem('mtga_deck_archetypes', JSON.stringify(deckArchetypes))
}

// Modal elements
const notesModal = document.getElementById('notesModal')!
const notesModalClose = document.getElementById('notesModalClose')!
const notesCancel = document.getElementById('notesCancel')!
const notesSave = document.getElementById('notesSave')!
const notesInput = document.getElementById('notesInput') as HTMLTextAreaElement
const notesMatchInfo = document.getElementById('notesMatchInfo')!

const helpModal = document.getElementById('helpModal')!
const helpBtn = document.getElementById('helpBtn')!
const helpModalClose = document.getElementById('helpModalClose')!

/**
 * Initialize the dashboard
 */
async function init(): Promise<void> {
  loadDeckArchetypes()
  setupNavigation()
  setupFilters()
  setupEventListeners()
  await loadData()
  await loadCollectionData()
  await loadOpponentStats()
}

/**
 * Setup navigation between sections
 */
function setupNavigation(): void {
  navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault()
      const section = item.dataset.section
      if (!section) return

      // Update nav
      navItems.forEach(nav => nav.classList.remove('active'))
      item.classList.add('active')

      // Show section
      sections.forEach(sec => sec.classList.remove('active'))
      document.getElementById(section)?.classList.add('active')
    })
  })

  viewAllBtn.addEventListener('click', () => {
    // Switch to matches section
    navItems.forEach(nav => {
      nav.classList.toggle('active', nav.dataset.section === 'matches')
    })
    sections.forEach(sec => {
      sec.classList.toggle('active', sec.id === 'matches')
    })
  })

  // Setup keyboard shortcuts
  setupDashboardKeyboardShortcuts()
}

/**
 * Setup keyboard shortcuts for dashboard
 */
function setupDashboardKeyboardShortcuts(): void {
  document.addEventListener('keydown', (e) => {
    // Ctrl/Cmd + K: Focus deck search
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault()
      deckSearch.focus()
    }

    // Ctrl/Cmd + R: Reload data
    if ((e.ctrlKey || e.metaKey) && e.key === 'r') {
      e.preventDefault()
      loadData()
      loadOpponentStats()
    }

    // Number keys for nav: 1=Overview, 2=Matches, 3=Decks, 4=Inventory, 5=Collection, 6=Opponents
    const navMap: Record<string, number> = { '1': 0, '2': 1, '3': 2, '4': 3, '5': 4, '6': 5 }
    if (e.key in navMap && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      const navItem = navItems[navMap[e.key]]
      if (navItem) {
        navItem.click()
      }
    }
  })
}

/**
 * Setup filter listeners
 */
function setupFilters(): void {
  formatFilter.addEventListener('change', () => renderFullMatchList())
  resultFilter.addEventListener('change', () => renderFullMatchList())
  deckSearch.addEventListener('input', () => renderFullMatchList())
  dateFrom.addEventListener('change', () => renderFullMatchList())
  dateTo.addEventListener('change', () => renderFullMatchList())
  collectionSetFilter.addEventListener('change', () => renderCollectionCards())
  exportCsvBtn.addEventListener('click', exportMatchesAsCSV)
  exportJsonBtn.addEventListener('click', exportMatchesAsJSON)
  deckImportBtn.addEventListener('click', handleDeckImportExport)
  deckImportClear.addEventListener('click', () => {
    deckImportText.value = ''
  })
}

/**
 * Setup real-time event listeners
 */
function setupEventListeners(): void {
  if (!window.mtgaTracker) {
    console.error('[Dashboard] mtgaTracker API not available')
    return
  }

  // Match events
  window.mtgaTracker.onMatchEnd(async () => {
    // Reload data when match ends
    await loadData()
  })

  // Inventory updates
  window.mtgaTracker.onInventoryUpdate((data: unknown) => {
    currentInventory = data as InventoryData
    renderInventory()
  })

  // Modal event listeners
  notesModalClose.addEventListener('click', closeNotesModal)
  notesCancel.addEventListener('click', closeNotesModal)
  notesSave.addEventListener('click', saveNotes)
  notesModal.addEventListener('click', (e) => {
    if (e.target === notesModal) closeNotesModal()
  })

  // Help modal
  helpBtn.addEventListener('click', () => helpModal.classList.add('visible'))
  helpModalClose.addEventListener('click', () => helpModal.classList.remove('visible'))
  helpModal.addEventListener('click', (e) => {
    if (e.target === helpModal) helpModal.classList.remove('visible')
  })

  // Keyboard shortcut for help
  document.addEventListener('keydown', (e) => {
    if (e.key === '?' || (e.shiftKey && e.key === '/')) {
      e.preventDefault()
      helpModal.classList.add('visible')
    }
    if (e.key === 'Escape') {
      helpModal.classList.remove('visible')
      closeNotesModal()
    }
  })

  // Delegate click handlers for match rows
  document.addEventListener('click', (e) => {
    const matchRow = (e.target as HTMLElement).closest('[data-match-id]')
    if (matchRow) {
      const matchId = matchRow.getAttribute('data-match-id')
      if (matchId) {
        const match = allMatches.find(m => m.id === matchId)
        if (match) openNotesModal(match)
      }
    }
  })
}

/**
 * Load all data
 */
async function loadData(): Promise<void> {
  if (!window.mtgaTracker) return

  try {
    // Load match history
    const matches = await window.mtgaTracker.getMatchHistory(100) as Match[]
    allMatches = matches

    // Load stats
    const stats = await window.mtgaTracker.getMatchStats() as MatchStats
    const playDrawStats = await window.mtgaTracker.getPlayDrawStats() as any
    const formatStats = await window.mtgaTracker.getStatsByFormat() as any

    // Render
    renderStats(stats)
    renderPlayDrawStats(playDrawStats)
    renderFormatStats(formatStats)
    renderWinRateTrend(matches)
    renderRecentMatches(matches.slice(0, 5))
    renderFullMatchList()
    renderDeckStats(matches)
  } catch (error) {
    console.error('[Dashboard] Failed to load data:', error)
  }
}

/**
 * Render overall stats
 */
function renderStats(stats: MatchStats): void {
  totalWinsEl.textContent = String(stats.wins)
  totalLossesEl.textContent = String(stats.losses)
  winRateEl.textContent = `${stats.winRate.toFixed(1)}%`
  totalMatchesEl.textContent = String(stats.wins + stats.losses + stats.draws)

  // Render session stats
  renderSessionStats(allMatches)
}

/**
 * Render session statistics
 */
function renderSessionStats(matches: Match[]): void {
  const sessionContainer = document.getElementById('sessionStatsContainer')!
  if (!matches || matches.length === 0) return

  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const weekStart = new Date(now)
  weekStart.setDate(now.getDate() - now.getDay())

  const todayMatches = matches.filter(m => new Date(m.startedAt) >= today)
  const weekMatches = matches.filter(m => new Date(m.startedAt) >= weekStart)

  const todayWins = todayMatches.filter(m => m.result === 'win').length
  const weekWins = weekMatches.filter(m => m.result === 'win').length
  const todayTotal = todayMatches.filter(m => m.result !== 'draw').length
  const weekTotal = weekMatches.filter(m => m.result !== 'draw').length

  const todayRate = todayTotal > 0 ? ((todayWins / todayTotal) * 100).toFixed(1) : 'N/A'
  const weekRate = weekTotal > 0 ? ((weekWins / weekTotal) * 100).toFixed(1) : 'N/A'

  const html = `
    <div class="session-stats-row">
      <div class="session-stat">
        <span class="session-stat-label">Today</span>
        <span class="session-stat-value">${todayWins}/${todayTotal}</span>
        <span class="session-stat-rate">${todayRate}%</span>
      </div>
      <div class="session-stat">
        <span class="session-stat-label">This Week</span>
        <span class="session-stat-value">${weekWins}/${weekTotal}</span>
        <span class="session-stat-rate">${weekRate}%</span>
      </div>
      <div class="session-stat">
        <span class="session-stat-label">Last Updated</span>
        <span class="session-stat-value" style="font-size: 11px; font-variant-numeric: tabular-nums;">${new Date().toLocaleTimeString()}</span>
      </div>
    </div>
  `

  sessionContainer.innerHTML = html
}

/**
 * Render play/draw statistics
 */
function renderPlayDrawStats(stats: any): void {
  const container = document.getElementById('playDrawStatsContainer')
  if (!container) return

  const onPlay = stats.onPlay || { wins: 0, losses: 0, winRate: 0 }
  const onDraw = stats.onDraw || { wins: 0, losses: 0, winRate: 0 }

  const onPlayTotal = onPlay.wins + onPlay.losses
  const onDrawTotal = onDraw.wins + onDraw.losses

  const html = `
    <div class="stats-row">
      <div class="stat-mini">
        <span class="stat-mini-label">On Play</span>
        <span class="stat-mini-value">${onPlay.wins}/${onPlayTotal}</span>
        <span class="stat-mini-rate ${onPlay.winRate >= 55 ? 'positive' : onPlay.winRate <= 45 ? 'negative' : 'neutral'}">${onPlay.winRate.toFixed(1)}%</span>
      </div>
      <div class="stat-mini">
        <span class="stat-mini-label">On Draw</span>
        <span class="stat-mini-value">${onDraw.wins}/${onDrawTotal}</span>
        <span class="stat-mini-rate ${onDraw.winRate >= 55 ? 'positive' : onDraw.winRate <= 45 ? 'negative' : 'neutral'}">${onDraw.winRate.toFixed(1)}%</span>
      </div>
    </div>
  `
  container.innerHTML = html
}

/**
 * Render format statistics
 */
function renderFormatStats(formats: any[]): void {
  const container = document.getElementById('formatStatsContainer')
  if (!container) return

  if (!formats || formats.length === 0) {
    container.innerHTML = '<div class="empty-state"><p>No format data yet</p></div>'
    return
  }

  const html = formats.map(format => `
    <div class="format-stat-row">
      <span class="format-name">${escapeHtml(formatFormatName(format.format))}</span>
      <span class="format-record">${format.wins}W-${format.losses}L</span>
      <span class="format-rate ${format.winRate >= 55 ? 'positive' : format.winRate <= 45 ? 'negative' : 'neutral'}">${format.winRate.toFixed(1)}%</span>
      <span class="format-total">${format.total} matches</span>
    </div>
  `).join('')

  container.innerHTML = html
}

/**
 * Render recent matches (overview)
 */
function renderRecentMatches(matches: Match[]): void {
  if (matches.length === 0) {
    recentMatchList.innerHTML = `
      <div class="empty-state">
        <p>No matches recorded yet</p>
        <p class="hint">Play a match in MTGA to see it here</p>
      </div>
    `
    return
  }

  recentMatchList.innerHTML = matches.map(renderMatchRow).join('')
}

/**
 * Render full match list with filters
 */
function renderFullMatchList(): void {
  let filtered = [...allMatches]

  // Apply format filter
  const format = formatFilter.value
  if (format) {
    filtered = filtered.filter(m =>
      m.format.toLowerCase().includes(format.toLowerCase()) ||
      m.eventId.toLowerCase().includes(format.toLowerCase())
    )
  }

  // Apply result filter
  const result = resultFilter.value
  if (result) {
    filtered = filtered.filter(m => m.result === result)
  }

  if (filtered.length === 0) {
    fullMatchList.innerHTML = `
      <div class="empty-state">
        <p>No matches found</p>
      </div>
    `
    return
  }

  fullMatchList.innerHTML = filtered.map(renderMatchRow).join('')
}

/**
 * Render a single match row
 */
function renderMatchRow(match: Match): string {
  const date = new Date(match.startedAt)
  const timeAgo = formatTimeAgo(date)
  const deckName = match.deckName || 'Unknown Deck'
  const opponent = match.opponentName || 'Unknown'
  const format = formatFormatName(match.format || match.eventId)
  const hasNotes = match.notes && match.notes.trim().length > 0

  return `
    <div class="match-row" data-match-id="${match.id}" role="button" tabindex="0">
      <span class="match-result ${match.result}">${match.result}</span>
      <span class="match-deck">${escapeHtml(deckName)}</span>
      <span class="match-opponent">vs ${escapeHtml(opponent)}</span>
      <span class="match-format">${format}</span>
      <span class="match-time">${timeAgo}</span>
      ${hasNotes ? `<span class="match-notes-indicator" title="This match has notes">📝</span>` : ''}
    </div>
  `
}

/**
 * Render deck statistics
 */
function renderDeckStats(matches: Match[]): void {
  // Group by deck
  const deckMap = new Map<string, DeckStats>()

  for (const match of matches) {
    const name = match.deckName || 'Unknown Deck'

    if (!deckMap.has(name)) {
      deckMap.set(name, { name, wins: 0, losses: 0, matches: 0, winRate: 0 })
    }

    const deck = deckMap.get(name)!
    deck.matches++
    if (match.result === 'win') deck.wins++
    if (match.result === 'loss') deck.losses++
  }

  // Calculate win rates
  const decks = Array.from(deckMap.values()).map(deck => {
    const total = deck.wins + deck.losses
    deck.winRate = total > 0 ? (deck.wins / total) * 100 : 0
    return deck
  })

  // Sort by matches
  decks.sort((a, b) => b.matches - a.matches)

  if (decks.length === 0) {
    deckChartBars.innerHTML = `
      <div class="empty-state">
        <p>No deck data yet</p>
      </div>
    `
    deckList.innerHTML = `
      <div class="empty-state">
        <p>No deck data yet</p>
        <p class="hint">Play matches to see deck statistics</p>
      </div>
    `
    return
  }

  // Render win rate chart
  const maxWinRate = Math.max(...decks.map(d => d.winRate), 100)
  const chartHtml = decks.slice(0, 10).map(deck => {
    const percentage = (deck.winRate / maxWinRate) * 100
    const color = deck.winRate >= 55 ? '#3dd68c' : deck.winRate <= 45 ? '#f04848' : '#a0a0b0'

    return `
      <div class="deck-chart-bar">
        <div class="deck-chart-label">${escapeHtml(deck.name)}</div>
        <div class="deck-chart-container">
          <div class="deck-chart-bar-fill" style="width: ${percentage}%; background: ${color};"></div>
          <div class="deck-chart-value">${deck.winRate.toFixed(0)}%</div>
        </div>
      </div>
    `
  }).join('')

  deckChartBars.innerHTML = chartHtml

  // Render detailed table
  deckList.innerHTML = decks.map((deck, idx) => {
    const winRateClass = deck.winRate >= 55 ? 'positive' : deck.winRate <= 45 ? 'negative' : 'neutral'
    const archetype = deckArchetypes[deck.name] || ''
    const archetypeColor = getArchetypeColor(archetype)

    return `
      <div class="deck-row" data-deck-name="${escapeHtml(deck.name)}">
        <div style="flex: 1;">
          <div style="font-weight: 600; color: var(--text-primary);">${escapeHtml(deck.name)}</div>
          <div style="font-size: 11px; margin-top: 4px; display: flex; gap: 4px;">
            <select class="archetype-select" data-deck-idx="${idx}" style="padding: 2px 6px; font-size: 11px; background: ${archetypeColor}; color: white; border: none; border-radius: 3px;">
              <option value="">Untagged</option>
              <option value="Aggro" ${archetype === 'Aggro' ? 'selected' : ''}>Aggro</option>
              <option value="Midrange" ${archetype === 'Midrange' ? 'selected' : ''}>Midrange</option>
              <option value="Control" ${archetype === 'Control' ? 'selected' : ''}>Control</option>
              <option value="Combo" ${archetype === 'Combo' ? 'selected' : ''}>Combo</option>
              <option value="Tempo" ${archetype === 'Tempo' ? 'selected' : ''}>Tempo</option>
              <option value="Ramp" ${archetype === 'Ramp' ? 'selected' : ''}>Ramp</option>
            </select>
          </div>
        </div>
        <div class="deck-stat">
          <span class="deck-stat-value">${deck.wins}</span>
          <span class="deck-stat-label">Wins</span>
        </div>
        <div class="deck-stat">
          <span class="deck-stat-value">${deck.losses}</span>
          <span class="deck-stat-label">Losses</span>
        </div>
        <div class="deck-stat">
          <span class="deck-stat-value">${deck.matches}</span>
          <span class="deck-stat-label">Matches</span>
        </div>
        <div class="deck-winrate">
          <span class="deck-winrate-value ${winRateClass}">${deck.winRate.toFixed(1)}%</span>
        </div>
      </div>
    `
  }).join('')

  // Setup archetype selectors
  const archetypeSelects = deckList.querySelectorAll('.archetype-select')
  archetypeSelects.forEach((select: Element) => {
    (select as HTMLSelectElement).addEventListener('change', (e) => {
      const selectEl = e.target as HTMLSelectElement
      const rowEl = selectEl.closest('[data-deck-name]') as HTMLElement
      const deckName = rowEl?.dataset.deckName

      if (deckName) {
        const archetype = selectEl.value
        if (archetype) {
          deckArchetypes[deckName] = archetype
        } else {
          delete deckArchetypes[deckName]
        }
        saveDeckArchetypes()
        selectEl.style.background = getArchetypeColor(archetype)
      }
    })
  })
}

/**
 * Get color for archetype
 */
function getArchetypeColor(archetype: string): string {
  const colors: Record<string, string> = {
    'Aggro': '#f04848',
    'Midrange': '#ffc857',
    'Control': '#5090ff',
    'Combo': '#a855f7',
    'Tempo': '#ec4899',
    'Ramp': '#3dd68c'
  }
  return colors[archetype] || '#606070'
}

/**
 * Render inventory data
 */
function renderInventory(): void {
  if (!currentInventory) return

  gemsEl.textContent = currentInventory.gems.toLocaleString()
  goldEl.textContent = currentInventory.gold.toLocaleString()
  wcMythicEl.textContent = String(currentInventory.wcMythic)
  wcRareEl.textContent = String(currentInventory.wcRare)
  wcUncommonEl.textContent = String(currentInventory.wcUncommon)
  wcCommonEl.textContent = String(currentInventory.wcCommon)

  const vaultPercent = Math.min(currentInventory.vaultProgress, 100)
  vaultProgressEl.style.width = `${vaultPercent}%`
  vaultLabelEl.textContent = `${vaultPercent.toFixed(1)}%`

  // Render tokens
  draftTokensEl.textContent = String(currentInventory.draftTokens || 0)
  sealedTokensEl.textContent = String(currentInventory.sealedTokens || 0)

  // Render boosters
  if (currentInventory.boosters && currentInventory.boosters.length > 0) {
    const boosterHtml = currentInventory.boosters.map(booster => `
      <div class="booster-item">
        <span class="booster-count">${booster.count}</span>
        <span class="booster-name">${escapeHtml(booster.name)}</span>
      </div>
    `).join('')
    boostersContainer.innerHTML = boosterHtml
  } else {
    boostersContainer.innerHTML = '<div class="booster-item empty"><span class="booster-name">No boosters</span></div>'
  }
}

/**
 * Format time ago string
 */
function formatTimeAgo(date: Date): string {
  const now = new Date()
  const diff = now.getTime() - date.getTime()

  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 7) return `${days}d ago`

  return date.toLocaleDateString()
}

/**
 * Load collection data
 */
async function loadCollectionData(): Promise<void> {
  if (!window.mtgaTracker) return

  try {
    // Load collection
    collectionData = await window.mtgaTracker.getCollection() as Record<number, number>

    // Load stats
    const stats = await window.mtgaTracker.getCollectionStats() as any
    collectionUniqueEl.textContent = String(stats.uniqueCards || 0)
    collectionTotalEl.textContent = String(stats.totalCards || 0)

    // Load sets
    allSets = await window.mtgaTracker.getSetList() as string[]

    // Populate set filter
    allSets.forEach(set => {
      const option = document.createElement('option')
      option.value = set
      option.textContent = set || 'Unknown Set'
      collectionSetFilter.appendChild(option)
    })

    // Render initial collection
    await renderCollectionCards()
  } catch (error) {
    console.error('[Dashboard] Failed to load collection:', error)
  }
}

/**
 * Load and render opponent statistics
 */
async function loadOpponentStats(): Promise<void> {
  if (!window.mtgaTracker) return

  try {
    const opponents = await window.mtgaTracker.getOpponentStats() as any[]

    if (!opponents || opponents.length === 0) {
      opponentList.innerHTML = '<div class="empty-state"><p>No opponent data yet</p></div>'
      return
    }

    const html = opponents.map(opp => `
      <div class="opponent-row">
        <div class="opponent-name">${escapeHtml(opp.opponentName)}</div>
        <div class="opponent-record">${opp.wins}W-${opp.losses}L</div>
        <div class="opponent-rate ${opp.winRate >= 55 ? 'positive' : opp.winRate <= 45 ? 'negative' : 'neutral'}">${opp.winRate.toFixed(1)}%</div>
        <div class="opponent-matches">${opp.total} matches</div>
        <div class="opponent-last">Last: ${formatTimeAgo(new Date(opp.lastPlayed))}</div>
      </div>
    `).join('')

    opponentList.innerHTML = html
  } catch (error) {
    console.error('[Dashboard] Failed to load opponent stats:', error)
    opponentList.innerHTML = '<div class="empty-state"><p>Failed to load opponent data</p></div>'
  }
}

/**
 * Render collection cards
 */
async function renderCollectionCards(): Promise<void> {
  if (!window.mtgaTracker) return

  try {
    const selectedSet = collectionSetFilter.value
    currentSelectedSet = selectedSet

    let cards = await window.mtgaTracker.getCardsBySet(selectedSet) as any[]

    if (!cards || cards.length === 0) {
      collectionGrid.innerHTML = '<div class="empty-state"><p>No cards in this set</p></div>'
      return
    }

    const html = cards.map(item => {
      const grpId = item.grpId
      const card = item.card
      const owned = collectionData[grpId] || 0
      const imageUrl = card.imageUrl ? `data-image="${card.imageUrl}"` : ''

      return `
        <div class="collection-card" ${imageUrl}>
          <div class="collection-card-name">${escapeHtml(card.name)}</div>
          <div class="collection-card-info">
            <span class="collection-card-rarity">${card.rarity || 'common'}</span>
            <span class="collection-card-owned">${owned} owned</span>
          </div>
        </div>
      `
    }).join('')

    collectionGrid.innerHTML = html

    // Setup image hover tooltips
    setupCardImagePreviews()
  } catch (error) {
    console.error('[Dashboard] Failed to render collection:', error)
    collectionGrid.innerHTML = '<div class="empty-state"><p>Failed to load cards</p></div>'
  }
}

/**
 * Setup card image preview on hover
 */
function setupCardImagePreviews(): void {
  const cardElements = collectionGrid.querySelectorAll('[data-image]')
  let imageTooltip: HTMLDivElement | null = null

  cardElements.forEach(card => {
    card.addEventListener('mouseenter', (e) => {
      const imageUrl = (card as HTMLElement).dataset.image
      if (!imageUrl) return

      // Create tooltip
      imageTooltip = document.createElement('div')
      imageTooltip.className = 'card-image-tooltip'
      imageTooltip.innerHTML = `<img src="${imageUrl}" alt="Card preview" onerror="this.style.display='none'">`
      document.body.appendChild(imageTooltip)

      // Position it
      const rect = card.getBoundingClientRect()
      imageTooltip.style.left = (rect.right + 10) + 'px'
      imageTooltip.style.top = rect.top + 'px'

      setTimeout(() => {
        if (imageTooltip) imageTooltip.classList.add('visible')
      }, 10)
    })

    card.addEventListener('mouseleave', () => {
      if (imageTooltip) {
        imageTooltip.classList.remove('visible')
        setTimeout(() => {
          if (imageTooltip && imageTooltip.parentNode) {
            imageTooltip.parentNode.removeChild(imageTooltip)
          }
          imageTooltip = null
        }, 200)
      }
    })
  })
}

/**
 * Get filtered matches based on current filters
 */
function getFilteredMatches(): Match[] {
  let filtered = [...allMatches]

  // Apply format filter
  const format = formatFilter.value
  if (format) {
    filtered = filtered.filter(m =>
      m.format.toLowerCase().includes(format.toLowerCase()) ||
      m.eventId.toLowerCase().includes(format.toLowerCase())
    )
  }

  // Apply result filter
  const result = resultFilter.value
  if (result) {
    filtered = filtered.filter(m => m.result === result)
  }

  // Apply deck search
  const deckQuery = deckSearch.value.toLowerCase()
  if (deckQuery) {
    filtered = filtered.filter(m =>
      (m.deckName || '').toLowerCase().includes(deckQuery)
    )
  }

  // Apply date range
  if (dateFrom.value) {
    const fromDate = new Date(dateFrom.value)
    filtered = filtered.filter(m => new Date(m.startedAt) >= fromDate)
  }

  if (dateTo.value) {
    const toDate = new Date(dateTo.value)
    // Set to end of day
    toDate.setHours(23, 59, 59, 999)
    filtered = filtered.filter(m => new Date(m.startedAt) <= toDate)
  }

  return filtered
}

/**
 * Export matches as CSV
 */
function exportMatchesAsCSV(): void {
  const matches = getFilteredMatches()

  if (matches.length === 0) {
    alert('No matches to export')
    return
  }

  // CSV headers
  const headers = ['Date', 'Deck', 'Opponent', 'Format', 'Result', 'Games', 'On Play']

  // CSV rows
  const rows = matches.map(match => [
    new Date(match.startedAt).toLocaleString(),
    match.deckName || 'Unknown',
    match.opponentName,
    formatFormatName(match.format || match.eventId),
    match.result.toUpperCase(),
    String(match.gameCount),
    match.onPlay ? 'Yes' : 'No'
  ])

  // Create CSV content
  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
  ].join('\n')

  // Download
  downloadFile(`mtga-matches-${new Date().toISOString().split('T')[0]}.csv`, csvContent, 'text/csv')
}

/**
 * Export matches as JSON
 */
function exportMatchesAsJSON(): void {
  const matches = getFilteredMatches()

  if (matches.length === 0) {
    alert('No matches to export')
    return
  }

  const jsonContent = JSON.stringify(matches, null, 2)
  downloadFile(`mtga-matches-${new Date().toISOString().split('T')[0]}.json`, jsonContent, 'application/json')
}

/**
 * Trigger a file download
 */
function downloadFile(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

/**
 * Handle deck import/export
 */
function handleDeckImportExport(): void {
  const text = deckImportText.value.trim()

  if (!text) {
    alert('Please paste a deck list')
    return
  }

  // Parse the deck
  const lines = text.split('\n').filter(l => l.trim().length > 0 && !l.trim().startsWith('//'))
  const mainDeck: string[] = []
  const sideboard: string[] = []
  let inSideboard = false

  for (const line of lines) {
    if (line.trim() === '') {
      inSideboard = true
      continue
    }

    if (inSideboard) {
      sideboard.push(line.trim())
    } else {
      mainDeck.push(line.trim())
    }
  }

  // Create an export
  const deckContent = [
    ...mainDeck,
    ...(sideboard.length > 0 ? ['', ...sideboard] : [])
  ].join('\n')

  // Generate filename
  const timestamp = new Date().toISOString().split('T')[0]
  downloadFile(`mtga-deck-${timestamp}.txt`, deckContent, 'text/plain')

  alert(`✓ Deck exported! ${mainDeck.length} main deck cards + ${sideboard.length} sideboard cards`)
}

/**
 * Open notes modal for a match
 */
function openNotesModal(match: Match): void {
  currentEditingMatch = match
  const format = formatFormatName(match.format || match.eventId)
  const date = new Date(match.startedAt)

  notesMatchInfo.innerHTML = `
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; font-size: 13px;">
      <div><span style="color: var(--text-muted);">Deck:</span> ${escapeHtml(match.deckName || 'Unknown')}</div>
      <div><span style="color: var(--text-muted);">Opponent:</span> ${escapeHtml(match.opponentName)}</div>
      <div><span style="color: var(--text-muted);">Format:</span> ${format}</div>
      <div><span style="color: var(--text-muted);">Date:</span> ${date.toLocaleString()}</div>
      <div style="grid-column: 1/-1;"><span style="display: inline-block; padding: 4px 8px; border-radius: 4px; background: ${match.result === 'win' ? 'rgba(61,214,140,0.2)' : 'rgba(240,72,72,0.2)'}; color: ${match.result === 'win' ? '#3dd68c' : '#f04848'}">${match.result.toUpperCase()}</span></div>
    </div>
  `

  notesInput.value = match.notes || ''
  notesModal.classList.add('visible')
  notesInput.focus()
}

/**
 * Close notes modal
 */
function closeNotesModal(): void {
  notesModal.classList.remove('visible')
  currentEditingMatch = null
  notesInput.value = ''
}

/**
 * Save match notes
 */
async function saveNotes(): Promise<void> {
  if (!currentEditingMatch || !window.mtgaTracker) return

  try {
    const success = await window.mtgaTracker.updateMatchNotes(
      currentEditingMatch.id,
      notesInput.value
    )

    if (success) {
      // Update local data
      const match = allMatches.find(m => m.id === currentEditingMatch!.id)
      if (match) {
        match.notes = notesInput.value
      }
      // Re-render match lists to show notes indicator
      renderRecentMatches(allMatches.slice(0, 5))
      renderFullMatchList()
      closeNotesModal()
    }
  } catch (error) {
    console.error('[Dashboard] Failed to save notes:', error)
    alert('Failed to save notes')
  }
}

/**
 * Render win rate trend chart
 */
function renderWinRateTrend(matches: Match[]): void {
  const trendChart = document.getElementById('trendChartSvg') as SVGSVGElement
  const trendEmpty = document.getElementById('trendChartEmpty')!

  // Filter matches from last 30 days
  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
  const recentMatches = matches.filter(m => new Date(m.startedAt) >= thirtyDaysAgo)

  if (recentMatches.length < 2) {
    trendChart.style.display = 'none'
    trendEmpty.style.display = 'block'
    return
  }

  // Sort by date
  const sortedMatches = [...recentMatches].sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime())

  // Calculate rolling win rate (7-game rolling average)
  const points: Array<{ date: Date; winRate: number }> = []
  for (let i = 6; i < sortedMatches.length; i++) {
    const window = sortedMatches.slice(i - 6, i + 1)
    const wins = window.filter(m => m.result === 'win').length
    const winRate = (wins / 7) * 100
    points.push({
      date: new Date(sortedMatches[i].startedAt),
      winRate
    })
  }

  if (points.length < 2) {
    trendChart.style.display = 'none'
    trendEmpty.style.display = 'block'
    return
  }

  // Render SVG line chart
  const width = trendChart.clientWidth
  const height = 300
  const padding = 40
  const chartWidth = width - padding * 2
  const chartHeight = height - padding * 2

  // Clear previous
  trendChart.innerHTML = ''

  // Find min/max dates and win rates
  const minDate = points[0].date.getTime()
  const maxDate = points[points.length - 1].date.getTime()
  const minRate = 0
  const maxRate = 100

  // Draw background grid
  const gridGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g')
  for (let i = 0; i <= 4; i++) {
    const y = padding + (chartHeight / 4) * i
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line')
    line.setAttribute('x1', String(padding))
    line.setAttribute('y1', String(y))
    line.setAttribute('x2', String(width - padding))
    line.setAttribute('y2', String(y))
    line.setAttribute('stroke', 'rgba(255,255,255,0.05)')
    line.setAttribute('stroke-width', '1')
    gridGroup.appendChild(line)

    // Y-axis label
    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text')
    label.setAttribute('x', String(padding - 10))
    label.setAttribute('y', String(y + 4))
    label.setAttribute('text-anchor', 'end')
    label.setAttribute('font-size', '11')
    label.setAttribute('fill', 'rgba(255,255,255,0.5)')
    label.textContent = `${100 - i * 25}%`
    gridGroup.appendChild(label)
  }
  trendChart.appendChild(gridGroup)

  // Draw line
  let pathData = ''
  points.forEach((point, i) => {
    const x = padding + ((point.date.getTime() - minDate) / (maxDate - minDate)) * chartWidth
    const y = padding + chartHeight - ((point.winRate - minRate) / (maxRate - minRate)) * chartHeight
    pathData += `${i === 0 ? 'M' : 'L'} ${x} ${y} `
  })

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', pathData)
  path.setAttribute('stroke', '#5090ff')
  path.setAttribute('stroke-width', '2')
  path.setAttribute('fill', 'none')
  path.setAttribute('stroke-linecap', 'round')
  path.setAttribute('stroke-linejoin', 'round')
  trendChart.appendChild(path)

  // Draw points
  points.forEach(point => {
    const x = padding + ((point.date.getTime() - minDate) / (maxDate - minDate)) * chartWidth
    const y = padding + chartHeight - ((point.winRate - minRate) / (maxRate - minRate)) * chartHeight

    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
    circle.setAttribute('cx', String(x))
    circle.setAttribute('cy', String(y))
    circle.setAttribute('r', '3')
    circle.setAttribute('fill', '#5090ff')
    trendChart.appendChild(circle)
  })

  // Draw axes
  const axisGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g')
  const xAxis = document.createElementNS('http://www.w3.org/2000/svg', 'line')
  xAxis.setAttribute('x1', String(padding))
  xAxis.setAttribute('y1', String(height - padding))
  xAxis.setAttribute('x2', String(width - padding))
  xAxis.setAttribute('y2', String(height - padding))
  xAxis.setAttribute('stroke', 'rgba(255,255,255,0.2)')
  xAxis.setAttribute('stroke-width', '1')
  axisGroup.appendChild(xAxis)

  const yAxis = document.createElementNS('http://www.w3.org/2000/svg', 'line')
  yAxis.setAttribute('x1', String(padding))
  yAxis.setAttribute('y1', String(padding))
  yAxis.setAttribute('x2', String(padding))
  yAxis.setAttribute('y2', String(height - padding))
  yAxis.setAttribute('stroke', 'rgba(255,255,255,0.2)')
  yAxis.setAttribute('stroke-width', '1')
  axisGroup.appendChild(yAxis)

  trendChart.appendChild(axisGroup)

  trendChart.style.display = 'block'
  trendEmpty.style.display = 'none'
}

/**
 * Format event ID to readable format name
 */
function formatFormatName(eventId: string): string {
  const patterns: Record<string, string> = {
    'Historic_Ladder': 'Historic',
    'Traditional_Historic_Ladder': 'Trad. Historic',
    'Ladder': 'Standard',
    'Traditional_Ladder': 'Trad. Standard',
    'Alchemy_Ladder': 'Alchemy',
    'Explorer_Ladder': 'Explorer',
    'Timeless_Ladder': 'Timeless',
    'Historic_Play': 'Historic Play',
    'Play': 'Standard Play',
    'Bot_Match': 'Bot Match',
    'DirectChallenge': 'Direct Challenge',
    'PremierDraft': 'Premier Draft',
    'QuickDraft': 'Quick Draft',
    'TradDraft': 'Trad. Draft',
    'Sealed': 'Sealed',
    'Cube': 'Cube'
  }

  // Check exact match
  if (patterns[eventId]) return patterns[eventId]

  // Check partial match
  for (const [pattern, format] of Object.entries(patterns)) {
    if (eventId.toLowerCase().includes(pattern.toLowerCase())) {
      return format
    }
  }

  // Extract format from eventId
  if (eventId.includes('_')) {
    return eventId.split('_')[0]
  }

  return eventId
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text: string): string {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

// Initialize
init()

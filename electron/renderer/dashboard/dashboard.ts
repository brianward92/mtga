/**
 * MTGA Tracker Dashboard
 * Main dashboard for viewing match history, stats, and inventory
 */

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
}

interface DeckStats {
  name: string
  wins: number
  losses: number
  matches: number
  winRate: number
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

// Filters
const formatFilter = document.getElementById('formatFilter') as HTMLSelectElement
const resultFilter = document.getElementById('resultFilter') as HTMLSelectElement

// View All button
const viewAllBtn = document.getElementById('viewAllMatches')!

// State
let allMatches: Match[] = []
let currentInventory: InventoryData | null = null

/**
 * Initialize the dashboard
 */
async function init(): Promise<void> {
  setupNavigation()
  setupFilters()
  setupEventListeners()
  await loadData()
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
}

/**
 * Setup filter listeners
 */
function setupFilters(): void {
  formatFilter.addEventListener('change', () => renderFullMatchList())
  resultFilter.addEventListener('change', () => renderFullMatchList())
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

    // Render
    renderStats(stats)
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

  return `
    <div class="match-row">
      <span class="match-result ${match.result}">${match.result}</span>
      <span class="match-deck">${escapeHtml(deckName)}</span>
      <span class="match-opponent">vs ${escapeHtml(opponent)}</span>
      <span class="match-format">${format}</span>
      <span class="match-time">${timeAgo}</span>
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
    deckList.innerHTML = `
      <div class="empty-state">
        <p>No deck data yet</p>
        <p class="hint">Play matches to see deck statistics</p>
      </div>
    `
    return
  }

  deckList.innerHTML = decks.map(deck => {
    const winRateClass = deck.winRate >= 55 ? 'positive' : deck.winRate <= 45 ? 'negative' : 'neutral'

    return `
      <div class="deck-row">
        <span class="deck-name">${escapeHtml(deck.name)}</span>
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

/**
 * MTGA Draft Assistant Overlay
 * Displays deck tracking information during matches
 */

import { escapeHtml, renderManaCost } from './shared'
import { initDraftView, isDraftActive, cycleDraftDensity } from './draft-view'
import { initWindowControls } from './window-controls'
import { initCalibratePanel } from './calibrate'

// Export to make this a proper ES module (avoids duplicate function errors in TS)
export {}

// Type definitions
interface CardInDeck {
  name: string
  grpIds: number[]  // Multiple grpIds for same card from different sets
  manaCost: string
  type: CardType
  quantity: number
  remaining: number
  inHand: number
}

type CardType = 'creature' | 'instant' | 'sorcery' | 'enchantment' | 'artifact' | 'planeswalker' | 'land' | 'other'

interface DeckState {
  name: string
  cards: Map<string, CardInDeck>  // Keyed by card name
  grpIdToName: Map<number, string>  // Lookup from grpId to card name
  sideboardCards: Map<string, CardInDeck>  // Sideboard cards
  sideboardGrpIdToName: Map<number, string>  // Sideboard grpId lookup
  totalCards: number
  cardsRemaining: number
}

interface GameState {
  librarySize: number
  handSize: number
  graveyardCards: number[]
  cardsDrawn: number[]
  cardsOnBattlefield: number[]
  cardsInExile: number[]
  turnNumber?: number
  playerLife?: number
  opponentLife?: number
}

interface MatchStartData {
  matchId: string
  eventId: string
  opponentName: string
}

interface MatchEndData {
  matchId: string
  result: 'win' | 'loss' | 'draw'
  gameCount: number
}

// Card data cache
const cardNames: Map<number, { name: string; manaCost: string; type: string }> = new Map()

// State
let deckState: DeckState | null = null
let isMinimized = false
let isSideboardExpanded = false
let previousLibraryCount = -1
let previousHandCount = -1
let previousGraveyardCount = -1
let turnNumber = 0

// DOM elements
const overlay = document.getElementById('overlay')!
const matchStatus = document.getElementById('matchStatus')!
const turnCounter = document.getElementById('turnCounter')!
const deckNameEl = document.getElementById('deckName')!
const deckCount = document.getElementById('deckCount')!
const cardGroups = document.getElementById('cardGroups')!
const sideboardToggle = document.getElementById('sideboardToggle')!
const sideboardSection = document.getElementById('sideboardSection')!
const sideboardCards = document.getElementById('sideboardCards')!
const playerLifeEl = document.getElementById('playerLife')!
const opponentLifeEl = document.getElementById('opponentLife')!
const libraryCount = document.getElementById('libraryCount')!
const handCount = document.getElementById('handCount')!
const graveyardCount = document.getElementById('graveyardCount')!
const minimizeBtn = document.getElementById('minimizeBtn')!
const matchResultOverlay = document.getElementById('matchResultOverlay')!
const matchResultText = document.getElementById('matchResultText')!
const winRateBadge = document.getElementById('winRateBadge')!
const winRateValue = document.getElementById('winRateValue')!
const cardTooltip = document.getElementById('cardTooltip')!
const tooltipName = document.getElementById('tooltipName')!
const tooltipType = document.getElementById('tooltipType')!
const tooltipCost = document.getElementById('tooltipCost')!

/**
 * Initialize the overlay
 */
function init(): void {
  setupEventListeners()
  setupTrackerEvents()
  initDraftView()
  initWindowControls()
  initCalibratePanel()
  loadCardData()
  loadWinRate()
}

/**
 * Load and display the current win rate
 */
async function loadWinRate(): Promise<void> {
  if (!window.mtgaTracker) return

  try {
    const stats = await window.mtgaTracker.getMatchStats()
    updateWinRateBadge(stats.winRate, stats.wins + stats.losses)
  } catch (error) {
    console.error('[Overlay] Failed to load win rate:', error)
  }
}

/**
 * Update the win rate badge display
 */
function updateWinRateBadge(winRate: number, totalMatches: number): void {
  if (totalMatches === 0) {
    winRateBadge.style.display = 'none'
    return
  }

  winRateBadge.style.display = 'inline-flex'
  winRateValue.textContent = `${winRate.toFixed(0)}%`

  // Update badge color class based on win rate
  winRateBadge.className = 'win-rate-badge'
  if (winRate >= 55) {
    winRateBadge.classList.add('positive')
  } else if (winRate <= 45) {
    winRateBadge.classList.add('negative')
  }
}

/**
 * Load card data from main process
 */
async function loadCardData(): Promise<void> {
  if (!window.mtgaTracker) return

  // Card data will be loaded on demand when deck is submitted
  console.log('[Overlay] Ready')
}

/**
 * Setup UI event listeners
 */
function setupEventListeners(): void {
  minimizeBtn.addEventListener('click', toggleMinimize)
  sideboardToggle.addEventListener('click', toggleSideboard)

  // X on the grip bars hides the overlay; Dock/menu-bar clicks reopen it.
  document.querySelectorAll<HTMLElement>('.hide-btn').forEach(btn => {
    btn.addEventListener('click', () => window.mtgaTracker?.hideOverlay())
  })

  setupTooltips()

  // No keyboard shortcuts: the overlay never intercepts Arena or macOS keys.
}

/**
 * Setup card tooltip event delegation
 */
function setupTooltips(): void {
  cardGroups.addEventListener('mouseover', (e) => {
    const target = e.target as HTMLElement
    const cardRow = target.closest('.card-row') as HTMLElement
    if (cardRow) {
      const cardName = cardRow.dataset.card
      if (cardName && deckState) {
        const card = deckState.cards.get(cardName)
        if (card) {
          showTooltip(cardRow, card)
        }
      }
    }
  })

  cardGroups.addEventListener('mouseout', (e) => {
    const target = e.target as HTMLElement
    const cardRow = target.closest('.card-row')
    if (cardRow || !cardGroups.contains(e.relatedTarget as Node)) {
      hideTooltip()
    }
  })
}

/**
 * Show tooltip for a card
 */
function showTooltip(cardRow: HTMLElement, card: CardInDeck): void {
  tooltipName.textContent = card.name
  tooltipType.textContent = formatTypeName(card.type)
  tooltipCost.innerHTML = renderManaCost(card.manaCost)

  // Position INSIDE the panel: the window is exactly the panel's size, so
  // anything placed outside it (the old "to the left of the row" position)
  // is clipped and never visible. Prefer just below the row; flip above
  // when there's no room.
  const rect = cardRow.getBoundingClientRect()
  const overlayRect = overlay.getBoundingClientRect()

  const left = 8
  let top = rect.bottom - overlayRect.top + 4

  const maxTop = overlayRect.height - cardTooltip.offsetHeight - 8
  if (top > maxTop) {
    top = rect.top - overlayRect.top - cardTooltip.offsetHeight - 4
  }
  if (top < 0) top = 0

  cardTooltip.style.left = `${left}px`
  cardTooltip.style.top = `${top}px`
  cardTooltip.classList.add('visible')
}

/**
 * Hide the tooltip
 */
function hideTooltip(): void {
  cardTooltip.classList.remove('visible')
}

/**
 * Toggle minimized state.
 * In draft mode this cycles the draft densities instead
 * (verdict -> full -> mini).
 */
function toggleMinimize(): void {
  if (isDraftActive()) {
    cycleDraftDensity()
    return
  }
  isMinimized = !isMinimized
  overlay.classList.toggle('minimized', isMinimized)
  minimizeBtn.textContent = isMinimized ? '+' : '−'
  minimizeBtn.title = isMinimized ? 'Expand' : 'Minimize'
}

/**
 * Toggle sideboard expansion
 */
function toggleSideboard(): void {
  isSideboardExpanded = !isSideboardExpanded
  sideboardSection.classList.toggle('expanded', isSideboardExpanded)
  sideboardToggle.setAttribute('aria-expanded', String(isSideboardExpanded))
}

/**
 * Setup IPC event handlers
 */
function setupTrackerEvents(): void {
  if (!window.mtgaTracker) {
    console.error('[Overlay] mtgaTracker API not available')
    return
  }

  // Match start
  window.mtgaTracker.onMatchStart((data: unknown) => {
    const match = data as MatchStartData
    matchStatus.textContent = `vs ${match.opponentName}`
    matchStatus.className = 'status in-match'
  })

  // Match end
  window.mtgaTracker.onMatchEnd((data: unknown) => {
    const result = data as MatchEndData
    showMatchResult(result.result)

    // Update status
    matchStatus.textContent = result.result.toUpperCase()
    matchStatus.className = `status ${result.result}`

    // Refresh win rate after match ends
    loadWinRate()

    // Clear deck after delay
    setTimeout(() => {
      deckState = null
      renderDeck()
      matchStatus.textContent = 'Waiting for match...'
      matchStatus.className = 'status'
      turnNumber = 0
      turnCounter.textContent = ''
      previousLibraryCount = -1
      previousHandCount = -1
      previousGraveyardCount = -1
      isSideboardExpanded = false
      sideboardSection.classList.remove('expanded')
    }, 5000)
  })

  // Deck submission
  window.mtgaTracker.onDeckSubmission(async (data: unknown) => {
    const deck = data as {
      deckName: string
      mainDeck: Array<{ grpId: number; quantity: number }>
      sideboard?: Array<{ grpId: number; quantity: number }>
    }

    deckState = {
      name: deck.deckName,
      cards: new Map(),
      grpIdToName: new Map(),
      sideboardCards: new Map(),
      sideboardGrpIdToName: new Map(),
      totalCards: 0,
      cardsRemaining: 0
    }

    // Process cards and fetch names - consolidate by card name
    for (const card of deck.mainDeck) {
      let cardInfo = cardNames.get(card.grpId)

      // Fetch card name if not cached
      if (!cardInfo && window.mtgaTracker) {
        const name = await window.mtgaTracker.getCardName(card.grpId)
        const fullCard = await window.mtgaTracker.getCard(card.grpId)
        cardInfo = {
          name: name || `Card #${card.grpId}`,
          manaCost: fullCard?.manaCost || '',
          type: fullCard?.type || 'other'
        }
        cardNames.set(card.grpId, cardInfo)
      }

      if (!cardInfo) {
        cardInfo = { name: `Card #${card.grpId}`, manaCost: '', type: 'other' }
      }

      const cardName = cardInfo.name

      // Build grpId -> name lookup
      deckState.grpIdToName.set(card.grpId, cardName)

      // Consolidate cards with the same name (different set printings)
      const existingCard = deckState.cards.get(cardName)
      if (existingCard) {
        // Add this grpId to the existing card
        if (!existingCard.grpIds.includes(card.grpId)) {
          existingCard.grpIds.push(card.grpId)
        }
        existingCard.quantity += card.quantity
        existingCard.remaining += card.quantity
      } else {
        // New card entry
        deckState.cards.set(cardName, {
          name: cardName,
          grpIds: [card.grpId],
          manaCost: cardInfo.manaCost,
          type: inferCardType(cardInfo.type),
          quantity: card.quantity,
          remaining: card.quantity,
          inHand: 0
        })
      }

      deckState.totalCards += card.quantity
      deckState.cardsRemaining += card.quantity
    }

    // Process sideboard if available
    if (deck.sideboard) {
      for (const card of deck.sideboard) {
        let cardInfo = cardNames.get(card.grpId)

        if (!cardInfo && window.mtgaTracker) {
          const name = await window.mtgaTracker.getCardName(card.grpId)
          const fullCard = await window.mtgaTracker.getCard(card.grpId)
          cardInfo = {
            name: name || `Card #${card.grpId}`,
            manaCost: fullCard?.manaCost || '',
            type: fullCard?.type || 'other'
          }
          cardNames.set(card.grpId, cardInfo)
        }

        if (!cardInfo) {
          cardInfo = { name: `Card #${card.grpId}`, manaCost: '', type: 'other' }
        }

        const cardName = cardInfo.name
        deckState.sideboardGrpIdToName.set(card.grpId, cardName)

        const existingCard = deckState.sideboardCards.get(cardName)
        if (existingCard) {
          if (!existingCard.grpIds.includes(card.grpId)) {
            existingCard.grpIds.push(card.grpId)
          }
          existingCard.quantity += card.quantity
          existingCard.remaining += card.quantity
        } else {
          deckState.sideboardCards.set(cardName, {
            name: cardName,
            grpIds: [card.grpId],
            manaCost: cardInfo.manaCost,
            type: inferCardType(cardInfo.type),
            quantity: card.quantity,
            remaining: card.quantity,
            inHand: 0
          })
        }
      }
    }

    renderDeck()
  })

  // Game state updates
  window.mtgaTracker.onGameState((data: unknown) => {
    const state = data as GameState
    updateGameState(state)
  })

  // Deck selected (from Courses data)
  if (window.mtgaTracker.onDeckSelected) {
    window.mtgaTracker.onDeckSelected((data: unknown) => {
      const deck = data as { deckId: string; deckName: string }
      if (deck.deckName && deckState) {
        deckState.name = deck.deckName
        deckNameEl.textContent = deck.deckName
      }
    })
  }
}

/**
 * Show match result overlay
 */
function showMatchResult(result: 'win' | 'loss' | 'draw'): void {
  if (result === 'draw') return // Don't show for draws
  if (isDraftActive()) return   // Never splash over the draft panel

  matchResultText.textContent = result === 'win' ? 'Victory' : 'Defeat'
  matchResultText.className = `match-result-text ${result}`
  matchResultOverlay.classList.add('visible')

  setTimeout(() => {
    matchResultOverlay.classList.remove('visible')
  }, 2000)
}

/**
 * Infer card type from type string
 */
function inferCardType(typeString: string): CardType {
  const lower = typeString.toLowerCase()
  if (lower.includes('creature')) return 'creature'
  if (lower.includes('instant')) return 'instant'
  if (lower.includes('sorcery')) return 'sorcery'
  if (lower.includes('enchantment')) return 'enchantment'
  if (lower.includes('artifact')) return 'artifact'
  if (lower.includes('planeswalker')) return 'planeswalker'
  if (lower.includes('land')) return 'land'
  return 'other'
}

/**
 * Update game state and trigger animations
 */
function updateGameState(state: GameState): void {
  // Update turn counter
  if (state.turnNumber !== undefined && state.turnNumber !== turnNumber) {
    turnNumber = state.turnNumber
    turnCounter.textContent = `Turn ${turnNumber}`
  }

  // Update life totals
  if (state.playerLife !== undefined && state.playerLife > 0) {
    playerLifeEl.textContent = String(state.playerLife)
  }
  if (state.opponentLife !== undefined && state.opponentLife > 0) {
    opponentLifeEl.textContent = String(state.opponentLife)
  }

  // Update stats with animations
  updateStatWithAnimation(libraryCount, state.librarySize, previousLibraryCount)
  updateStatWithAnimation(handCount, state.handSize, previousHandCount)
  updateStatWithAnimation(graveyardCount, state.graveyardCards.length, previousGraveyardCount)

  previousLibraryCount = state.librarySize
  previousHandCount = state.handSize
  previousGraveyardCount = state.graveyardCards.length

  if (!deckState) return

  // Reset card states
  for (const card of deckState.cards.values()) {
    card.remaining = card.quantity
    card.inHand = 0
  }

  // Count cards in hand - use grpId -> name lookup
  for (const grpId of state.cardsDrawn) {
    const cardName = deckState.grpIdToName.get(grpId)
    if (cardName) {
      const card = deckState.cards.get(cardName)
      if (card) {
        card.inHand++
        card.remaining--
      }
    }
  }

  // Count cards in graveyard - use grpId -> name lookup
  for (const grpId of state.graveyardCards) {
    const cardName = deckState.grpIdToName.get(grpId)
    if (cardName) {
      const card = deckState.cards.get(cardName)
      if (card && card.remaining > 0) {
        card.remaining--
      }
    }
  }

  // Count cards on battlefield - use grpId -> name lookup
  for (const grpId of state.cardsOnBattlefield || []) {
    const cardName = deckState.grpIdToName.get(grpId)
    if (cardName) {
      const card = deckState.cards.get(cardName)
      if (card && card.remaining > 0) {
        card.remaining--
      }
    }
  }

  // Count cards in exile - use grpId -> name lookup
  for (const grpId of state.cardsInExile || []) {
    const cardName = deckState.grpIdToName.get(grpId)
    if (cardName) {
      const card = deckState.cards.get(cardName)
      if (card && card.remaining > 0) {
        card.remaining--
      }
    }
  }

  // Calculate remaining
  deckState.cardsRemaining = state.librarySize

  renderDeck()
}

/**
 * Update a stat value with animation
 */
function updateStatWithAnimation(element: HTMLElement, newValue: number, oldValue: number): void {
  element.textContent = String(newValue)

  if (oldValue !== -1 && newValue !== oldValue) {
    element.classList.add('changed')
    setTimeout(() => element.classList.remove('changed'), 400)
  }
}

/**
 * Render the sideboard section
 */
function renderSideboard(): void {
  if (!deckState || deckState.sideboardCards.size === 0) {
    sideboardSection.style.display = 'none'
    return
  }

  sideboardSection.style.display = 'block'

  // Group cards by type
  const groups: Map<CardType, CardInDeck[]> = new Map()
  const typeOrder: CardType[] = ['creature', 'planeswalker', 'instant', 'sorcery', 'enchantment', 'artifact', 'land', 'other']

  for (const type of typeOrder) {
    groups.set(type, [])
  }

  for (const card of deckState.sideboardCards.values()) {
    const group = groups.get(card.type) || groups.get('other')!
    group.push(card)
  }

  let html = ''
  for (const type of typeOrder) {
    const cards = groups.get(type)!
    if (cards.length === 0) continue

    cards.sort((a, b) => a.name.localeCompare(b.name))
    const totalRemaining = cards.reduce((sum, c) => sum + c.remaining, 0)
    const totalQuantity = cards.reduce((sum, c) => sum + c.quantity, 0)

    html += `
      <div class="card-group">
        <div class="group-header">
          <span>${formatTypeName(type)}</span>
          <span class="group-count">${totalRemaining}/${totalQuantity}</span>
        </div>
        <div class="card-list">
          ${cards.map(renderCard).join('')}
        </div>
      </div>
    `
  }

  sideboardCards.innerHTML = html
}

/**
 * Render the deck tracker
 */
function renderDeck(): void {
  if (!deckState) {
    deckNameEl.textContent = 'No deck loaded'
    deckCount.textContent = '0 cards'
    cardGroups.innerHTML = `
      <div class="empty-state">
        <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M12 8v8M8 12h8" />
        </svg>
        <p>Start a match to see your deck</p>
      </div>
    `
    libraryCount.textContent = '-'
    handCount.textContent = '-'
    graveyardCount.textContent = '-'
    return
  }

  deckNameEl.textContent = deckState.name
  deckCount.textContent = `${deckState.cardsRemaining} left`

  // Group cards by type
  const groups: Map<CardType, CardInDeck[]> = new Map()
  const typeOrder: CardType[] = ['creature', 'planeswalker', 'instant', 'sorcery', 'enchantment', 'artifact', 'land', 'other']

  for (const type of typeOrder) {
    groups.set(type, [])
  }

  for (const card of deckState.cards.values()) {
    const group = groups.get(card.type) || groups.get('other')!
    group.push(card)
  }

  // Render groups
  let html = ''

  for (const type of typeOrder) {
    const cards = groups.get(type)!
    if (cards.length === 0) continue

    // Sort by name
    cards.sort((a, b) => a.name.localeCompare(b.name))

    const totalRemaining = cards.reduce((sum, c) => sum + c.remaining, 0)
    const totalQuantity = cards.reduce((sum, c) => sum + c.quantity, 0)

    html += `
      <div class="card-group">
        <div class="group-header">
          <span>${formatTypeName(type)}</span>
          <span class="group-count">${totalRemaining}/${totalQuantity}</span>
        </div>
        <div class="card-list">
          ${cards.map(renderCard).join('')}
        </div>
      </div>
    `
  }

  cardGroups.innerHTML = html

  // Render sideboard
  renderSideboard()
}

/**
 * Calculate draw probability for a card
 */
function calculateDrawProbability(remaining: number, librarySize: number): number {
  if (librarySize <= 0 || remaining <= 0) return 0
  return Math.min((remaining / librarySize) * 100, 100)
}

/**
 * Render a single card row
 */
function renderCard(card: CardInDeck): string {
  const isDrawn = card.remaining < card.quantity
  const isAllDrawn = card.remaining === 0
  const isInHand = card.inHand > 0

  const classes = [
    'card-row',
    isAllDrawn ? 'drawn' : '',
    isInHand ? 'in-hand' : ''
  ].filter(Boolean).join(' ')

  const manaHtml = renderManaCost(card.manaCost)

  // Calculate draw percentage if we have library info
  const libSize = deckState?.cardsRemaining || 0
  const drawPct = calculateDrawProbability(card.remaining, libSize)
  const showProbability = libSize > 0 && card.remaining > 0

  return `
    <div class="${classes}" data-card="${escapeHtml(card.name)}">
      ${manaHtml ? `<div class="mana-cost">${manaHtml}</div>` : ''}
      <span class="card-name">${escapeHtml(card.name)}</span>
      ${showProbability ? `<span class="draw-pct">${drawPct.toFixed(0)}%</span>` : ''}
      <span class="card-count ${card.remaining === 0 ? 'zero' : ''}">${card.remaining}</span>
    </div>
  `
}

/**
 * Format card type name
 */
function formatTypeName(type: CardType): string {
  const names: Record<CardType, string> = {
    creature: 'Creatures',
    planeswalker: 'Planeswalkers',
    instant: 'Instants',
    sorcery: 'Sorceries',
    enchantment: 'Enchantments',
    artifact: 'Artifacts',
    land: 'Lands',
    other: 'Other'
  }
  return names[type]
}

// Start the overlay
init()

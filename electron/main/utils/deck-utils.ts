/**
 * Deck import/export utilities
 */

import { getCard } from '../data/card-registry'

export interface DeckListCard {
  grpId: number
  name: string
  quantity: number
}

/**
 * Export deck to Arena format
 * Format: quantity name (setcode) cardnumber
 */
export function exportDeckToArenaFormat(deckName: string, mainDeck: DeckListCard[], sideboard?: DeckListCard[]): string {
  const lines: string[] = []

  // Add main deck
  if (mainDeck.length > 0) {
    for (const card of mainDeck) {
      lines.push(`${card.quantity} ${card.name}`)
    }
  }

  // Add sideboard if present
  if (sideboard && sideboard.length > 0) {
    lines.push('') // Blank line separator
    for (const card of sideboard) {
      lines.push(`${card.quantity} ${card.name}`)
    }
  }

  return lines.join('\n')
}

/**
 * Parse Arena format deck text
 */
export function parseArenaDeckFormat(text: string): {
  mainDeck: DeckListCard[]
  sideboard: DeckListCard[]
  errors: string[]
} {
  const mainDeck: DeckListCard[] = []
  const sideboard: DeckListCard[] = []
  const errors: string[] = []
  let inSideboard = false

  const lines = text.split('\n').filter(line => line.trim().length > 0)

  for (const line of lines) {
    const trimmed = line.trim()

    // Blank line = switch to sideboard
    if (trimmed === '') {
      inSideboard = true
      continue
    }

    // Skip comment lines
    if (trimmed.startsWith('//')) {
      continue
    }

    // Parse line: "quantity name (setcode) cardnumber"
    const match = trimmed.match(/^(\d+)\s+(.+?)(?:\s+\(([^)]+)\))?(?:\s+\d+)?$/)
    if (!match) {
      errors.push(`Could not parse: ${trimmed}`)
      continue
    }

    const quantity = parseInt(match[1], 10)
    const name = match[2].trim()

    const cardList = inSideboard ? sideboard : mainDeck

    // Try to find card by name
    let foundCard = cardList.find(c => c.name.toLowerCase() === name.toLowerCase())
    if (foundCard) {
      foundCard.quantity += quantity
    } else {
      cardList.push({
        grpId: 0, // Will need to be resolved
        name,
        quantity
      })
    }
  }

  return { mainDeck, sideboard, errors }
}

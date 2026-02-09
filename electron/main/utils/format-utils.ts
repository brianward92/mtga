/**
 * Format detection utilities
 * Shared patterns for matching and formatting game format names
 */

/** Format patterns for matching event IDs */
const FORMAT_PATTERNS: Record<string, string> = {
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

/**
 * Format event ID to readable format name
 * @param eventId The raw event ID from the game
 * @returns Formatted display name
 */
export function formatEventId(eventId: string): string {
  if (!eventId) return 'Unknown'

  // Check exact match
  if (FORMAT_PATTERNS[eventId]) {
    return FORMAT_PATTERNS[eventId]
  }

  // Check partial match
  for (const [pattern, format] of Object.entries(FORMAT_PATTERNS)) {
    if (eventId.toLowerCase().includes(pattern.toLowerCase())) {
      return format
    }
  }

  // Extract format from eventId (before first underscore or as-is)
  if (eventId.includes('_')) {
    return eventId.split('_')[0]
  }

  return eventId
}

/**
 * Get format category (for grouping)
 * @param eventId The raw event ID
 * @returns Format category
 */
export function getFormatCategory(eventId: string): string {
  const formatted = formatEventId(eventId)
  const lower = formatted.toLowerCase()

  if (lower.includes('draft')) return 'Draft'
  if (lower.includes('sealed')) return 'Limited'
  if (lower.includes('historic')) return 'Historic'
  if (lower.includes('explorer')) return 'Explorer'
  if (lower.includes('timeless')) return 'Timeless'
  if (lower.includes('alchemy')) return 'Alchemy'
  if (lower.includes('standard')) return 'Standard'
  if (lower.includes('cube')) return 'Cube'

  return 'Other'
}

/**
 * Is this a limited format (draft/sealed)?
 */
export function isLimitedFormat(eventId: string): boolean {
  const lower = eventId.toLowerCase()
  return lower.includes('draft') || lower.includes('sealed')
}

/**
 * Is this a constructed format?
 */
export function isConstructedFormat(eventId: string): boolean {
  return !isLimitedFormat(eventId)
}

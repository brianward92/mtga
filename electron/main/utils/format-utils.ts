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
  'CompDraft': 'Competitive Draft',
  'PickTwoDraft': 'Pick Two Draft',
  'Sealed': 'Sealed',
  'Cube': 'Cube',
  'JumpIn': 'Jump In',
  'MidweekMagic': 'Midweek Magic'
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

  // Strip trailing set codes (3-4 uppercase letters) and dates (YYYYMMDD) from event ID
  // e.g. "PickTwoDraft_TMT_20260303" → "PickTwoDraft"
  const stripped = eventId
    .replace(/_\d{6,8}$/, '')       // trailing date
    .replace(/_[A-Z]{2,4}$/, '')    // trailing set code
    .replace(/_\d{6,8}$/, '')       // date before set code
    .replace(/_[A-Z]{2,4}$/, '')    // nested set code

  // Check partial match again after stripping
  for (const [pattern, format] of Object.entries(FORMAT_PATTERNS)) {
    if (stripped.toLowerCase().includes(pattern.toLowerCase())) {
      return format
    }
  }

  // CamelCase to spaced: "PickTwoDraft" → "Pick Two Draft"
  if (stripped && !stripped.includes('_')) {
    return stripped.replace(/([a-z])([A-Z])/g, '$1 $2')
  }

  return stripped || eventId
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

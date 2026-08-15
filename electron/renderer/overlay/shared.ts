/**
 * Small pure rendering helpers shared by the overlay's layers (unit tested).
 */

/** Escape text for insertion into an HTML string (no DOM needed). */
export function escapeHtml(text: string): string {
  return String(text).replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]!)
}

/**
 * Render mana cost symbols
 * Parses mana cost like "{2}{W}{W}" into pip spans.
 */
const MANA_SYMBOL_NAMES: Readonly<Record<string, string>> = {
  W: 'White',
  U: 'Blue',
  B: 'Black',
  R: 'Red',
  G: 'Green',
  C: 'Colorless'
}

/** A compact, text-precise mana pip that remains meaningful without color. */
export function renderManaSymbol(symbol: string, options: { decorative?: boolean } = {}): string {
  const upper = symbol.toUpperCase()
  const safe = escapeHtml(upper)
  const colorName = MANA_SYMBOL_NAMES[upper]
  const generic = !colorName
  const label = colorName
    ? `${colorName} mana`
    : /^\d+$/.test(upper)
      ? `${upper} generic mana`
      : `${upper} mana`
  const accessibility = options.decorative
    ? ' aria-hidden="true"'
    : ` role="img" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}"`

  return `<span class="mana-symbol ${generic ? 'generic' : upper}"${accessibility}>${safe}</span>`
}

export function renderManaCost(manaCost: string): string {
  if (!manaCost) return ''

  const symbols: string[] = []
  const regex = /\{([^}]+)\}/g
  let match

  while ((match = regex.exec(manaCost)) !== null) {
    symbols.push(match[1])
  }

  return symbols.map(symbol => renderManaSymbol(symbol)).join('')
}

/**
 * Format a win rate that may arrive as a fraction (0.57) or percentage (57).
 */
export function formatWinRate(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  const pct = value <= 1 ? value * 100 : value
  return `${pct.toFixed(1)}%`
}

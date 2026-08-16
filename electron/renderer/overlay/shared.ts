/**
 * Small pure rendering helpers shared by the overlay's layers (unit tested).
 */

/** True only for finite JavaScript numbers. */
export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

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

/** Canonical accessible names for mana symbols. */
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

/** Parse a brace-delimited mana cost into accessible pip spans. */
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

/**
 * Shared renderer helpers (used by the match overlay and the draft view).
 */

/**
 * Escape HTML to prevent XSS
 */
export function escapeHtml(text: string): string {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
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

function escapeManaText(text: string): string {
  return text.replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]!)
}

/** A compact, text-precise mana pip that remains meaningful without color. */
export function renderManaSymbol(symbol: string, options: { decorative?: boolean } = {}): string {
  const upper = symbol.toUpperCase()
  const safe = escapeManaText(upper)
  const colorName = MANA_SYMBOL_NAMES[upper]
  const generic = !colorName
  const label = colorName
    ? `${colorName} mana`
    : /^\d+$/.test(upper)
      ? `${upper} generic mana`
      : `${upper} mana`
  const accessibility = options.decorative
    ? ' aria-hidden="true"'
    : ` role="img" aria-label="${escapeManaText(label)}" title="${escapeManaText(label)}"`

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

/**
 * Coarse relative age of an ISO timestamp ("3m ago" / "5h ago" / "2d ago").
 * Unparseable, missing, or future timestamps return ''.
 */
export function formatRelativeAge(iso: string | null | undefined): string {
  if (!iso) return ''
  const ms = Date.now() - Date.parse(iso)
  if (!Number.isFinite(ms) || ms < 0) return ''
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

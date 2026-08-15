import { describe, expect, it } from 'vitest'
import { escapeHtml, formatWinRate, renderManaCost, renderManaSymbol } from '../renderer/overlay/shared'

describe('mana symbols', () => {
  it('renders precise visible W/U/B/R/G labels with accessible color names', () => {
    const html = renderManaCost('{1}{W}{U}{B}{R}{G}{C}')
    for (const [symbol, name] of [
      ['W', 'White'],
      ['U', 'Blue'],
      ['B', 'Black'],
      ['R', 'Red'],
      ['G', 'Green'],
      ['C', 'Colorless']
    ]) {
      expect(html).toContain(`class="mana-symbol ${symbol}"`)
      expect(html).toContain(`aria-label="${name} mana"`)
      expect(html).toContain(`>${symbol}</span>`)
    }
    expect(html).toContain('aria-label="1 generic mana"')
  })

  it('can mark a pip decorative when its parent owns the full label', () => {
    expect(renderManaSymbol('B', { decorative: true }))
      .toBe('<span class="mana-symbol B" aria-hidden="true">B</span>')
  })

  it('renders nothing for an empty cost and escapes odd symbols', () => {
    expect(renderManaCost('')).toBe('')
    expect(renderManaSymbol('<x>')).toContain('&lt;X&gt;')
  })
})

describe('escapeHtml', () => {
  it('escapes the five HTML-significant characters', () => {
    expect(escapeHtml(`<a href="x">Tom & Jerry's</a>`))
      .toBe('&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;')
  })

  it('leaves plain text alone', () => {
    expect(escapeHtml('Llanowar Elves')).toBe('Llanowar Elves')
  })
})

describe('formatWinRate', () => {
  it('accepts fractions and percentages', () => {
    expect(formatWinRate(0.573)).toBe('57.3%')
    expect(formatWinRate(57.3)).toBe('57.3%')
    expect(formatWinRate(1)).toBe('100.0%')
  })

  it('shows a dash when missing', () => {
    expect(formatWinRate(null)).toBe('—')
    expect(formatWinRate(undefined)).toBe('—')
    expect(formatWinRate(Number.NaN)).toBe('—')
  })
})

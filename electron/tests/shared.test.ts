import { describe, expect, it } from 'vitest'
import { renderManaCost, renderManaSymbol } from '../renderer/overlay/shared'

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
})

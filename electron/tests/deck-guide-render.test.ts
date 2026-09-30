import { describe, expect, it } from 'vitest'
import { guideHtml, type DeckObservation } from '../renderer/overlay/sheet'
import type { CardRow } from '../shared/state'
import type { DeckPlan } from '../shared/deck-plan'

const card = (name: string, colors: string, manaValue = 2): CardRow => ({ name, colors, manaValue, type: 'Creature', manaCost: `{${manaValue - 1}}{${colors}}`, setGrade: 'B' } as CardRow)
const pool = [card('White first', 'W', 1), card('White first', 'W', 1), card('Blue card', 'U'), card('Red extra', 'R')]
const plan = { lane: ['W', 'U'], laneLabel: 'W/U', spells: [{ name: 'Blue card', count: 1, manaCost: '{1}{U}' }, { name: 'White first', count: 2, manaCost: '{W}' }], nonbasicLands: [], basics: [{ color: 'W', count: 1 }], spellCount: 3, landCount: 1, total: 4 } as unknown as DeckPlan
const observation = (counts: Record<string, number>, status: DeckObservation['status'] = 'live'): DeckObservation => ({ counts, total: Object.values(counts).reduce((a, b) => a + b, 0), status, message: '', observedAt: 1 })

describe('live deck guide rendering', () => {
  it('leads with the selected deck, groups Arena browsing order, and counts missing copies', () => {
    const obs = observation({ 'White first': 1 })
    const html = guideHtml(plan, pool, obs.counts, obs)
    expect(html).toContain('1/4 matched')
    expect(html).toContain('Add <b>3</b>')
    expect(html).toContain('Cut <b>0</b>')
    expect(html.indexOf('data-guide-group="White"')).toBeLessThan(html.indexOf('data-guide-group="Blue"'))
    expect(html.indexOf('data-guide-group="Blue"')).toBeLessThan(html.indexOf('data-guide-group="Lands"'))
    expect(html).toContain('aria-label="1 of 2 copies in deck"')
    expect(html).not.toContain('data-guide-name=')
    expect(html).not.toContain('Checked by you')
  })

  it('removes completed additions automatically, but still shows extra copies as cuts', () => {
    const obs = observation({ 'White first': 3, 'Blue card': 1, Plains: 1, 'Red extra': 1 })
    const html = guideHtml(plan, pool, obs.counts, obs, 'cut')
    expect(html).toContain('4/4 matched')
    expect(html).toContain('Cut <b>2</b>')
    expect(html).toContain('Add <b>0</b>')
    expect(html).toContain('aria-label="3 of 2 copies in deck"')
    expect(html).not.toContain('Deck matches ✓')
    expect(html).toContain('id="guide-tab-cut" data-guide-tab="cut" aria-controls="guide-panel-cut" aria-selected="true"')
  })

  it('only confirms completion with a trustworthy observation and an exact deck total', () => {
    const counts = { 'White first': 2, 'Blue card': 1, Plains: 1 }
    for (const status of ['live', 'saved'] as const) expect(guideHtml(plan, pool, counts, observation(counts, status))).toContain('Deck matches ✓')
    for (const status of ['scanning', 'uncertain', 'permission'] as const) expect(guideHtml(plan, pool, counts, observation(counts, status))).not.toContain('Deck matches ✓')
    expect(guideHtml(plan, pool, counts, { ...observation(counts), total: 6 })).not.toContain('Deck matches ✓')
  })

  it('shows concrete sync instructions while counts are uncertain and escapes names/messages', () => {
    const obs = { ...observation({}, 'uncertain'), message: '<script>unsafe</script>' }
    const html = guideHtml(plan, pool, {}, obs)
    expect(html).toContain('Sync needed')
    expect(html).toContain('&lt;script&gt;unsafe&lt;/script&gt;')
    expect(html).not.toContain('<script>')
    expect(guideHtml(plan, pool, {}, undefined)).toContain('Switch Arena to list view and scroll through the deck to sync.')
  })
})

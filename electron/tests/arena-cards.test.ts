/**
 * Card identity and pack ordering, pinned against Arena's own card database.
 *
 * Both cases here are live defects from the 2026-09-08 LCI Quick Draft, not
 * hypotheticals. The bundles derive grpId -> card from Scryfall's `arena_id`,
 * and that mapping was wrong in two ways that a draft actually hit.
 */
import { describe, it, expect } from 'vitest'
import { existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { findBundleRoot, loadSetBundle } from '../main/data/bundle'
import { loadArenaCards } from '../main/data/arena-cards'
import { arenaDisplayOrder, hasArenaOrder } from '../shared/display-order'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'resources', 'draftfm')
const have = existsSync(join(ROOT, 'arena-cards.json')) && existsSync(join(ROOT, 'sets', 'LCI', 'assets.npz'))

describe('Arena is the authority for card identity', () => {
  it.skipIf(!have)('resolves the basic lands Scryfall had shifted by one', () => {
    const bundle = loadSetBundle(ROOT, 'LCI')!
    // Arena's own database maps these; Scryfall had every id one position high,
    // so 87455 read as a Plains while Arena drew an Island. A forced last pick
    // in a real draft took this card.
    expect(bundle.cards.get(87455)?.name).toBe('Island')
    expect(bundle.cards.get(87456)?.name).toBe('Island')
    expect(bundle.cards.get(87453)?.name).toBe('Plains')
    expect(bundle.cards.get(87454)?.name).toBe('Plains')
    expect(bundle.cards.get(87457)?.name).toBe('Swamp')
    expect(bundle.cards.get(87459)?.name).toBe('Mountain')
    expect(bundle.cards.get(87461)?.name).toBe('Forest')
  })

  it.skipIf(!have)('adopts ids Scryfall never knew, which appear in real packs', () => {
    // 87453 is absent from Scryfall entirely; it was the land slot of a live
    // LCI pack and rendered as an unresolvable "Card #87453".
    const arena = loadArenaCards(ROOT)
    expect(arena.size).toBeGreaterThan(20000)
    expect(arena.name(87453)).toBe('Plains')
  })
})

describe('pack order follows Arena, not our reconstruction of it', () => {
  it.skipIf(!have)('orders the P1P10 pack that mis-clicked exactly as Arena does', () => {
    const bundle = loadSetBundle(ROOT, 'LCI')!
    // The real pack from 2026-09-08 P1P10, in Arena's log order.
    const packIds = [87280, 87190, 87257, 87199, 87424, 87443]
    const cards = packIds.map(g => bundle.cards.get(g)!)
    expect(cards.every(Boolean)).toBe(true)
    expect(hasArenaOrder(cards)).toBe(true)

    const names = arenaDisplayOrder(cards).map(i => cards[i].name)
    // Arena's own Order_* columns give this sequence. Our old heuristic put
    // Inverted Iceberg last among commons, because it reads printed colours and
    // the card is a colourless artifact, while Arena sorts it under its blue
    // colour identity. That shifted every later cell by one, and the picker
    // clicked Mephitic Draught when it wanted Ancestors' Aid.
    expect(names).toEqual([
      'Sorcerous Spyglass',
      'Didact Echo',
      'Inverted Iceberg',
      'Mephitic Draught',
      "Ancestors' Aid",
      'Hidden Volcano'
    ])
  })

  it.skipIf(!have)('covers every card in a shipped set, so a pack never falls back mid-grid', () => {
    const root = findBundleRoot() ?? ROOT
    for (const set of ['LCI', 'DSK', 'BRO', 'HBG', 'MKM']) {
      const bundle = loadSetBundle(root, set)
      if (!bundle) continue
      const missing = [...bundle.cards.values()].filter(c => !c.order)
      expect(missing.slice(0, 5).map(c => `${set} ${c.grpId} ${c.name}`)).toEqual([])
    }
  })
})

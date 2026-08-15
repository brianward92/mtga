/**
 * Arena's on-screen pack order (pure — unit tested).
 *
 * The log's PackCards / DraftPack list arrives grouped commons → uncommons →
 * rares → basic land, but Arena DISPLAYS the pack sorted:
 *   rarity desc (mythic, rare, uncommon, common, basic land)
 *   → colour (W, U, B, R, G, multicolour, colourless)
 *   → name asc (collector numbers run alphabetically within a colour).
 * Badges are anchored to screen cells, so they must use this order, not the
 * log's. Ties keep log order (stable sort).
 */

export interface DisplayOrderCard {
  name: string | null
  rarity: string | null
  /** Colour letters, e.g. "W", "UB", "" for colourless. */
  colors: string | null
  type?: string | null
}

const RARITY_RANK: Record<string, number> = {
  mythic: 0,
  rare: 1,
  uncommon: 2,
  common: 3,
  land: 4,
  token: 5
}

const COLOR_RANK: Record<string, number> = { W: 0, U: 1, B: 2, R: 3, G: 4 }

function rarityRank(card: DisplayOrderCard): number {
  const key = (card.rarity ?? '').toLowerCase()
  if (key in RARITY_RANK) return RARITY_RANK[key]
  // Unknown rarity for a basic land still sorts last.
  if (/basic land/i.test(card.type ?? '')) return RARITY_RANK.land
  return RARITY_RANK.common
}

function colorRank(card: DisplayOrderCard): number {
  const letters = (card.colors ?? '').toUpperCase().split('').filter(c => c in COLOR_RANK)
  const unique = [...new Set(letters)]
  if (unique.length === 0) return 6 // colourless
  if (unique.length > 1) return 5 // multicolour
  return COLOR_RANK[unique[0]]
}

/** Indices into `cards`, in Arena's display order. */
export function arenaDisplayOrder(cards: ReadonlyArray<DisplayOrderCard>): number[] {
  return cards
    .map((card, index) => ({ card, index }))
    .sort((a, b) => {
      const r = rarityRank(a.card) - rarityRank(b.card)
      if (r !== 0) return r
      const c = colorRank(a.card) - colorRank(b.card)
      if (c !== 0) return c
      const n = (a.card.name ?? '').localeCompare(b.card.name ?? '', 'en', { sensitivity: 'base' })
      if (n !== 0) return n
      return a.index - b.index
    })
    .map(e => e.index)
}

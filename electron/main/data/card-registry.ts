/**
 * Card registry: grpId -> card info for the whole app.
 *
 * Backed by Arena's own card database (see arena-db.ts) with a cached JSON
 * snapshot as offline fallback. Server ratings responses can be merged in as
 * a final fallback for grpIds Arena's DB doesn't know (Alchemy rebalances,
 * brand-new printings).
 */

import { ArenaCard, loadArenaCards } from './arena-db'

export interface CardInfo {
  name: string
  manaCost: string
  type: string
  rarity: string
  colors: string[]
  colorIdentity: string[]
  setCode: string
  imageUrl?: string
}

let cards: Map<number, ArenaCard> = new Map()
let loaded = false

/**
 * Load the registry from the Arena DB / snapshot. Safe to call repeatedly;
 * reloads each time (Arena updates its DB between sessions).
 */
export function loadCardRegistry(): number {
  cards = loadArenaCards()
  loaded = true
  return cards.size
}

export function getCard(grpId: number): CardInfo | null {
  if (!loaded) loadCardRegistry()
  return cards.get(grpId) ?? null
}

export function getCardName(grpId: number): string | null {
  return getCard(grpId)?.name ?? null
}

/** Distinct set codes, sorted (for the dashboard collection filter). */
export function getSetList(): string[] {
  if (!loaded) loadCardRegistry()
  const sets = new Set<string>()
  for (const card of cards.values()) {
    if (card.setCode) sets.add(card.setCode)
  }
  return Array.from(sets).sort()
}

/** Cards for a set (empty/falsy set code = all cards), sorted by name. */
export function getCardsBySet(setCode: string): Array<{ grpId: number; card: CardInfo }> {
  if (!loaded) loadCardRegistry()
  const wanted = (setCode || '').toUpperCase()
  const result: Array<{ grpId: number; card: CardInfo }> = []
  for (const [grpId, card] of cards) {
    if (!wanted || card.setCode === wanted) {
      result.push({ grpId, card })
    }
  }
  result.sort((a, b) => a.card.name.localeCompare(b.card.name))
  return result
}

/**
 * Merge card identities from the draft server's ratings/score responses.
 * Only fills grpIds the Arena DB doesn't know — the local DB stays
 * authoritative.
 */
export function mergeServerCards(
  rows: Array<{
    grp_id: number
    name: string | null
    colors?: string | null
    rarity?: string | null
    mana_value?: number | null
    image_small?: string | null
    image_normal?: string | null
  }>
): number {
  if (!loaded) loadCardRegistry()
  let added = 0
  for (const row of rows) {
    if (!row || !row.name || !Number.isFinite(row.grp_id) || cards.has(row.grp_id)) continue
    const colors = (row.colors || '').split('').filter(c => 'WUBRG'.includes(c))
    cards.set(row.grp_id, {
      name: row.name,
      manaCost: row.mana_value != null ? `{${row.mana_value}}` : '',
      type: '',
      rarity: row.rarity || 'common',
      colors,
      colorIdentity: colors,
      setCode: '',
      imageUrl: row.image_normal || row.image_small || undefined
    })
    added++
  }
  return added
}

/**
 * Arena's on-screen pack order (pure — unit tested against real packs).
 *
 * The log's DraftPack list arrives grouped commons → uncommons → rares → land,
 * but Arena DISPLAYS the pack sorted the way its client sorts cards, using the
 * ordering columns in Arena's own card database:
 *   Order_MythicToCommon  mythic 0, rare 1, uncommon 2, common 3, basic land 4
 *   Order_ColorOrder      mono W U B R G = 0..4; two-colour pairs in a FIXED
 *                         table (WU 5, WB 6, UB 7, UR 8, BR 9, BG 10, RG 11,
 *                         WR 12, WG 13, UG 14); tri-colour 15..24; four 25..29;
 *                         five 30; colourless 31 (basic lands take their
 *                         identity colour's mono slot)
 *   Order_Title           the normalised card title, alphabetical
 * Badges are anchored to screen cells, so they must use this order, not the
 * log's. Ties keep log order (stable sort).
 */

export interface DisplayOrderCard {
  name: string | null
  rarity: string | null
  /** Printed colour letters, e.g. "W", "UB", "" for colourless. */
  colors: string | null
  type?: string | null
  /** Colour identity (basic lands sort by it). */
  colorIdentity?: string | null
}

const RARITY_RANK: Record<string, number> = { mythic: 0, rare: 1, uncommon: 2, common: 3, land: 4, basic: 4, token: 5 }
const MONO: Record<string, number> = { W: 0, U: 1, B: 2, R: 3, G: 4 }
/** Arena's Order_ColorOrder for multicolour sets (keys are WUBRG-sorted letters). */
const MULTI: Record<string, number> = {
  WU: 5, WB: 6, UB: 7, UR: 8, BR: 9, BG: 10, RG: 11, WR: 12, WG: 13, UG: 14,
  WUB: 15, UBR: 16, BRG: 17, WRG: 18, WUG: 19, WBR: 20, URG: 21, WBG: 22, WUR: 23, UBG: 24,
  WUBR: 25, UBRG: 26, WBRG: 27, WURG: 28, WUBG: 29, WUBRG: 30
}
const COLORLESS = 31

function letters(s: string | null | undefined): string {
  const set = new Set((s ?? '').toUpperCase().split('').filter(c => c in MONO))
  return 'WUBRG'.split('').filter(c => set.has(c)).join('')
}

/** Any land (basic or not): Arena files them in the land tier after commons. */
function isLand(card: DisplayOrderCard): boolean {
  const r = (card.rarity ?? '').toLowerCase()
  return /\bland\b/i.test(card.type ?? '') || r === 'land' || r === 'basic'
}

/**
 * Arena files lands in its bottom tier only when they carry its "land" rarity:
 * basic lands and the common cycle lands (Murky Sewer). A land printed at
 * uncommon or above sorts with its rarity — a rare land such as Thornspire
 * Verge leads the pack, and treating it as a land shifted every badge by one
 * cell for the rest of the pack.
 */
function rarityRank(card: DisplayOrderCard): number {
  const key = (card.rarity ?? '').toLowerCase()
  if (isLand(card) && (key === 'land' || key === 'basic' || key === 'common' || key === '')) {
    return RARITY_RANK.land
  }
  if (key in RARITY_RANK) return RARITY_RANK[key]
  return RARITY_RANK.common
}

/**
 * Arena's Order_ColorOrder for a card: printed colours; lands (which print
 * no colour) take their colour identity (Swamp → B, Murky Sewer → UB).
 */
export function colorOrder(card: DisplayOrderCard): number {
  let cols = letters(card.colors)
  if (isLand(card)) cols = letters(card.colorIdentity) || cols
  if (!cols) return COLORLESS
  if (cols.length === 1) return MONO[cols]
  return MULTI[cols] ?? COLORLESS
}

/** Arena's Order_Title: lowercase, letters/digits only (Rooms keep "//"). */
function titleKey(name: string | null | undefined): string {
  return (name ?? '').toLowerCase().replace(/[^a-z0-9/]/g, '')
}

/** Indices into `cards`, in Arena's display order. */
export function arenaDisplayOrder(cards: ReadonlyArray<DisplayOrderCard>): number[] {
  return cards
    .map((card, index) => ({ card, index }))
    .sort((a, b) => {
      const r = rarityRank(a.card) - rarityRank(b.card)
      if (r !== 0) return r
      const c = colorOrder(a.card) - colorOrder(b.card)
      if (c !== 0) return c
      const ta = titleKey(a.card.name), tb = titleKey(b.card.name)
      if (ta !== tb) return ta < tb ? -1 : 1
      return a.index - b.index
    })
    .map(e => e.index)
}

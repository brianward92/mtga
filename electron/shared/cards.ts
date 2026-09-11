/**
 * Card identity: naming and land classification, in one place.
 *
 * These two questions — "are these the same card?" and "is this a land?" —
 * were each answered by four separate copies scattered across the renderer,
 * the shared layer, the dev scripts and a Python helper. The copies disagreed.
 * `statecheck.py` tested `type.startswith("Basic Land")` while everything else
 * used a word-boundary regex, so a card Arena types "Snow Basic Land" was a
 * land to the overlay and not a land to the picker. Divergence here does not
 * throw: it silently mis-sorts a pack, and because badges are matched to cells
 * positionally, one wrong answer shifts every card after it.
 */

/** A card as Arena's own database describes it. Every field may be absent. */
export interface CardIdentity {
  name?: string | null
  type?: string | null
  rarity?: string | null
}

/**
 * Arena's Order_Title: lowercase, letters and digits only.
 *
 * "//" survives because Rooms and split cards are ordered by the joined title
 * ("Bake // Bloom"), and dropping the separator would collide two halves that
 * Arena keeps apart.
 */
export function titleKey(name: string | null | undefined): string {
  return (name ?? '').toLowerCase().replace(/[^a-z0-9/]/g, '')
}

/**
 * `titleKey` for names that reached us from different sources.
 *
 * The same physical card is spelled differently on each side: Scryfall prefixes
 * Alchemy rebalances with "A-", writes split cards with "//" where Arena writes
 * "///", and names a meld card from its other face. A pack holding any of those
 * loses Arena's ordering entirely without this, because the sort keys are
 * all-or-nothing per pack.
 */
export function crossSourceTitleKey(name: string | null | undefined): string {
  return (name ?? '')
    .toLowerCase()
    .replace(/^a-/, '')
    .replace(/\/{2,}/g, '/')
    .replace(/[^a-z0-9/]/g, '')
}

/** Strip Arena's presentation markup from a localized title: `<nobr>Cat-Gator</nobr>`. */
export function cleanArenaTitle(s: string): string {
  return s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
}

/** The five basic land names, and the colour each one taps for. */
export const BASIC_LAND_COLOR: Readonly<Record<string, 'W' | 'U' | 'B' | 'R' | 'G'>> = {
  Plains: 'W', Island: 'U', Swamp: 'B', Mountain: 'R', Forest: 'G'
}
/** The basic land each lane colour runs. */
export const BASIC_LAND_NAMES: Readonly<Record<'W' | 'U' | 'B' | 'R' | 'G', string>> = {
  W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest'
}

/** True for a name that is exactly a basic land (Wastes included). */
export function isBasicLandName(name: string | null | undefined): boolean {
  const k = titleKey(name)
  return k === 'wastes' || Object.keys(BASIC_LAND_COLOR).some(b => titleKey(b) === k)
}

/** Any land, basic or not. */
export function isLand(card: CardIdentity): boolean {
  const r = (card.rarity ?? '').toLowerCase()
  return /\bland\b/i.test(card.type ?? '') || r === 'land' || r === 'basic'
}

/**
 * A basic land.
 *
 * Arena gives basics the rarity "land", which is also what it gives the common
 * cycle lands, so the type text decides and the rarity is only a fallback for
 * rows that reached us without one.
 */
export function isBasicLand(card: CardIdentity): boolean {
  if (/\bbasic land\b/i.test(card.type ?? '')) return true
  if (card.type) return isBasicLandName(card.name)
  return (card.rarity ?? '').toLowerCase() === 'land' && isBasicLandName(card.name)
}

/**
 * Do two names refer to the same card, allowing for OCR and for Arena's own
 * truncation?
 *
 * Both directions are needed and both were learned the hard way:
 *   - Arena truncates a long name to fit the deck rail: "Faramir, Field Comma…".
 *   - Vision OCR groups rail rows by vertical position, and the neighbouring
 *     row's "1x" lands inside this row's box, so the recognised text is the
 *     real name plus a stray digit: "Volatile Wanderglyph 1". That failed to
 *     match, the row read as "not in the plan", and the deckbuilder cut all
 *     three copies of a card the plan wanted.
 *
 * The 8-character floor keeps short names from swallowing longer ones.
 */
export function namesMatch(observed: string, name: string): boolean {
  // Recognition tacks on whatever sits after the title on the same row: pick 6
  // of pack 2 read "kawalli, the Seething Tower 1*", the "1*" being a pip. Drop
  // trailing tokens that carry no letters; a card name never ends in one.
  const trimmed = observed.replace(/[….]+$/, '').replace(/(\s+[^A-Za-z\s]+)+\s*$/, '')
  const a = titleKey(trimmed)
  const b = titleKey(name)
  if (!a || !b) return false
  if (a === b) return true
  if (a.length >= 8 && b.startsWith(a)) return true
  if (b.length >= 8 && a.startsWith(b)) return true
  // A crop can clip the FIRST glyph as easily as the last: pick one of a live
  // draft read "hupacabra Echo" for Chupacabra Echo and the prefix rules above
  // refused it, which aborted the pick with the entry fee already paid. A long
  // read contained anywhere in the name is the same card; at eight characters
  // and up nothing else in a pack shares that much of a title.
  if (a.length >= 8 && b.includes(a)) return true
  // The clipped first glyph can also be MANGLED rather than missing: a W with
  // its left stroke cut off reads as a V, and pick 15 refused "Valk with the
  // Ancestors". Ignore the first character when what follows is long enough to
  // identify the card on its own.
  if (a.length >= 9 && b.includes(a.slice(1))) return true
  return false
}

// ---- pool-level colour facts ------------------------------------------------

/** WUBRG in the stable order used by pool summaries and UI chips. */
export const POOL_COLORS = ['W', 'U', 'B', 'R', 'G'] as const

/** One canonical Magic colour letter. */
export type PoolColor = (typeof POOL_COLORS)[number]

/** Human-readable names for canonical colour and colourless labels. */
export const COLOR_NAMES: Readonly<Record<PoolColor | 'C', string>> = {
  W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green', C: 'Colorless'
}

/** Colour and land counts derived from a drafted pool. */
export interface PoolSummary {
  /** Colour pips per colour (multicolour cards count once per colour). */
  counts: Record<PoolColor, number>
  /** Non-land cards with no colour. */
  colorless: number
  /** Non-land cards in the pool. */
  cards: number
  /** Land cards in the pool. */
  lands: number
}

/** Colour distribution of the pool (lands excluded — they do not reveal a lane). */
export function poolSummary(pool: ReadonlyArray<CardIdentity & { colors?: string | null }>): PoolSummary {
  const counts: Record<PoolColor, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 }
  let colorless = 0
  let cards = 0
  let lands = 0
  for (const card of pool) {
    if (isLand(card)) { lands++; continue }
    cards++
    const letters = new Set((card.colors || '').toUpperCase().split('').filter((c): c is PoolColor => c in counts))
    if (letters.size === 0) { colorless++; continue }
    for (const c of letters) counts[c]++
  }
  return { counts, colorless, cards, lands }
}

/**
 * The colours a card actually needs to be cast.
 *
 * Prefers the printed `colors`, but falls back to the mana cost when that is
 * empty. Some cards have neither field agreeing: Waterlogged Hulk is a
 * double-faced artifact whose bundle entry carries `colors: ""` and
 * `manaCost: "{U}"`, so a lane check reading `colors` alone judged it
 * colourless and castable in any deck. It was built into a Red/White deck and
 * sat in hand all game, uncastable.
 *
 * The same distinction — what a card COSTS versus what it is — caused the
 * P1P10 mis-pick, where colour identity and printed colour disagreed.
 */
export function castingColors(card: CardIdentity & { colors?: string | null; manaCost?: string | null; colorIdentity?: string | null }): PoolColor[] {
  const fromColors = letters(card.colors)
  if (fromColors.length > 0) return fromColors
  const fromCost = letters((card.manaCost ?? '').replace(/[^WUBRG]/gi, ''))
  if (fromCost.length > 0) return fromCost
  // Lands print no cost at all; only their identity says what they serve.
  return isLand(card) ? letters(card.colorIdentity) : []
}

function letters(s: string | null | undefined): PoolColor[] {
  const seen = new Set((s ?? '').toUpperCase().split(''))
  return POOL_COLORS.filter(c => seen.has(c))
}

const SCRYFALL_CARD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** Builds the public Scryfall CDN URL for a validated card printing ID. */
export function scryfallImageUrl(scryfallId: string | null | undefined): string | null {
  if (!scryfallId || !SCRYFALL_CARD_ID.test(scryfallId)) return null
  const id = scryfallId.toLowerCase()
  return `https://cards.scryfall.io/normal/front/${id[0]}/${id[1]}/${id}.jpg`
}

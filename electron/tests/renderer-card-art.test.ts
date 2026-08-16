import { describe, expect, it } from 'vitest'
import { scryfallImageUrl } from '../renderer/overlay/card-art'

describe('scryfallImageUrl', () => {
  it('builds the normal-front CDN URL from a Scryfall printing ID', () => {
    expect(scryfallImageUrl('6C5F0A31-0FB4-4D85-8B22-8D6D7D00BE42')).toBe(
      'https://cards.scryfall.io/normal/front/6/c/6c5f0a31-0fb4-4d85-8b22-8d6d7d00be42.jpg'
    )
  })

  it.each([null, undefined, '', 'not-an-id', '../card.jpg', '6c5f0a31-0fb4-4d85-8b22'])('rejects %j', value => {
    expect(scryfallImageUrl(value)).toBeNull()
  })
})

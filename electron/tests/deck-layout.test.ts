import { describe, it, expect } from 'vitest'
import { deckListOrder, deckRows, parseRailLine, parseDeckCount, namesMatch, railRowTop, railRowBottom, DECK_RAIL } from '../shared/deck-layout'

const c = (name: string, mv: number, colors: string, type = 'Creature', rarity = 'common', colorIdentity = colors) =>
  ({ name, manaValue: mv, colors, type, rarity, colorIdentity })

describe('deckListOrder — Arena deck-list rail order (observed 2026-09-06, LTR Premier)', () => {
  it('sorts by mana value, then Arena colour order, then title, with lands last (basics first)', () => {
    const deck = [
      c('Great Hall of the Citadel', 0, '', 'Land', 'uncommon', ''),
      c('Mountain', 0, '', 'Basic Land — Mountain', 'land', 'R'),
      c('Plains', 0, '', 'Basic Land — Plains', 'land', 'W'),
      c('Théoden, King of Rohan', 3, 'RW'),
      c('Gimli, Mournful Avenger', 3, 'RG'),
      c('Brandywine Farmer', 3, 'G'),
      c('Haradrim Spearmaster', 3, 'R'),
      c('Ent-Draught Basin', 2, '', 'Artifact'),
      c('Erebor Flamesmith', 2, 'R'),
      c('Morgul-Knife Wound', 2, 'B', 'Enchantment — Aura'),
      c("Council's Deliberation", 2, 'U', 'Instant'),
      c('Westfold Rider', 2, 'W'),
      c('Lost to Legend', 2, 'W', 'Sorcery'),
      c('East-Mark Cavalier', 2, 'W'),
      c('Barrow-Blade', 1, '', 'Artifact — Equipment'),
      c('Long List of the Ents', 1, 'G', 'Enchantment — Saga'),
      c('Elven Farsight', 1, 'G', 'Sorcery'),
      c('You Cannot Pass!', 1, 'W', 'Instant'),
      c('Esquire of the King', 1, 'W'),
      c('Escape from Orthanc', 1, 'W', 'Instant'),
      c('Rangers of Ithilien', 4, 'U'),
      c('Bill the Pony', 4, 'W'),
    ]
    expect(deckListOrder(deck).map(x => x.name)).toEqual([
      'Escape from Orthanc', 'Esquire of the King', 'You Cannot Pass!', 'Elven Farsight', 'Long List of the Ents', 'Barrow-Blade',
      'East-Mark Cavalier', 'Lost to Legend', 'Westfold Rider', "Council's Deliberation", 'Morgul-Knife Wound', 'Erebor Flamesmith', 'Ent-Draught Basin',
      'Haradrim Spearmaster', 'Brandywine Farmer', 'Gimli, Mournful Avenger', 'Théoden, King of Rohan',
      'Bill the Pony', 'Rangers of Ithilien',
      'Plains', 'Mountain', 'Great Hall of the Citadel'
    ])
  })

  it('collapses copies into Nx rows', () => {
    const rows = deckRows([c('Esquire of the King', 1, 'W'), c('Plains', 0, '', 'Basic Land — Plains', 'land', 'W'), c('Esquire of the King', 1, 'W')])
    expect(rows.map(r => [r.name, r.count])).toEqual([['Esquire of the King', 2], ['Plains', 1]])
  })
})

describe('rail OCR parsing', () => {
  it('parses Nx rows, tolerating OCR reading 1 as I or l', () => {
    expect(parseRailLine('3x Esquire of the King')).toEqual({ count: 3, name: 'Esquire of the King' })
    expect(parseRailLine('Ix Great Hall of the Citadel')).toEqual({ count: 1, name: 'Great Hall of the Citadel' })
    expect(parseRailLine('11x Plains')).toEqual({ count: 11, name: 'Plains' })
    expect(parseRailLine('Draft Deck')).toBeNull()
  })
  it('parses the deck count header and matches truncated names', () => {
    expect(parseDeckCount('41/40 Cards')).toBe(41)
    expect(namesMatch('Faramir, Field Comma...', 'Faramir, Field Commander')).toBe(true)
    expect(namesMatch('Esquire of the King', 'Esquire of the King')).toBe(true)
    expect(namesMatch('Plains', 'Mountain')).toBe(false)
  })
})

describe('rail geometry', () => {
  const rect = { x: 208, y: 39, width: 1280, height: 748 }
  it('reproduces the measured row centres for the 2026-09-06 window', () => {
    expect(railRowTop(rect, 0)).toEqual({ x: 1361, y: 205 })
    expect(railRowTop(rect, 1).y - railRowTop(rect, 0).y).toBe(32)
    expect(railRowBottom(rect, 29, 30).y).toBe(598)
    expect(DECK_RAIL.visibleRows).toBe(16)
  })
})

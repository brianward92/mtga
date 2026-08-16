import { describe, expect, it } from 'vitest'
import { arenaDisplayOrder, colorOrder } from '../shared/display-order'

// Real DSK Quick Draft P1P1, in log (DraftPack) order, vs. what Arena drew on
// screen (5-column grid, row-major).
const LOG_ORDER = [
  { name: 'Murder', rarity: 'common', colors: 'B' },
  { name: 'Vanish from Sight', rarity: 'common', colors: 'U' },
  { name: 'Grand Entryway // Elegant Rotunda', rarity: 'common', colors: 'W' },
  { name: 'Turn Inside Out', rarity: 'common', colors: 'R' },
  { name: 'Impossible Inferno', rarity: 'common', colors: 'R' },
  { name: 'Found Footage', rarity: 'common', colors: '' },
  { name: 'Slavering Branchsnapper', rarity: 'common', colors: 'G' },
  { name: 'Hardened Escort', rarity: 'common', colors: 'W' },
  { name: "Painter's Studio // Defaced Gallery", rarity: 'uncommon', colors: 'R' },
  { name: 'Cynical Loner', rarity: 'uncommon', colors: 'B' },
  { name: 'Orphans of the Wheat', rarity: 'uncommon', colors: 'W' },
  { name: 'Growing Dread', rarity: 'uncommon', colors: 'UB' },
  { name: 'Funeral Room // Awakening Hall', rarity: 'mythic', colors: 'WB' },
  { name: 'Forest', rarity: 'land', colors: '' }
]

const SCREEN_ORDER = [
  'Funeral Room // Awakening Hall',
  'Orphans of the Wheat',
  'Cynical Loner',
  "Painter's Studio // Defaced Gallery",
  'Growing Dread',
  'Grand Entryway // Elegant Rotunda',
  'Hardened Escort',
  'Vanish from Sight',
  'Murder',
  'Impossible Inferno',
  'Turn Inside Out',
  'Slavering Branchsnapper',
  'Found Footage',
  'Forest'
]

describe('arenaDisplayOrder', () => {
  it('reproduces the on-screen order of a real pack', () => {
    const order = arenaDisplayOrder(LOG_ORDER)
    expect(order.map(i => LOG_ORDER[i].name)).toEqual(SCREEN_ORDER)
  })

  it('reproduces the second real pack (gold pairs use Arena\'s fixed colour-order table)', () => {
    // DSK Quick Draft P1P2, log order → observed screen order (row-major).
    const log = [
      { name: 'Bashful Beastie', rarity: 'common', colors: 'G' },
      { name: 'Ticket Booth // Tunnel of Hate', rarity: 'common', colors: 'R' },
      { name: 'Cryptid Inspector', rarity: 'common', colors: 'G' },
      { name: 'Flesh Burrower', rarity: 'common', colors: 'G' },
      { name: 'Fear of Immobility', rarity: 'common', colors: 'W' },
      { name: 'Frantic Strength', rarity: 'common', colors: 'G' },
      { name: 'Balemurk Leech', rarity: 'common', colors: 'B' },
      { name: 'Creeping Peeper', rarity: 'common', colors: 'U' },
      { name: 'Shepherding Spirits', rarity: 'common', colors: 'W' },
      { name: 'Drag to the Roots', rarity: 'uncommon', colors: 'BG' },
      { name: 'Baseball Bat', rarity: 'uncommon', colors: 'WG' },
      { name: "Marina Vendrell's Grimoire", rarity: 'rare', colors: 'U' },
      { name: 'Swamp', rarity: 'land', colors: '', colorIdentity: 'B', type: 'Basic Land — Swamp' }
    ]
    expect(arenaDisplayOrder(log).map(i => log[i].name)).toEqual([
      "Marina Vendrell's Grimoire", 'Drag to the Roots', 'Baseball Bat', 'Fear of Immobility', 'Shepherding Spirits',
      'Creeping Peeper', 'Balemurk Leech', 'Ticket Booth // Tunnel of Hate', 'Bashful Beastie', 'Cryptid Inspector',
      'Flesh Burrower', 'Frantic Strength', 'Swamp'
    ])
  })

  it('files nonbasic lands in the land tier (P1P12 real pack: Clown, Glimmerlight, Murky Sewer)', () => {
    const log = [
      { name: 'Murky Sewer', rarity: 'common', colors: 'UB', type: 'Land' },
      { name: 'Glimmerlight', rarity: 'common', colors: '', type: 'Artifact — Equipment' },
      { name: 'Vicious Clown', rarity: 'common', colors: 'R', type: 'Creature — Human Clown' }
    ]
    expect(arenaDisplayOrder(log).map(i => log[i].name)).toEqual(['Vicious Clown', 'Glimmerlight', 'Murky Sewer'])
  })

  it('colour order table matches Arena (mono, pairs, colourless, basic land by identity)', () => {
    expect(colorOrder({ name: 'x', rarity: 'common', colors: 'W' })).toBe(0)
    expect(colorOrder({ name: 'x', rarity: 'common', colors: 'GB' })).toBe(10)
    expect(colorOrder({ name: 'x', rarity: 'common', colors: 'GW' })).toBe(13)
    expect(colorOrder({ name: 'x', rarity: 'common', colors: 'UG' })).toBe(14)
    expect(colorOrder({ name: 'x', rarity: 'common', colors: '' })).toBe(31)
    expect(colorOrder({ name: 'Swamp', rarity: 'land', colors: '', colorIdentity: 'B' })).toBe(2)
  })

  it('is a permutation and stable for ties', () => {
    const cards = [
      { name: null, rarity: 'common', colors: 'W' },
      { name: null, rarity: 'common', colors: 'W' },
      { name: 'A', rarity: 'rare', colors: 'W' }
    ]
    expect(arenaDisplayOrder(cards)).toEqual([2, 0, 1])
  })

  it('handles empty input', () => {
    expect(arenaDisplayOrder([])).toEqual([])
  })
})

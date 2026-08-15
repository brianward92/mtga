import { describe, expect, it } from 'vitest'
import { arenaDisplayOrder } from '../shared/display-order'

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

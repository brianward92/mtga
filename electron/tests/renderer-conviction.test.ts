/**
 * Pure conviction logic behind the badge chips and HUD: flame ratings from
 * set percentiles and head-to-head dominance bands.
 */
import { describe, it, expect } from 'vitest'
import { flamesFromPercentile } from '../renderer/overlay/flames'
import {
  sigmoid,
  dominanceFromEvs,
  runnerDominance,
  bandConviction,
  formatDominancePct
} from '../renderer/overlay/conviction'

describe('flames from set percentile', () => {
  it('maps the percentile bands, with OBVIOUS BOMB at the 99th', () => {
    expect(flamesFromPercentile(99)).toEqual({ flames: 5, label: 'OBVIOUS BOMB' })
    expect(flamesFromPercentile(98.9)).toEqual({ flames: 5, label: 'SLAM' })
    expect(flamesFromPercentile(95)).toEqual({ flames: 5, label: 'SLAM' })
    expect(flamesFromPercentile(94.9)).toEqual({ flames: 4, label: null })
    expect(flamesFromPercentile(80)).toEqual({ flames: 4, label: null })
    expect(flamesFromPercentile(60)).toEqual({ flames: 3, label: null })
    expect(flamesFromPercentile(35)).toEqual({ flames: 2, label: null })
    expect(flamesFromPercentile(10)).toEqual({ flames: 1, label: null })
  })

  it('caps the top label at SLAM for heuristic ratings', () => {
    expect(flamesFromPercentile(99, { heuristic: true })).toEqual({ flames: 5, label: 'SLAM' })
    expect(flamesFromPercentile(80, { heuristic: true })).toEqual({ flames: 4, label: null })
  })

  it('returns null without a percentile', () => {
    expect(flamesFromPercentile(null)).toBeNull()
    expect(flamesFromPercentile(undefined)).toBeNull()
    expect(flamesFromPercentile(Number.NaN)).toBeNull()
  })
})

describe('sigmoid', () => {
  it('is 0.5 at zero and saturates toward 0/1', () => {
    expect(sigmoid(0)).toBe(0.5)
    expect(sigmoid(10)).toBeGreaterThan(0.9999)
    expect(sigmoid(-10)).toBeLessThan(0.0001)
  })

  it('is symmetric: sigmoid(x) + sigmoid(-x) = 1', () => {
    for (const x of [0.1, 0.5, 1, 2.5, 7]) {
      expect(sigmoid(x) + sigmoid(-x)).toBeCloseTo(1, 12)
    }
  })
})

describe('dominanceFromEvs (top card vs the single best alternative)', () => {
  it('is the sigmoid of the gap between the two highest EVs', () => {
    expect(dominanceFromEvs([3, 1, 0])).toBeCloseTo(sigmoid(2), 12)
    expect(dominanceFromEvs([5, 5])).toBe(0.5)
  })

  it('does not depend on input order', () => {
    expect(dominanceFromEvs([0, 1, 3])).toBeCloseTo(sigmoid(2), 12)
    expect(dominanceFromEvs([1, 3, 0])).toBeCloseTo(sigmoid(2), 12)
  })

  it('excludes null/undefined/NaN EVs (unknown cards)', () => {
    expect(dominanceFromEvs([3, null, 1, undefined, Number.NaN])).toBeCloseTo(sigmoid(2), 12)
  })

  it('returns null with fewer than 2 scored cards', () => {
    expect(dominanceFromEvs([])).toBeNull()
    expect(dominanceFromEvs([3])).toBeNull()
    expect(dominanceFromEvs([3, null, undefined])).toBeNull()
  })
})

describe('runnerDominance (adjacent head-to-head)', () => {
  it("is the sigmoid of this card's EV gap to the card above", () => {
    expect(runnerDominance(1, 3)).toBeCloseTo(sigmoid(-2), 12)
    expect(runnerDominance(3, 3)).toBe(0.5)
  })

  it('returns null when either EV is missing', () => {
    expect(runnerDominance(null, 3)).toBeNull()
    expect(runnerDominance(1, null)).toBeNull()
    expect(runnerDominance(Number.NaN, 3)).toBeNull()
  })
})

describe('bandConviction (dominance x setPct grid)', () => {
  // [dominance, setPct, flames, label, showPct]
  const grid: Array<[number, number | null, number, string, boolean]> = [
    [0.99, 0.99, 5, 'OBVIOUS BOMB — just take it', true],
    [0.97, 0.98, 5, 'OBVIOUS BOMB — just take it', true],
    [0.99, 0.97, 5, 'BOMB', true],
    [0.90, 0.90, 5, 'BOMB', true],
    [0.89, 0.99, 5, 'SLAM', true],
    [0.85, 0.74, 4, 'SLAM', true],
    [0.80, 0.10, 4, 'SLAM', true],
    [0.79, 0.99, 4, 'clear pick', true],
    [0.70, 0.30, 3, 'clear pick', true],
    [0.64, 0.99, 3, 'lean', false],
    [0.56, 0.20, 2, 'lean', false]
  ]

  it('maps each (dominance, setPct) cell to its band', () => {
    for (const [dominance, setPct, flames, label, showPct] of grid) {
      const c = bandConviction(dominance, setPct)
      expect({ flames: c.flames, label: c.label, showPct: c.showPct }, `d=${dominance} sp=${setPct}`)
        .toEqual({ flames, label, showPct })
      expect(c.dominance).toBe(dominance)
      expect(c.closeCall).toBe(false)
    }
  })

  it('below 0.55 dominance is a close call', () => {
    for (const setPct of [0.99, 0.50, null]) {
      expect(bandConviction(0.54, setPct)).toMatchObject({ flames: 1, label: 'close call', closeCall: true, showPct: false })
    }
  })

  it('degrades gracefully without a set percentile', () => {
    expect(bandConviction(0.99, null)).toMatchObject({ flames: 4, label: 'SLAM', showPct: true })
    expect(bandConviction(0.70, null)).toMatchObject({ flames: 3, label: 'clear pick' })
    expect(bandConviction(0.60, null)).toMatchObject({ flames: 2, label: 'lean' })
  })

  it('caps heuristic scores at SLAM', () => {
    expect(bandConviction(0.99, 0.99, { heuristic: true })).toMatchObject({ flames: 5, label: 'SLAM', showPct: true })
    expect(bandConviction(0.70, 0.65, { heuristic: true })).toMatchObject({ flames: 4, label: 'clear pick' })
  })
})

describe('formatDominancePct', () => {
  it('rounds to a whole percent and never claims 100%', () => {
    expect(formatDominancePct(0.84)).toBe('84%')
    expect(formatDominancePct(0.994)).toBe('99%')
    expect(formatDominancePct(0.995)).toBe('>99%')
    expect(formatDominancePct(0.5)).toBe('50%')
  })
})

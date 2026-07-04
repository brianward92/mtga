/**
 * Pure UI logic for the draft overlay: density cycling, flame ratings, and
 * conviction bands (head-to-head dominance + set percentile).
 */

import { describe, it, expect } from 'vitest'
import {
  nextDensity,
  normalizeDensity,
  densityClass,
  densityTitle,
  DENSITY_CYCLE,
  Density
} from '../renderer/overlay/density'
import {
  flamesFromPercentile,
  percentileOf
} from '../renderer/overlay/flames'
import {
  sigmoid,
  dominanceFromEvs,
  runnerDominance,
  percentileOfSortedAsc,
  bandConviction,
  formatDominancePct,
  formatSplit
} from '../renderer/overlay/conviction'

describe('density cycling', () => {
  it('cycles verdict -> full -> mini -> verdict', () => {
    expect(nextDensity('verdict')).toBe('full')
    expect(nextDensity('full')).toBe('mini')
    expect(nextDensity('mini')).toBe('verdict')
  })

  it('a full cycle returns to the start for every density', () => {
    for (const start of DENSITY_CYCLE) {
      let d: Density = start
      for (let i = 0; i < DENSITY_CYCLE.length; i++) d = nextDensity(d)
      expect(d).toBe(start)
    }
  })

  it('normalizes persisted values, defaulting to verdict', () => {
    expect(normalizeDensity('full')).toBe('full')
    expect(normalizeDensity('mini')).toBe('mini')
    expect(normalizeDensity('verdict')).toBe('verdict')
    expect(normalizeDensity('header-only')).toBe('verdict')
    expect(normalizeDensity(undefined)).toBe('verdict')
    expect(normalizeDensity(null)).toBe('verdict')
    expect(normalizeDensity(42)).toBe('verdict')
  })

  it('maps densities to CSS classes', () => {
    expect(densityClass('verdict')).toBe('density-verdict')
    expect(densityClass('full')).toBe('density-full')
    expect(densityClass('mini')).toBe('density-mini')
  })

  it('titles name the current view and the next one', () => {
    expect(densityTitle('verdict')).toContain('Verdict')
    expect(densityTitle('verdict')).toContain('Full')
    expect(densityTitle('mini')).toContain('Verdict')
  })
})

describe('flames from tier percentile (P1P1)', () => {
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
    expect(flamesFromPercentile(99.9, { heuristic: true })).toEqual({ flames: 5, label: 'SLAM' })
    expect(flamesFromPercentile(95, { heuristic: true })).toEqual({ flames: 5, label: 'SLAM' })
    expect(flamesFromPercentile(80, { heuristic: true })).toEqual({ flames: 4, label: null })
  })

  it('returns null without a percentile', () => {
    expect(flamesFromPercentile(null)).toBeNull()
    expect(flamesFromPercentile(undefined)).toBeNull()
  })
})

describe('percentileOf', () => {
  it('computes the fraction of the population strictly below', () => {
    const population = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    expect(percentileOf(10, population)).toBe(90)
    expect(percentileOf(1, population)).toBe(0)
    expect(percentileOf(5.5, population)).toBe(50)
  })

  it('ignores non-finite values and handles empty populations', () => {
    expect(percentileOf(5, [])).toBeNull()
    expect(percentileOf(5, [Number.NaN])).toBeNull()
    expect(percentileOf(5, [1, Number.NaN, 9])).toBe(50)
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

  it('matches known logit gaps', () => {
    expect(sigmoid(Math.log(3))).toBeCloseTo(0.75, 12) // 3:1 odds
    expect(sigmoid(2)).toBeCloseTo(0.8807970779778823, 12)
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

  it('returns null with fewer than 2 scored cards (caller falls back to percentiles)', () => {
    expect(dominanceFromEvs([])).toBeNull()
    expect(dominanceFromEvs([3])).toBeNull()
    expect(dominanceFromEvs([3, null, undefined])).toBeNull()
  })
})

describe('runnerDominance (adjacent head-to-head)', () => {
  it('is the sigmoid of this card\'s EV gap to the card above', () => {
    expect(runnerDominance(1, 3)).toBeCloseTo(sigmoid(-2), 12)
    expect(runnerDominance(3, 3)).toBe(0.5)
  })

  it('adjacent gaps chain down the ranked list', () => {
    const evs = [4, 2.5, 2.4, -1]
    const pcts = evs.slice(1).map((ev, i) => runnerDominance(ev, evs[i]))
    expect(pcts[0]).toBeCloseTo(sigmoid(-1.5), 12)
    expect(pcts[1]).toBeCloseTo(sigmoid(-0.1), 12)
    expect(pcts[2]).toBeCloseTo(sigmoid(-3.4), 12)
  })

  it('returns null when either EV is missing', () => {
    expect(runnerDominance(null, 3)).toBeNull()
    expect(runnerDominance(1, null)).toBeNull()
    expect(runnerDominance(1, undefined)).toBeNull()
    expect(runnerDominance(Number.NaN, 3)).toBeNull()
  })
})

describe('percentileOfSortedAsc (cached set-wide ev_p1p1)', () => {
  const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

  it('returns the fraction strictly below (0..1)', () => {
    expect(percentileOfSortedAsc(10, sorted)).toBe(0.9)
    expect(percentileOfSortedAsc(1, sorted)).toBe(0)
    expect(percentileOfSortedAsc(5.5, sorted)).toBe(0.5)
    expect(percentileOfSortedAsc(11, sorted)).toBe(1)
    expect(percentileOfSortedAsc(0, sorted)).toBe(0)
  })

  it('counts duplicates below, not equal', () => {
    expect(percentileOfSortedAsc(2, [1, 2, 2, 2, 3])).toBe(0.2)
  })

  it('agrees with the linear percentileOf', () => {
    for (const v of [0, 1, 3.5, 7, 10, 12]) {
      expect((percentileOfSortedAsc(v, sorted) as number) * 100).toBe(percentileOf(v, sorted))
    }
  })

  it('handles empty populations and non-finite values', () => {
    expect(percentileOfSortedAsc(5, [])).toBeNull()
    expect(percentileOfSortedAsc(Number.NaN, sorted)).toBeNull()
  })
})

describe('bandConviction (dominance x setPct grid)', () => {
  // [dominance, setPct, flames, label, showPct]
  const grid: Array<[number, number | null, number, string, boolean]> = [
    // OBVIOUS BOMB: crushes the pack AND top of the set
    [0.99, 0.99, 5, 'OBVIOUS BOMB — just take it', true],
    [0.97, 0.98, 5, 'OBVIOUS BOMB — just take it', true],
    // BOMB: one threshold short of obvious
    [0.99, 0.97, 5, 'BOMB', true],
    [0.96, 0.98, 5, 'BOMB', true],
    [0.90, 0.90, 5, 'BOMB', true],
    // SLAM: pack-dominant; 5th flame needs setPct >= 0.75
    [0.89, 0.99, 5, 'SLAM', true],
    [0.92, 0.80, 5, 'SLAM', true],
    [0.85, 0.74, 4, 'SLAM', true],
    [0.80, 0.10, 4, 'SLAM', true],
    // clear pick: 4th flame needs setPct >= 0.60
    [0.79, 0.99, 4, 'clear pick', true],
    [0.70, 0.60, 4, 'clear pick', true],
    [0.70, 0.30, 3, 'clear pick', true],
    [0.65, 0.10, 3, 'clear pick', true],
    // lean: no headline percentage
    [0.64, 0.99, 3, 'lean', false],
    [0.60, 0.50, 3, 'lean', false],
    [0.56, 0.20, 2, 'lean', false],
    [0.55, 0.10, 2, 'lean', false]
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

  it('below 0.55 dominance is a close call (top-2 side by side)', () => {
    for (const setPct of [0.99, 0.50, null]) {
      const c = bandConviction(0.54, setPct)
      expect(c).toMatchObject({ flames: 1, label: 'close call', closeCall: true, showPct: false })
    }
    expect(bandConviction(0.5, 0.99).closeCall).toBe(true)
  })

  it('degrades gracefully without a set percentile (setPct = null)', () => {
    // OBVIOUS BOMB/BOMB are unreachable; setPct-gated flames take the low side
    expect(bandConviction(0.99, null)).toMatchObject({ flames: 4, label: 'SLAM', showPct: true })
    expect(bandConviction(0.92, null)).toMatchObject({ flames: 4, label: 'SLAM' })
    expect(bandConviction(0.70, null)).toMatchObject({ flames: 3, label: 'clear pick' })
    expect(bandConviction(0.60, null)).toMatchObject({ flames: 2, label: 'lean' })
  })

  it('caps heuristic scores at SLAM (z-scores are not trained logits)', () => {
    expect(bandConviction(0.99, 0.99, { heuristic: true }))
      .toMatchObject({ flames: 5, label: 'SLAM', showPct: true })
    expect(bandConviction(0.92, 0.95, { heuristic: true }))
      .toMatchObject({ flames: 5, label: 'SLAM' })
    // Lower bands are unaffected by the guard
    expect(bandConviction(0.70, 0.65, { heuristic: true }))
      .toMatchObject({ flames: 4, label: 'clear pick' })
    expect(bandConviction(0.54, 0.99, { heuristic: true }))
      .toMatchObject({ flames: 1, label: 'close call', closeCall: true })
  })
})

describe('dominance formatting', () => {
  it('rounds to a whole percent and never claims 100%', () => {
    expect(formatDominancePct(0.84)).toBe('84%')
    expect(formatDominancePct(0.994)).toBe('99%')
    expect(formatDominancePct(0.995)).toBe('>99%')
    expect(formatDominancePct(0.9999)).toBe('>99%')
    expect(formatDominancePct(0.5)).toBe('50%')
  })

  it('formats the close-call pairwise split', () => {
    expect(formatSplit(0.52)).toEqual(['52', '48'])
    expect(formatSplit(0.5)).toEqual(['50', '50'])
  })
})

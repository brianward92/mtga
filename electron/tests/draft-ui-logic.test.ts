/**
 * Pure UI logic for the draft overlay: density cycling and flame ratings.
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
  flamesFromProb,
  flamesFromPercentile,
  percentileOf
} from '../renderer/overlay/flames'

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

describe('flames from model probability', () => {
  it('maps the conviction bands', () => {
    expect(flamesFromProb(0.9)).toEqual({ flames: 5, label: 'SLAM' })
    expect(flamesFromProb(0.70)).toEqual({ flames: 5, label: 'SLAM' })
    expect(flamesFromProb(0.69)).toEqual({ flames: 4, label: null })
    expect(flamesFromProb(0.50)).toEqual({ flames: 4, label: null })
    expect(flamesFromProb(0.49)).toEqual({ flames: 3, label: null })
    expect(flamesFromProb(0.35)).toEqual({ flames: 3, label: null })
    expect(flamesFromProb(0.34)).toEqual({ flames: 2, label: null })
    expect(flamesFromProb(0.25)).toEqual({ flames: 2, label: null })
    expect(flamesFromProb(0.24)).toEqual({ flames: 1, label: 'close call' })
    expect(flamesFromProb(0)).toEqual({ flames: 1, label: 'close call' })
  })

  it('returns null when no probability is available', () => {
    expect(flamesFromProb(null)).toBeNull()
    expect(flamesFromProb(undefined)).toBeNull()
    expect(flamesFromProb(Number.NaN)).toBeNull()
  })
})

describe('flames from tier percentile (P1P1)', () => {
  it('maps the percentile bands', () => {
    expect(flamesFromPercentile(99)).toEqual({ flames: 5, label: 'SLAM' })
    expect(flamesFromPercentile(95)).toEqual({ flames: 5, label: 'SLAM' })
    expect(flamesFromPercentile(94.9)).toEqual({ flames: 4, label: null })
    expect(flamesFromPercentile(80)).toEqual({ flames: 4, label: null })
    expect(flamesFromPercentile(60)).toEqual({ flames: 3, label: null })
    expect(flamesFromPercentile(35)).toEqual({ flames: 2, label: null })
    expect(flamesFromPercentile(10)).toEqual({ flames: 1, label: null })
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

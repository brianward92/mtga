import { describe, expect, it } from 'vitest'
import { GRADE_FLOORS, gradeForPercentile, percentileOf, gradeTier } from '../shared/grades'

describe('paper letter ladder', () => {
  it('bands sum to 100 and floors descend', () => {
    expect(GRADE_FLOORS[0]).toEqual({ grade: 'A+', minimum: 0.98 })
    expect(GRADE_FLOORS[GRADE_FLOORS.length - 1]).toEqual({ grade: 'F', minimum: 0 })
    for (let i = 1; i < GRADE_FLOORS.length; i++) expect(GRADE_FLOORS[i].minimum).toBeLessThan(GRADE_FLOORS[i - 1].minimum)
  })
  it('assigns letters by percentile', () => {
    expect(gradeForPercentile(0.999)).toBe('A+')
    expect(gradeForPercentile(0.95)).toBe('A')
    expect(gradeForPercentile(0.90)).toBe('A-')
    expect(gradeForPercentile(0.82)).toBe('B+')
    expect(gradeForPercentile(0.70)).toBe('B')
    expect(gradeForPercentile(0.58)).toBe('B-')
    expect(gradeForPercentile(0.45)).toBe('C+')
    expect(gradeForPercentile(0.30)).toBe('C')
    expect(gradeForPercentile(0.18)).toBe('C-')
    expect(gradeForPercentile(0.10)).toBe('D+')
    expect(gradeForPercentile(0.05)).toBe('D')
    expect(gradeForPercentile(0.02)).toBe('D-')
    expect(gradeForPercentile(0.0)).toBe('F')
    expect(gradeForPercentile(1.5)).toBe('A+')
    expect(gradeForPercentile(-1)).toBe('F')
  })
  it('percentileOf = fraction strictly below', () => {
    const s = [1, 2, 3, 4, 5]
    expect(percentileOf(3, s)).toBeCloseTo(0.4, 9)
    expect(percentileOf(0, s)).toBe(0)
    expect(percentileOf(9, s)).toBe(1)
    expect(percentileOf(1, [])).toBe(0)
  })
  it('tiers', () => {
    expect(gradeTier('A-')).toBe('a'); expect(gradeTier('B+')).toBe('b'); expect(gradeTier('C')).toBe('c'); expect(gradeTier('F')).toBe('d')
  })
})

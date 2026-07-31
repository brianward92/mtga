import { describe, expect, it } from 'vitest'
import {
  modelGradeForScore,
  modelGradeFromPercentile,
  modelGradeTitle
} from '../renderer/overlay/grades'

describe('set-relative model grades', () => {
  const cases = [
    [0.96, 'A'],
    [0.90, 'A-'],
    [0.83, 'B+'],
    [0.76, 'B'],
    [0.70, 'B-'],
    [0.58, 'C+'],
    [0.45, 'C'],
    [0.35, 'C-'],
    [0.22, 'D+'],
    [0.10, 'D'],
    [0.05, 'D-'],
    [0, 'F']
  ] as const

  it('uses the declared subgrade boundaries', () => {
    for (const [percentile, grade] of cases) {
      expect(modelGradeFromPercentile(percentile)?.grade, String(percentile)).toBe(grade)
    }
  })

  it('never invents A+ from a relative model percentile', () => {
    for (let i = 0; i <= 100; i++) {
      expect(modelGradeFromPercentile(i / 100)?.grade).not.toBe('A+')
    }
  })

  it('is invariant to positive affine transforms of the raw logits', () => {
    const scores = Array.from({ length: 101 }, (_, i) => i - 50)
    const transformed = scores.map(value => value * 7.5 + 123)
    for (const index of [0, 5, 10, 22, 35, 45, 58, 70, 76, 83, 90, 96, 100]) {
      expect(modelGradeForScore(transformed[index], transformed)?.grade)
        .toBe(modelGradeForScore(scores[index], scores)?.grade)
    }
  })

  it('returns null without a finite score and explains the source when present', () => {
    expect(modelGradeForScore(null, [1, 2, 3])).toBeNull()
    expect(modelGradeForScore(2, null)).toBeNull()
    expect(modelGradeFromPercentile(Number.NaN)).toBeNull()
    const result = modelGradeForScore(3, [1, 2, 3])!
    expect(modelGradeTitle(result)).toContain('P1P1 model grade')
    expect(modelGradeTitle(result)).toContain('your pool')
  })
})

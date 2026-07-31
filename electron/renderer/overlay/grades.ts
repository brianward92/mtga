import { percentileOfSortedAsc } from './conviction'

/** Set-relative P1P1 quality bands. Model-only grades intentionally stop at A. */
export type ModelGrade = 'A' | 'A-' | 'B+' | 'B' | 'B-' | 'C+' | 'C' | 'C-' | 'D+' | 'D' | 'D-' | 'F'

export interface ModelGradeResult {
  grade: ModelGrade
  /** Fraction of unique cards in the set scored strictly below this card. */
  percentile: number
}

const GRADE_BANDS: ReadonlyArray<{ minimum: number; grade: ModelGrade }> = [
  { minimum: 0.96, grade: 'A' },
  { minimum: 0.90, grade: 'A-' },
  { minimum: 0.83, grade: 'B+' },
  { minimum: 0.76, grade: 'B' },
  { minimum: 0.70, grade: 'B-' },
  { minimum: 0.58, grade: 'C+' },
  { minimum: 0.45, grade: 'C' },
  { minimum: 0.35, grade: 'C-' },
  { minimum: 0.22, grade: 'D+' },
  { minimum: 0.10, grade: 'D' },
  { minimum: 0.05, grade: 'D-' },
  { minimum: 0, grade: 'F' }
]

export function modelGradeFromPercentile(percentile: number | null | undefined): ModelGradeResult | null {
  if (percentile === null || percentile === undefined || !Number.isFinite(percentile)) return null
  const bounded = Math.min(1, Math.max(0, percentile))
  const band = GRADE_BANDS.find(candidate => bounded >= candidate.minimum)
  return { grade: band?.grade ?? 'F', percentile: bounded }
}

/** Grade an intrinsic P1P1 score; live pool-conditioned scores are not used. */
export function modelGradeForScore(
  score: number | null | undefined,
  setScoresSorted: number[] | null | undefined
): ModelGradeResult | null {
  if (score === null || score === undefined || !Number.isFinite(score) || !setScoresSorted) return null
  return modelGradeFromPercentile(percentileOfSortedAsc(score, setScoresSorted))
}

export function modelGradeTitle(result: ModelGradeResult): string {
  const percentile = Math.round(result.percentile * 100)
  return `Set-relative P1P1 model grade (${percentile}th percentile). Live rank also considers this pack and your pool.`
}

export function modelGradeClass(grade: ModelGrade): string {
  return `grade-${grade[0].toLowerCase()}`
}

/**
 * The paper's frozen 13-level letter ladder (draftfm.tex, tab:letter-ladder):
 * fixed percentile bands of the scored set universe, assigned by rank.
 * Shares from the top: A+ 2, A 3, A- 5, B+ 8, B 12, B- 12, C+ 13, C 15,
 * C- 12, D+ 8, D 5, D- 3, F 2 (sums to 100).
 */
export type Grade = 'A+' | 'A' | 'A-' | 'B+' | 'B' | 'B-' | 'C+' | 'C' | 'C-' | 'D+' | 'D' | 'D-' | 'F'

const SHARES: Array<[Grade, number]> = [
  ['A+', 2], ['A', 3], ['A-', 5], ['B+', 8], ['B', 12], ['B-', 12], ['C+', 13],
  ['C', 15], ['C-', 12], ['D+', 8], ['D', 5], ['D-', 3], ['F', 2]
]

/** Minimum percentile (0..1, fraction of the universe strictly below) per grade. */
export const GRADE_FLOORS: Array<{ grade: Grade; minimum: number }> = (() => {
  const out: Array<{ grade: Grade; minimum: number }> = []
  let above = 0
  for (const [grade, share] of SHARES) {
    above += share
    out.push({ grade, minimum: (100 - above) / 100 })
  }
  return out
})()

/** Letter for a set-relative percentile (0..1). */
export function gradeForPercentile(percentile: number): Grade {
  const p = Math.min(1, Math.max(0, percentile))
  for (const band of GRADE_FLOORS) if (p >= band.minimum) return band.grade
  return 'F'
}

/** Fraction of `sortedAsc` strictly below `value` (percentile in 0..1). */
export function percentileOf(value: number, sortedAsc: ArrayLike<number>): number {
  const n = sortedAsc.length
  if (!n) return 0
  let lo = 0, hi = n
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (sortedAsc[mid] < value) lo = mid + 1
    else hi = mid
  }
  return lo / n
}

/** Coarse tier for colouring: A / B / C / D-F. */
export function gradeTier(grade: Grade): 'a' | 'b' | 'c' | 'd' {
  const c = grade[0]
  return c === 'A' ? 'a' : c === 'B' ? 'b' : c === 'C' ? 'c' : 'd'
}

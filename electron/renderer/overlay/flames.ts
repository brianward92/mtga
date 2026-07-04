/**
 * Flame ratings (pure logic — unit tested).
 *
 * The Verdict view speaks heat, not numbers: model conviction becomes a
 * 1-5 flame rating. Two sources:
 *   - live scores: the model's within-pack pick probability (`prob`, 0..1)
 *   - P1P1 tier list: the card's ev_p1p1 percentile within the set
 */

export interface FlameRating {
  /** 1..5 filled flames */
  flames: number
  /** 'SLAM' at 5, 'close call' at 1, otherwise null */
  label: string | null
}

/**
 * Flames from the model's within-pack pick probability.
 *   >= 0.70 -> 5 "SLAM"
 *   >= 0.50 -> 4
 *   >= 0.35 -> 3
 *   >= 0.25 -> 2
 *   below   -> 1 "close call" (verdict view shows top-2 side by side)
 */
export function flamesFromProb(prob: number | null | undefined): FlameRating | null {
  if (prob === null || prob === undefined || !Number.isFinite(prob)) return null
  if (prob >= 0.70) return { flames: 5, label: 'SLAM' }
  if (prob >= 0.50) return { flames: 4, label: null }
  if (prob >= 0.35) return { flames: 3, label: null }
  if (prob >= 0.25) return { flames: 2, label: null }
  return { flames: 1, label: 'close call' }
}

/**
 * Percentile (0..100) of `value` within `population` (fraction of values
 * strictly below it). Empty population -> null.
 */
export function percentileOf(value: number, population: readonly number[]): number | null {
  const finite = population.filter(v => Number.isFinite(v))
  if (finite.length === 0) return null
  const below = finite.filter(v => v < value).length
  return (below / finite.length) * 100
}

/**
 * Flames for P1P1 tier-list mode, from the card's ev_p1p1 percentile within
 * the set: >=95 -> 5, >=80 -> 4, >=60 -> 3, >=35 -> 2, else 1.
 */
export function flamesFromPercentile(percentile: number | null | undefined): FlameRating | null {
  if (percentile === null || percentile === undefined || !Number.isFinite(percentile)) return null
  if (percentile >= 95) return { flames: 5, label: 'SLAM' }
  if (percentile >= 80) return { flames: 4, label: null }
  if (percentile >= 60) return { flames: 3, label: null }
  if (percentile >= 35) return { flames: 2, label: null }
  return { flames: 1, label: null }
}

/**
 * Flame ratings (pure logic — unit tested).
 *
 * The overlay speaks heat, not numbers: model conviction becomes a 1-5
 * flame rating. The top pick of a scored pack uses head-to-head dominance
 * bands (see conviction.ts); this module covers the percentile-based
 * ratings — a card's set-relative P1P1 percentile (chips for runner-ups,
 * hover detail, and the top card while fewer than 2 EVs are known).
 */
import { isFiniteNumber } from './shared'

/** Percentile-derived flame count and optional headline label. */
export interface FlameRating {
  /** 1..5 filled flames */
  flames: number
  /** Band label ('OBVIOUS BOMB' / 'SLAM' at the top), otherwise null */
  label: string | null
}

/**
 * Flames from a card's ev_p1p1 percentile (0..100) within the set:
 * >=99 -> 5 "OBVIOUS BOMB", >=95 -> 5 "SLAM", >=80 -> 4, >=60 -> 3,
 * >=35 -> 2, else 1.
 *
 * Honesty guard: `heuristic` caps the label at SLAM — heuristic/fallback
 * EVs are z-scores, not trained logits, so we never claim OBVIOUS BOMB.
 */
export function flamesFromPercentile(
  percentile: number | null | undefined,
  opts: { heuristic?: boolean } = {}
): FlameRating | null {
  if (!isFiniteNumber(percentile)) return null
  if (percentile >= 99) return { flames: 5, label: opts.heuristic ? 'SLAM' : 'OBVIOUS BOMB' }
  if (percentile >= 95) return { flames: 5, label: 'SLAM' }
  if (percentile >= 80) return { flames: 4, label: null }
  if (percentile >= 60) return { flames: 3, label: null }
  if (percentile >= 35) return { flames: 2, label: null }
  return { flames: 1, label: null }
}

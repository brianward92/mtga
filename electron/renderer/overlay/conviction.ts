/**
 * Pick conviction (pure logic — unit tested).
 *
 * The overlay's headline number is head-to-head **dominance**, not the
 * model's within-pack softmax. Softmax understates obviousness: a dominant
 * bomb in a 14-card pack reads "66%" only because probability mass spreads
 * over 13 alternatives. Dominance asks the sharper question — what is the
 * model's probability of the top card over the single best alternative?
 *
 *   dominance = sigmoid(ev_A - ev_B)   (A = top card, B = runner-up, by EV)
 *
 * Bands additionally consult **setPct** — the top card's ev_p1p1 percentile
 * across the whole set (0..1) — so "OBVIOUS BOMB" is reserved for cards that
 * both crush their pack and sit at the very top of the format.
 *
 * Honesty guard: heuristic/fallback EVs are z-scores, not trained logits, so
 * their sigmoid gaps aren't calibrated probabilities. `heuristic: true` caps
 * the label at SLAM (never OBVIOUS BOMB / BOMB).
 */
import { isFiniteNumber } from './shared'

/** Display band derived from head-to-head model dominance. */
export interface Conviction {
  /** 1..5 filled flames */
  flames: number
  /** Band label shown next to the flames. */
  label: string
  /** Head-to-head probability of the top card over the runner-up (0..1). */
  dominance: number
  /** Whether the headline shows the dominance percentage. */
  showPct: boolean
  /** Render the top two side by side with their pairwise split. */
  closeCall: boolean
}

/** Logistic transform used to turn an EV gap into pairwise dominance. */
export function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x))
}

/**
 * Head-to-head probability of the best card over the single best
 * alternative: sigmoid of the gap between the two highest finite EVs.
 * Null EVs (unknown cards) are excluded; fewer than 2 scored cards -> null
 * (caller falls back to tier/percentile display).
 */
export function dominanceFromEvs(evs: ReadonlyArray<number | null | undefined>): number | null {
  const finite = evs
    .filter(isFiniteNumber)
    .sort((a, b) => b - a)
  if (finite.length < 2) return null
  return sigmoid(finite[0] - finite[1])
}

/**
 * A runner-up's own head-to-head vs the card ranked directly above it:
 * sigmoid(ev - evAbove), i.e. <= 0.5 (a 49% runner-up is nearly a coin flip,
 * a 5% runner-up is far behind). Null when either EV is missing.
 */
export function runnerDominance(
  ev: number | null | undefined,
  evAbove: number | null | undefined
): number | null {
  if (!isFiniteNumber(ev) || !isFiniteNumber(evAbove)) return null
  return sigmoid(ev - evAbove)
}

/**
 * The display band for a scored pack.
 *
 *   dominance >= 0.97 && setPct >= 0.98 -> OBVIOUS BOMB — just take it, 5 flames, pct
 *   dominance >= 0.90 && setPct >= 0.90 -> BOMB, 5 flames, pct
 *   dominance >= 0.80                   -> SLAM, 5 flames if setPct >= 0.75 else 4, pct
 *   dominance >= 0.65                   -> clear pick, 4 flames if setPct >= 0.60 else 3, pct
 *   dominance >= 0.55                   -> lean, 3 flames if setPct >= 0.50 else 2, no pct
 *   else                                -> close call, 1 flame, top-2 pairwise split
 *
 * setPct = null degrades every setPct condition to false (OBVIOUS BOMB and
 * BOMB become unreachable; SLAM/clear pick/lean take their lower flame count).
 * heuristic = true additionally caps the band at SLAM.
 */
export function bandConviction(
  dominance: number,
  setPct: number | null,
  opts: { heuristic?: boolean } = {}
): Conviction {
  const sp = setPct !== null && Number.isFinite(setPct) ? setPct : null
  const heuristic = opts.heuristic === true

  if (!heuristic && dominance >= 0.97 && sp !== null && sp >= 0.98) {
    return { flames: 5, label: 'OBVIOUS BOMB — just take it', dominance, showPct: true, closeCall: false }
  }
  if (!heuristic && dominance >= 0.90 && sp !== null && sp >= 0.90) {
    return { flames: 5, label: 'BOMB', dominance, showPct: true, closeCall: false }
  }
  // Heuristic packs that would have been OBVIOUS BOMB/BOMB land here (>= 0.80)
  if (dominance >= 0.80) {
    return { flames: sp !== null && sp >= 0.75 ? 5 : 4, label: 'SLAM', dominance, showPct: true, closeCall: false }
  }
  if (dominance >= 0.65) {
    return { flames: sp !== null && sp >= 0.60 ? 4 : 3, label: 'clear pick', dominance, showPct: true, closeCall: false }
  }
  if (dominance >= 0.55) {
    return { flames: sp !== null && sp >= 0.50 ? 3 : 2, label: 'lean', dominance, showPct: false, closeCall: false }
  }
  return { flames: 1, label: 'close call', dominance, showPct: false, closeCall: true }
}

/** '84%'; saturates at '>99%' so a huge gap never reads as a false '100%'. */
export function formatDominancePct(dominance: number): string {
  const pct = Math.round(dominance * 100)
  return pct >= 100 ? '>99%' : `${pct}%`
}

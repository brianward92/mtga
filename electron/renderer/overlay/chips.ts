/**
 * Badge chip models (pure logic — unit tested).
 *
 * One model per pack card, in the STATE's card order (the badge layer maps
 * them onto Arena's display cells). Speaks the same conviction language as
 * the HUD (conviction.ts / flames.ts — never re-derived):
 *
 *   top pick   — conviction flames + band label (LEAN/SLAM/…) + head-to-head
 *                dominance % over the runner-up (when the band shows one)
 *   the rest   — set-percentile flames + head-to-head % vs the card ranked
 *                directly above
 *   unknown    — frame only (no grade, no scores)
 *
 * While `scoring` is true the live numbers (rank, %, label) are withheld —
 * only the intrinsic grade/flames (stable across picks) remain, and the chip
 * shimmers so nobody reads a stale figure.
 */
import type { CardRow } from '../../shared/state'
import { gradeTier, type Grade } from '../../shared/grades'
import { bandConviction, dominanceFromEvs, formatDominancePct, runnerDominance } from './conviction'
import { flamesFromPercentile } from './flames'
import { isFiniteNumber } from './shared'

/** Visual tier used to tint badge frames and chips. */
export type Tier = 'top' | 'a' | 'b' | 'c' | 'd'

/** Render-ready badge content for one card in state order. */
export interface ChipModel {
  /** Frame tint; null → neutral hairline frame only. */
  tier: Tier | null
  /** Draw the chip at all (grade/flames/pct present). */
  chip: boolean
  grade: Grade | null
  /** 1..5 lit flames, null when unknown. */
  flames: number | null
  /** Conviction band label for the top pick (LEAN, SLAM, …), null otherwise. */
  label: string | null
  /** Head-to-head % text ('84%'), null when not shown. */
  pct: string | null
  /** 1-based rank within the pack, null before scores. */
  rank: number | null
  top: boolean
  shimmer: boolean
}

/** Short uppercase label for the frame's corner tag ('clear pick' → 'CLEAR PICK'). */
export function shortBandLabel(label: string): string {
  const cut = label.split('—')[0].trim()
  return cut.toUpperCase()
}

/**
 * Cards ordered by the model's ranking: explicit `rank` first, then by ev
 * (desc), unscored last. Returns indexes into `cards`.
 */
export function rankOrder(cards: ReadonlyArray<CardRow>): number[] {
  return cards
    .map((c, i) => ({ c, i }))
    .sort((a, b) => {
      const ar = isFiniteNumber(a.c.rank) ? a.c.rank : null
      const br = isFiniteNumber(b.c.rank) ? b.c.rank : null
      if (ar !== null && br !== null && ar !== br) return ar - br
      if (ar !== null && br === null) return -1
      if (ar === null && br !== null) return 1
      const ae = isFiniteNumber(a.c.ev) ? a.c.ev : null
      const be = isFiniteNumber(b.c.ev) ? b.c.ev : null
      if (ae !== null && be !== null && ae !== be) return be - ae
      if (ae !== null && be === null) return -1
      if (ae === null && be !== null) return 1
      return a.i - b.i
    })
    .map(e => e.i)
}

/** Build one badge model per card while withholding stale live scores. */
export function buildChips(cards: ReadonlyArray<CardRow>, scoring: boolean): ChipModel[] {
  const order = rankOrder(cards)
  const positionOf = new Map(order.map((cardIndex, pos) => [cardIndex, pos]))
  const scored = !scoring && cards.some(c => isFiniteNumber(c.ev))
  const dominance = scored ? dominanceFromEvs(cards.map(c => c.ev)) : null
  const topIndex = order[0] ?? -1
  const top = topIndex >= 0 ? cards[topIndex] : null
  const conviction = scored && dominance !== null && top && isFiniteNumber(top.ev)
    ? bandConviction(dominance, isFiniteNumber(top.percentile) ? top.percentile : null)
    : null

  return cards.map((card, index) => {
    const pos = positionOf.get(index) ?? -1
    const rating = isFiniteNumber(card.percentile) ? flamesFromPercentile(card.percentile * 100) : null
    const grade = card.grade ?? null
    const isTop = scored && pos === 0 && isFiniteNumber(card.ev)
    const rank = scored && pos >= 0 && isFiniteNumber(card.ev) ? pos + 1 : null

    if (isTop) {
      const flames = conviction ? conviction.flames : rating?.flames ?? null
      const label = conviction ? shortBandLabel(conviction.label) : rating?.label ?? null
      const pct = conviction && conviction.showPct ? formatDominancePct(conviction.dominance) : null
      return { tier: 'top', chip: true, grade, flames, label, pct, rank: 1, top: true, shimmer: false }
    }

    let pct: string | null = null
    if (scored && pos > 0) {
      const above = cards[order[pos - 1]]
      const h2h = runnerDominance(card.ev, above.ev)
      if (h2h !== null) pct = formatDominancePct(h2h)
    }

    const known = grade !== null || rating !== null || pct !== null
    if (!known) {
      return { tier: null, chip: false, grade: null, flames: null, label: null, pct: null, rank: null, top: false, shimmer: scoring }
    }
    return {
      tier: grade ? gradeTier(grade) : rating ? flameTier(rating.flames) : 'c',
      chip: true,
      grade,
      flames: rating?.flames ?? null,
      label: null,
      pct,
      rank,
      top: false,
      shimmer: scoring
    }
  })
}

function flameTier(flames: number): Tier {
  return flames >= 4 ? 'a' : flames >= 3 ? 'b' : flames >= 2 ? 'c' : 'd'
}

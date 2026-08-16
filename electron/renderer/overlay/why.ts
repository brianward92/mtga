/**
 * Compact recommendation explanations (pure logic -- unit tested).
 *
 * Every clause names evidence the renderer actually has. In particular,
 * mechanics are only lightweight name/type hooks: this module never guesses
 * at rules text that is not present in CardRow.
 */
import type { CardRow } from '../../shared/state'
import { laneLean, poolSummary } from './hud-logic'
import { isFiniteNumber } from './shared'

type ProbabilityCard = Pick<CardRow, 'prob' | 'rank'>
type HookCard = Pick<CardRow, 'name' | 'type'>
type PoolCard = Pick<CardRow, 'name' | 'colors' | 'type'>
type WhyCard = ProbabilityCard & PoolCard

/** Mechanics that may be surfaced from a literal card-name/type match. */
const WHY_HOOKS = ['Eerie', 'Room', 'Delirium', 'Survival'] as const
type WhyHook = (typeof WHY_HOOKS)[number]

const HOOK_PATTERNS: Readonly<Record<WhyHook, RegExp>> = {
  Eerie: /\beerie\b/i,
  Room: /\broom\b/i,
  Delirium: /\bdelirium\b/i,
  Survival: /\bsurvival\b/i
}

function validProbability(prob: number | null | undefined): prob is number {
  return isFiniteNumber(prob) && prob >= 0 && prob <= 1
}

function rankLabel(card: Pick<CardRow, 'rank'>, fallback: string): string {
  return isFiniteNumber(card.rank) && Number.isInteger(card.rank) && card.rank >= 1
    ? `#${card.rank}`
    : fallback
}

/**
 * The #1/#2 pick-probability gap, in percentage points.
 *
 * The point difference is calculated directly from CardRow.prob. Invalid or
 * reversed pairs are treated as incoherent rather than described as an edge.
 */
function probabilityGapClause(top: ProbabilityCard, runnerUp: ProbabilityCard | null): string | null {
  if (!runnerUp) return null
  if (!validProbability(top.prob) || !validProbability(runnerUp.prob) || top.prob < runnerUp.prob) return null

  const topLabel = rankLabel(top, 'top pick')
  const runnerLabel = rankLabel(runnerUp, 'runner-up')
  const rawGap = (top.prob - runnerUp.prob) * 100
  if (rawGap === 0) return `${topLabel} tied with ${runnerLabel} on pick probability`
  const roundedGap = Math.round(rawGap)
  const gapLabel = roundedGap === 0 ? '<1' : String(roundedGap)
  return `${topLabel} by ${gapLabel} ${roundedGap <= 1 ? 'pt' : 'pts'} over ${runnerLabel}`
}

function cardColors(card: Pick<CardRow, 'colors'>): Set<string> {
  return new Set((card.colors || '').toUpperCase().split('').filter(color => 'WUBRG'.includes(color)))
}

/** A supported candidate/lane fit plus the exact coloured-pip counts behind it. */
function poolColorFitClause(candidate: Pick<CardRow, 'colors'>, pool: ReadonlyArray<PoolCard>): string | null {
  const summary = poolSummary(pool)
  const lean = laneLean(summary)
  if (!lean) return null

  const candidateColors = cardColors(candidate)
  const laneColors = new Set<string>(lean.colors)
  if (candidateColors.size === 0 || [...candidateColors].some(color => !laneColors.has(color))) return null

  const counts = lean.colors.map(color => `${summary.counts[color]} ${color}`).join(', ')
  return `fits your ${lean.label} pool lean (${counts})`
}

/**
 * Up to two literal mechanic terms found in the card name or type line.
 * Word boundaries avoid turning related words into unsupported mechanic claims.
 */
function typeNameHooks(card: HookCard, limit = 2): WhyHook[] {
  if (!Number.isFinite(limit) || limit <= 0) return []
  const haystack = `${card.name || ''}\n${card.type || ''}`
  return WHY_HOOKS.filter(hook => HOOK_PATTERNS[hook].test(haystack)).slice(0, Math.floor(limit))
}

interface MatchingWhyHook {
  hook: WhyHook
  /** Current-pool cards carrying the same literal name/type signal. */
  poolCount: number
}

/** Candidate hooks that have at least one matching name/type signal in the pool. */
function matchingTypeNameHooks(candidate: HookCard, pool: ReadonlyArray<HookCard>): MatchingWhyHook[] {
  const candidateHooks = new Set(typeNameHooks(candidate, WHY_HOOKS.length))
  const matches: MatchingWhyHook[] = []
  for (const hook of WHY_HOOKS) {
    if (!candidateHooks.has(hook)) continue
    const poolCount = pool.filter(card => typeNameHooks(card, WHY_HOOKS.length).includes(hook)).length
    if (poolCount > 0) matches.push({ hook, poolCount })
    if (matches.length === 2) break
  }
  return matches
}

/** Build the honest 0–3 clause WHY line for a recommendation. */
export function buildWhy(
  top: WhyCard,
  runnerUp: ProbabilityCard | null,
  pool: ReadonlyArray<PoolCard>
): string {
  const clauses: string[] = []
  const gap = probabilityGapClause(top, runnerUp)
  if (gap) clauses.push(gap)

  const lean = poolColorFitClause(top, pool)
  if (lean) clauses.push(lean)

  const hooks = matchingTypeNameHooks(top, pool)
  if (hooks.length) {
    const evidence = hooks.map(({ hook, poolCount }) => `+${poolCount} ${hook}`).join(', ')
    clauses.push(`${evidence} pool name/type ${hooks.length === 1 ? 'match' : 'matches'}`)
  }

  return clauses.join(' · ')
}

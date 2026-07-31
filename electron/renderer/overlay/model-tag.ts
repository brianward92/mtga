/**
 * Model honesty tag + conviction-cap semantics (pure logic — unit tested).
 *
 * Two independent questions that used to be conflated:
 *
 * 1. Should conviction bands be CAPPED at SLAM? Only when the numbers are
 *    not calibrated model logits: a true heuristic model (z-scores), or a
 *    degraded server status (amber/red — whatever we're showing is not live
 *    model output). A trained model borrowed across formats (a Premier model
 *    serving Quick, model.fallback=true) produces REAL logits — no cap.
 *
 * 2. What provenance tag should the verdict show? Three-state:
 *      kind contains "heuristic"  -> HEURISTIC     (capped)
 *      model.fallback === true    -> PREMIER MODEL (trained, cross-format)
 *      kind === "draftfm-zeroshot"-> ZERO-SHOT     (trained, no set data yet)
 *      otherwise                  -> no tag
 */

export interface ModelInfoLike {
  id: string
  kind: string
  fallback: boolean | string | null
}

export interface ModelTag {
  text: string
  title: string
}

/** True heuristic scores (z-scores, not trained logits). */
export function isHeuristicModel(model: ModelInfoLike | null | undefined): boolean {
  return (model?.kind ?? '').toLowerCase().includes('heuristic')
}

/**
 * Cap conviction bands (no OBVIOUS BOMB / BOMB) only when the scores are not
 * calibrated logits: true heuristics, or any non-green server status.
 */
export function convictionCapped(
  model: ModelInfoLike | null | undefined,
  status: 'green' | 'amber' | 'red'
): boolean {
  return isHeuristicModel(model) || status !== 'green'
}

/** Provenance tag shown next to the flames (null = trained per-set model). */
export function modelTag(model: ModelInfoLike | null | undefined): ModelTag | null {
  if (!model) return null
  if (isHeuristicModel(model)) {
    return { text: 'HEURISTIC', title: 'heuristic score (z-scores, not a trained model)' }
  }
  if (model.fallback === true) {
    return { text: 'PREMIER MODEL', title: 'trained on Premier drafts, serving Quick' }
  }
  if (model.kind === 'draftfm-zeroshot') {
    return { text: 'ZERO-SHOT', title: 'foundation model — no human picks from this set yet' }
  }
  return null
}

/**
 * Footer display tag: the version segment of the model id
 * ("SOS/PremierDraft/v20260703" -> "v20260703"); the full id goes in the
 * tooltip. Ids without a path keep their full text.
 */
export function modelVersionTag(id: string): string {
  const segments = id.split('/').filter(Boolean)
  return segments[segments.length - 1] || id
}

/**
 * Draft panel density state (pure logic — unit tested).
 *
 * Three densities, cycled by the grip button:
 *   verdict — THE PICK with flame rating + two runner-ups + pool strip
 *   full    — verdict + complete ranked pack table + pool curve + history
 *   mini    — one line: top pick name only
 */

export type Density = 'verdict' | 'full' | 'mini'

export const DENSITY_CYCLE: readonly Density[] = ['verdict', 'full', 'mini']

/** Next density in the cycle: verdict -> full -> mini -> verdict. */
export function nextDensity(current: Density): Density {
  const index = DENSITY_CYCLE.indexOf(current)
  return DENSITY_CYCLE[(index + 1) % DENSITY_CYCLE.length]
}

/** Parse a persisted/foreign value into a valid density (default verdict). */
export function normalizeDensity(value: unknown): Density {
  return value === 'full' || value === 'mini' ? value : 'verdict'
}

/** CSS class applied to the overlay root for a density. */
export function densityClass(density: Density): string {
  return `density-${density}`
}

/** Grip-button tooltip: names the current view and what one click goes to. */
export function densityTitle(density: Density): string {
  const labels: Record<Density, string> = {
    verdict: 'Verdict',
    full: 'Full',
    mini: 'Mini'
  }
  return `${labels[density]} view — click for ${labels[nextDensity(density)]}`
}

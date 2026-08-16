import type { DraftState } from '../shared/state'

export function modelLabel(d: DraftState): string {
  const m = d.model
  if (m.state === 'ready' && m.modelId) return `Model: ${m.modelId.replace(/^_foundation\//, 'DraftFM ')}`
  if (m.state === 'no-bundle') return 'Model: bundle missing'
  if (m.state === 'no-set') return `Model: ${d.set ?? 'set'} not bundled`
  if (m.state === 'error') return `Model: error — ${m.message ?? ''}`
  return 'Model: DraftFM (loading…)'
}

export function draftLabel(d: DraftState, arenaFound: boolean): string {
  if (!arenaFound) return 'Waiting for Arena…'
  if (d.phase === 'idle') return 'No draft in progress'
  const where = d.pack && d.pick ? ` P${d.pack}P${d.pick}` : ''
  return `${d.set ?? '?'} ${d.format ?? ''}${where}${d.phase === 'complete' ? ' — complete' : ''}`
}

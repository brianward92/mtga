import { describe, expect, it } from 'vitest'
import { sheetOpenForPhaseTransition } from '../main/draft/completion'

describe('completion rail transition', () => {
  it('opens the pool on entry, then preserves toggles throughout the linger', () => {
    expect(sheetOpenForPhaseTransition('active', 'complete', false)).toBe(true)
    expect(sheetOpenForPhaseTransition('idle', 'complete', false)).toBe(true)
    expect(sheetOpenForPhaseTransition('complete', 'complete', false)).toBe(false)
    expect(sheetOpenForPhaseTransition('complete', 'complete', true)).toBe(true)
    expect(sheetOpenForPhaseTransition('complete', 'idle', false)).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import { sidebarSide } from '../shared/layout'
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

describe('deckbuilding panel side', () => {
  it('uncovers the sealed pool for adds and the drafted deck for cuts', () => {
    expect(sidebarSide('complete', undefined, true)).toBe('right')
    expect(sidebarSide('complete')).toBe('left')
    expect(sidebarSide('complete', 'left', true)).toBe('left')
    expect(sidebarSide('complete', 'right')).toBe('right')
    expect(sidebarSide('active', 'left', true)).toBe('right')
  })
})

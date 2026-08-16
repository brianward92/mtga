/**
 * Model display naming (renderer/overlay/model-tag.ts).
 */
import { describe, it, expect } from 'vitest'
import { bundleProvenance, modelDisplayName, modelVersionTag } from '../renderer/overlay/model-tag'

describe('modelVersionTag', () => {
  it('returns the last path segment of a model id', () => {
    expect(modelVersionTag('SOS/PremierDraft/v20260703')).toBe('v20260703')
    expect(modelVersionTag('_foundation/v20260809_final_d256')).toBe('v20260809_final_d256')
  })

  it('keeps ids without a path intact', () => {
    expect(modelVersionTag('v1')).toBe('v1')
    expect(modelVersionTag('')).toBe('')
  })
})

describe('modelDisplayName', () => {
  it('maps the bundled foundation release to its product name', () => {
    expect(modelDisplayName('_foundation/v20260809_final_d256')).toBe('DraftFM v1.0')
  })

  it('falls back to DraftFM + version segment for other ids', () => {
    expect(modelDisplayName('_foundation/fdev-20260704')).toBe('DraftFM fdev-20260704')
    expect(modelDisplayName('f-full-20260705')).toBe('DraftFM f-full-20260705')
  })

  it('is just DraftFM without an id', () => {
    expect(modelDisplayName(null)).toBe('DraftFM')
    expect(modelDisplayName(undefined)).toBe('DraftFM')
    expect(modelDisplayName('')).toBe('DraftFM')
  })
})

describe('bundleProvenance', () => {
  it('pairs the exact model tag with the Scryfall snapshot timestamp', () => {
    expect(bundleProvenance({ model: 'v20260809_final_d256', scryfall: '2026-08-15T12:34:56Z' }))
      .toBe('DraftFM v20260809_final_d256 · Scryfall 2026-08-15T12:34:56Z')
  })

  it('omits unavailable provenance fields without dangling separators', () => {
    expect(bundleProvenance({ model: 'v1', scryfall: null })).toBe('DraftFM v1')
    expect(bundleProvenance({ model: null, scryfall: '2026-08-15' })).toBe('Scryfall 2026-08-15')
    expect(bundleProvenance({ model: null, scryfall: null })).toBe('')
  })
})

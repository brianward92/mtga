/**
 * Model provenance tag + conviction-cap semantics (model-tag.ts) and the
 * cached-stats relative-age formatter (shared.ts).
 */

import { describe, it, expect } from 'vitest'
import {
  isHeuristicModel,
  convictionCapped,
  modelTag,
  modelVersionTag,
  ModelInfoLike
} from '../renderer/overlay/model-tag'
import { formatRelativeAge } from '../renderer/overlay/shared'

const heuristic: ModelInfoLike = { id: 'SOS/heuristic', kind: 'heuristic-ev', fallback: null }
const trained: ModelInfoLike = { id: 'SOS/PremierDraft/v20260703', kind: 'draftnet-mlp', fallback: false }
const borrowed: ModelInfoLike = { id: 'SOS/PremierDraft/v20260703', kind: 'draftnet-mlp', fallback: true }
const zeroShot: ModelInfoLike = { id: '_foundation/fdev-20260704', kind: 'draftfm-zeroshot', fallback: false }

describe('isHeuristicModel', () => {
  it('detects heuristic kinds only', () => {
    expect(isHeuristicModel(heuristic)).toBe(true)
    expect(isHeuristicModel(trained)).toBe(false)
    expect(isHeuristicModel(borrowed)).toBe(false)
    expect(isHeuristicModel(null)).toBe(false)
    expect(isHeuristicModel(undefined)).toBe(false)
  })
})

describe('convictionCapped', () => {
  it('caps true heuristics regardless of status', () => {
    expect(convictionCapped(heuristic, 'green')).toBe(true)
    expect(convictionCapped(heuristic, 'amber')).toBe(true)
  })

  it('caps any model on degraded (non-green) status', () => {
    expect(convictionCapped(trained, 'amber')).toBe(true)
    expect(convictionCapped(trained, 'red')).toBe(true)
    expect(convictionCapped(null, 'red')).toBe(true)
  })

  it('does NOT cap a trained cross-format fallback on green — real logits', () => {
    expect(convictionCapped(borrowed, 'green')).toBe(false)
    expect(convictionCapped(trained, 'green')).toBe(false)
    expect(convictionCapped(zeroShot, 'green')).toBe(false)
  })
})

describe('modelTag', () => {
  it('tags heuristics HEURISTIC (highest precedence)', () => {
    expect(modelTag(heuristic)?.text).toBe('HEURISTIC')
    expect(modelTag({ ...heuristic, fallback: true })?.text).toBe('HEURISTIC')
  })

  it('tags a trained cross-format borrow PREMIER MODEL', () => {
    const tag = modelTag(borrowed)
    expect(tag?.text).toBe('PREMIER MODEL')
    expect(tag?.title).toContain('Premier')
  })

  it('tags the foundation model ZERO-SHOT', () => {
    const tag = modelTag(zeroShot)
    expect(tag?.text).toBe('ZERO-SHOT')
    expect(tag?.title).toContain('foundation')
  })

  it('shows no tag for a plain trained per-set model', () => {
    expect(modelTag(trained)).toBeNull()
    expect(modelTag(null)).toBeNull()
  })

  it('requires fallback === true (string fallbacks are not the borrow flag)', () => {
    expect(modelTag({ ...trained, fallback: 'weird' })).toBeNull()
  })
})

describe('modelVersionTag', () => {
  it('keeps only the version segment of a path-like id', () => {
    expect(modelVersionTag('SOS/PremierDraft/v20260703')).toBe('v20260703')
    expect(modelVersionTag('_foundation/fdev-20260704')).toBe('fdev-20260704')
  })

  it('keeps plain ids intact and survives trailing slashes', () => {
    expect(modelVersionTag('plain-id')).toBe('plain-id')
    expect(modelVersionTag('a/b/')).toBe('b')
  })
})

describe('formatRelativeAge', () => {
  const ago = (ms: number) => new Date(Date.now() - ms).toISOString()

  it('formats minutes, hours, and days coarsely', () => {
    expect(formatRelativeAge(ago(5 * 60_000))).toBe('5m ago')
    expect(formatRelativeAge(ago(3 * 3_600_000))).toBe('3h ago')
    expect(formatRelativeAge(ago(47 * 3_600_000))).toBe('47h ago')
    expect(formatRelativeAge(ago(3 * 86_400_000))).toBe('3d ago')
  })

  it('returns empty for missing, junk, or future timestamps', () => {
    expect(formatRelativeAge(null)).toBe('')
    expect(formatRelativeAge(undefined)).toBe('')
    expect(formatRelativeAge('not-a-date')).toBe('')
    expect(formatRelativeAge(ago(-60_000))).toBe('')
  })
})

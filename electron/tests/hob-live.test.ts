import { describe, expect, it } from 'vitest'
import { join } from 'path'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { ModelManager } from '../main/model/manager'

const ROOT = join(__dirname, '..', 'resources', 'draftfm')

/**
 * HOB ships without Scryfall arena_ids, so its bundle is built from a
 * hand-seeded grpId mapping. This pins the thing that mapping can silently
 * break: that real Arena grpIds resolve to real scores rather than the
 * "unknown card" fallback.
 */
describe('HOB bundle', () => {
  it('scores a HOB pack addressed by real Arena grpIds', async () => {
    const cache = mkdtempSync(join(tmpdir(), 'hob-'))
    try {
      const mgr = new ModelManager(cache, ROOT)
      expect(mgr.sets).toContain('HOB')
      expect(mgr.hasSet('HOB')).toBe(true)
      const pack = [103368, 103369, 103370, 103371, 103372]
      const scored = await mgr.score('HOB', 'QuickDraft', pack, [], 0, 0)
      expect(scored).not.toBeNull()
      expect(scored!.cards).toHaveLength(pack.length)
      for (const c of scored!.cards) {
        expect(c.ev).not.toBeNull()
        expect(Number.isFinite(c.ev as number)).toBe(true)
        expect(c.grade).not.toBeNull()
        expect(c.setGrade).not.toBeNull()
      }
      expect(scored!.cards.map(c => c.rank).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5])
    } finally {
      rmSync(cache, { recursive: true, force: true })
    }
  }, 120_000)
})

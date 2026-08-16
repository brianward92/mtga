import { describe, expect, it, vi } from 'vitest'
import { DraftCoordinator } from '../main/draft/coordinator'
import type { DraftSessionSnapshot } from '../main/parser/draft-parser'
import type { DraftState } from '../shared/state'

// A stub ModelManager: knows two cards, prefers grpId 2, and grades them.
function stubModels() {
  const bundle = {
    set: 'DSK', dir: '', assetsPath: '', picksPerPack: 14, manifestHash: 'x',
    cards: new Map([
      [1, { grpId: 1, name: 'Murder', rarity: 'common', colors: 'B', colorIdentity: 'B', manaCost: '{1}{B}{B}', manaValue: 3, type: 'Instant' }],
      [2, { grpId: 2, name: 'Funeral Room', rarity: 'mythic', colors: 'B', colorIdentity: 'WB', manaCost: '{2}{B}', manaValue: 3, type: 'Enchantment — Room' }]
    ]),
    scryfallUpdatedAt: '2026-08-15',
    names: ['Murder', 'Funeral Room']
  }
  const calls: unknown[] = []
  return {
    calls,
    bundleFor: () => bundle,
    ensure: vi.fn(async () => ({})),
    modelTag: 'v',
    status: () => ({ state: 'ready' as const, modelId: '_foundation/v', modelTag: 'v', set: 'DSK', format: 'QuickDraft', message: null, sets: ['DSK'] }),
    intrinsic: (g: number) => (g === 2 ? { percentile: 0.97, grade: 'A' as const } : g === 1 ? { percentile: 0.4, grade: 'C' as const } : null),
    score: vi.fn(async (set: string, format: string, pack: number[], pool: number[], pack0: number, pick0: number) => {
      calls.push({ set, format, pack, pool, pack0, pick0 })
      const cards = pack.map(g => ({ grpId: g, ev: g === 2 ? 2.5 : g === 1 ? 0.3 : null, prob: g === 2 ? 0.9 : g === 1 ? 0.1 : null, rank: g === 2 ? 1 : g === 1 ? 2 : 3, percentile: g === 2 ? 0.97 : g === 1 ? 0.4 : null, grade: g === 2 ? 'A' as const : g === 1 ? 'C' as const : null }))
      return { modelId: '_foundation/v', cards }
    })
  }
}

function snap(over: Partial<DraftSessionSnapshot>): DraftSessionSnapshot {
  return { draftId: 'd1', eventName: 'QuickDraft_DSK_20260811', set: 'DSK', format: 'QuickDraft', state: 'active', isBotDraft: true, currentPack: null, picks: [], pool: [], ...over }
}

const flush = () => new Promise(r => setTimeout(r, 0))

describe('DraftCoordinator', () => {
  it('start → pack → scores → pick → end, with 0-based model indexing', async () => {
    const models = stubModels()
    const history = { append: vi.fn() }
    const c = new DraftCoordinator(models as never, history as never)
    const states: DraftState[] = []
    c.on('state', s => states.push(s))

    c.onDraftStart(snap({}))
    expect(c.current.phase).toBe('active')
    expect(c.current.picksPerPack).toBe(14)
    expect(c.current.snapshot.model).toBe('v')
    expect(c.current.snapshot.scryfall).toBe('2026-08-15')

    c.onDraftPack(snap({ currentPack: { pack: 1, pick: 1, grpIds: [1, 2, 999] } }))
    expect(c.current.scoring).toBe(true)
    expect(c.current.cards.map(r => r.name)).toEqual(['Murder', 'Funeral Room', 'Card #999'])
    await flush(); await flush()
    expect(models.calls[0]).toMatchObject({ pack0: 0, pick0: 0, pool: [] })
    expect(c.current.scoring).toBe(false)
    const fr = c.current.cards.find(r => r.grpId === 2)!
    expect(fr.rank).toBe(1); expect(fr.grade).toBe('A'); expect(fr.ev).toBe(2.5)
    expect(fr.colors).toBe('B')
    expect(fr.colorIdentity).toBe('WB')
    expect(fr.imageUrl).toBeNull()

    c.onDraftPick(snap({ currentPack: { pack: 1, pick: 1, grpIds: [1, 2, 999] }, pool: [1] }), { pack: 1, pick: 1, grpIds: [1], packGrpIds: [1, 2, 999] })
    expect(c.current.picks).toHaveLength(1)
    expect(c.current.picks[0]).toMatchObject({ grpId: 1, name: 'Murder', recommendedGrpId: 2, recommendedName: 'Funeral Room', takenRank: 2 })
    expect(c.current.cards).toEqual([]) // stale pack dropped until the next lands
    expect(c.current.pool.map(r => r.grpId)).toEqual([1])
    expect(history.append).toHaveBeenCalledWith(expect.objectContaining({ type: 'pick', grpId: 1, recommendedGrpId: 2 }))

    c.onDraftPack(snap({ currentPack: { pack: 2, pick: 3, grpIds: [2] }, pool: [1] }))
    await flush(); await flush()
    expect(models.calls[1]).toMatchObject({ pack0: 1, pick0: 2, pool: [1] })

    c.onDraftEnd(snap({ state: 'complete', pool: [1, 2] }))
    expect(c.current.phase).toBe('complete')
    expect(history.append).toHaveBeenCalledWith(expect.objectContaining({ type: 'draft-end' }))
    c.idle()
    expect(c.current.phase).toBe('idle')
    expect(states.every((s, i) => i === 0 || s.seq > states[i - 1].seq)).toBe(true)
  })

  it('ignores stale score results when a newer pack landed', async () => {
    const models = stubModels()
    let release: (() => void) | null = null
    models.score = vi.fn(async (_s, _f, pack: number[]) => {
      if (pack[0] === 1) await new Promise<void>(r => { release = r })
      return { modelId: 'm', cards: pack.map(g => ({ grpId: g, ev: 1, prob: 1, rank: 1, percentile: 0.5, grade: 'C' as const })) }
    }) as never
    const c = new DraftCoordinator(models as never, { append() {} } as never)
    c.onDraftStart(snap({}))
    c.onDraftPack(snap({ currentPack: { pack: 1, pick: 1, grpIds: [1] } }))
    c.onDraftPack(snap({ currentPack: { pack: 1, pick: 2, grpIds: [2] } }))
    await flush()
    release!()
    await flush(); await flush()
    expect(c.current.pick).toBe(2)
    expect(c.current.cards[0].grpId).toBe(2)
    expect(c.current.cards[0].ev).toBe(1) // second pack scored
  })

  it('does not score or persist while replaying, then resumes', async () => {
    const models = stubModels()
    const history = { append: vi.fn() }
    const c = new DraftCoordinator(models as never, history as never)
    c.setReplaying(true)
    c.onDraftStart(snap({}))
    c.onDraftPack(snap({ currentPack: { pack: 1, pick: 1, grpIds: [1, 2] } }))
    await flush()
    expect(models.score).not.toHaveBeenCalled()
    expect(history.append).not.toHaveBeenCalled()
    c.resumeAfterReplay()
    await flush(); await flush()
    expect(models.score).toHaveBeenCalledTimes(1)
    expect(c.current.cards.find(r => r.grpId === 2)!.rank).toBe(1)
  })
})

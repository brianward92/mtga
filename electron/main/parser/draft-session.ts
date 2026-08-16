import { parseDraftEventName } from '../utils/format-utils'

/** One recorded pick, using 1-based pack and pick numbers. */
export interface DraftPickRecord {
  /** 1-based pack number (1..3). */
  pack: number
  /** 1-based pick number within the pack (1..picksPerPack). */
  pick: number
  /** Cards taken with this pick (length > 1 in Pick-Two drafts). */
  grpIds: number[]
  /** Contents of the pack when the pick was made ([] if never observed). */
  packGrpIds: number[]
}

/**
 * Point-in-time view of the current draft.
 *
 * Every pack/pick number is 1-based. Human events already use this convention;
 * bot-draft values are shifted by the parser before they reach the session.
 */
export interface DraftSessionSnapshot {
  draftId: string | null
  eventName: string | null
  set: string | null
  format: string | null
  state: 'active' | 'complete'
  isBotDraft: boolean
  /** The pack currently on screen; 1-based pack/pick. */
  currentPack: { pack: number; pick: number; grpIds: number[] } | null
  /** Picks so far, sorted by (pack, pick); 1-based. */
  picks: DraftPickRecord[]
  pool: number[]
}

function pickKey(pack: number, pick: number): string {
  return `${pack}-${pick}`
}

/** Mutable state for one draft, separated from Player.log decoding. */
export class DraftSession {
  draftId: string | null = null
  eventName: string | null = null
  set: string | null = null
  format: string | null = null
  state: 'active' | 'complete' = 'active'
  isBotDraft = false
  currentPack: { pack: number; pick: number; grpIds: number[] } | null = null
  /** (pack,pick) -> pack contents as seen */
  packs = new Map<string, number[]>()
  /** (pack,pick) -> picked grpIds */
  picks = new Map<string, number[]>()
  /** Authoritative pool (bot PickedCards / completion CardPool) when present */
  poolOverride: number[] | null = null

  applyEventName(eventName: string): void {
    this.eventName = eventName
    const parsed = parseDraftEventName(eventName)
    if (parsed) {
      this.set = parsed.set
      this.format = parsed.format
      if (parsed.format === 'QuickDraft') this.isBotDraft = true
    }
  }

  /** Record pack contents; returns true if anything changed. */
  recordPackContents(pack: number, pick: number, grpIds: number[]): boolean {
    const key = pickKey(pack, pick)
    const existing = this.packs.get(key)
    if (existing && existing.length === grpIds.length && existing.every((v, i) => v === grpIds[i])) {
      return false
    }
    this.packs.set(key, grpIds)
    return true
  }

  /** Record a pick; idempotent on (pack, pick). Returns true if new/changed. */
  recordPick(pack: number, pick: number, grpIds: number[]): boolean {
    const key = pickKey(pack, pick)
    const existing = this.picks.get(key)
    if (existing && existing.length === grpIds.length && existing.every((v, i) => v === grpIds[i])) {
      return false
    }
    this.picks.set(key, grpIds)
    return true
  }

  /**
   * Accept an authoritative pool only when it is at least as large as the
   * pick-stream pool. Returns true when the override was applied.
   */
  applyPoolOverride(candidate: number[] | null): boolean {
    if (!candidate || candidate.length === 0) return false
    const known = this.pool().length
    if (candidate.length < known) {
      console.warn(
        `[DraftParser] Ignoring authoritative pool of ${candidate.length} card(s); ` +
          `${known} already known from the pick stream.`
      )
      return false
    }
    this.poolOverride = candidate
    return true
  }

  private sortedPickEntries(): Array<{ pack: number; pick: number; grpIds: number[] }> {
    return Array.from(this.picks.entries())
      .map(([key, grpIds]) => {
        const [pack, pick] = key.split('-').map(Number)
        return { pack, pick, grpIds }
      })
      .sort((a, b) => a.pack - b.pack || a.pick - b.pick)
  }

  /** Return the authoritative pool, or derive one from picks in draft order. */
  pool(): number[] {
    if (this.poolOverride) return [...this.poolOverride]
    const pool: number[] = []
    for (const entry of this.sortedPickEntries()) {
      pool.push(...entry.grpIds)
    }
    return pool
  }

  /** Return a detached, immutable-by-convention view of the current session. */
  snapshot(): DraftSessionSnapshot {
    return {
      draftId: this.draftId,
      eventName: this.eventName,
      set: this.set,
      format: this.format,
      state: this.state,
      isBotDraft: this.isBotDraft,
      currentPack: this.currentPack
        ? { pack: this.currentPack.pack, pick: this.currentPack.pick, grpIds: [...this.currentPack.grpIds] }
        : null,
      picks: this.sortedPickEntries().map(entry => ({
        pack: entry.pack,
        pick: entry.pick,
        grpIds: [...entry.grpIds],
        packGrpIds: [...(this.packs.get(pickKey(entry.pack, entry.pick)) ?? [])]
      })),
      pool: this.pool()
    }
  }
}

import { DraftPickRecord, DraftSessionSnapshot } from '../parser/draft-parser'

/** Persist model fields when a score response lands after its pick event. */
export function backfillCompletedDraftPick(
  session: DraftSessionSnapshot | null,
  pack: number,
  pick: number,
  packGrpIds: readonly number[],
  persist: (snapshot: DraftSessionSnapshot, picked: DraftPickRecord) => void
): boolean {
  if (!session) return false
  const completedPick = session.picks.find(candidate =>
    candidate.pack === pack &&
    candidate.pick === pick &&
    candidate.packGrpIds.length === packGrpIds.length &&
    candidate.packGrpIds.every(grpId => packGrpIds.includes(grpId))
  )
  if (!completedPick) return false
  persist(session, completedPick)
  return true
}

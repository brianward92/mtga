/**
 * Draft history: one JSON line per event, append-only, under userData.
 *
 * This file is the only durable record of how a draft went. Arena's own log is
 * not: it is recreated on every launch, keeping just one backup, so the pick
 * events survive exactly one restart of the game. Arena's servers re-serve the
 * finished POOL for as long as the deck is unsubmitted, but never the picks —
 * so the order cards were taken in, and what the model thought at the time,
 * exist here or nowhere.
 *
 * Because of that, events are recorded during log replay as well as live, and
 * replay happens on every app start. Writes are therefore deduplicated by
 * identity rather than appended blindly, or the file would grow by a whole
 * draft each time the app launched.
 */
import { appendFileSync, closeSync, mkdirSync, openSync, readFileSync, readSync, statSync } from 'fs'
import { dirname } from 'path'

export interface HistoryEvent {
  at: string
  type: 'draft-start' | 'pick' | 'draft-end' | 'deck-submit' | 'draft-pool'
  draftId: string | null
  eventName: string | null
  set: string | null
  format: string | null
  [k: string]: unknown
}

/**
 * What makes an event the same event across replays.
 *
 * Deliberately not a hash of the whole row: a replayed pick carries no model
 * data, because replay does not score, so a content hash would treat the poorer
 * replayed row as new and write it alongside the richer live one.
 *
 * The trade-off is that two drafts of the same event that took the same card at
 * the same position collapse into one row. Those rows are identical in every
 * field we record, so nothing distinguishable is lost.
 */
export function historyKey(ev: HistoryEvent): string {
  const base = `${ev.type}|${ev.draftId ?? ''}|${ev.eventName ?? ''}`
  switch (ev.type) {
    case 'pick': return `${base}|${ev.pack}|${ev.pick}|${ev.grpId}`
    case 'deck-submit': return `${base}|${ev.mainCount}`
    // draft-end and draft-pool key on the draft alone, so a draft yields one of
    // each however it was reconstructed. The pool is a separate event rather
    // than a field on draft-end precisely so it can be recorded later than the
    // end was, without having to rewrite an append-only file.
    case 'draft-end':
    case 'draft-pool': return base
    default: return base
  }
}

/** One draft, reassembled from the history file. */
export interface RecordedDraft {
  eventName: string | null
  draftId: string | null
  set: string | null
  format: string | null
  /** Every card drafted, in pick order where known. */
  pool: number[]
  picks: Array<{ pack: number; pick: number; grpId: number; name: string | null }>
  /** The draft reached its end event, rather than being cut off mid-way. */
  complete: boolean
  /** Timestamp of the latest event belonging to this draft. */
  at: string
}

/** Appends draft lifecycle events to a best-effort JSONL history file. */
export class DraftHistory {
  private seen: Set<string> | null = null
  private repaired = false

  constructor(private file: string) {}

  /**
   * The most recently recorded draft, reassembled from its events.
   *
   * This is the fallback when nothing else can supply a draft: Arena's log has
   * rotated past it and its servers have stopped offering the pool because the
   * deck was submitted. Prefers the recorded pool when there is one, and
   * otherwise reconstructs it from the picks, which is what a draft cut off
   * part-way leaves behind.
   */
  lastDraft(): RecordedDraft | null {
    let lines: string[]
    try {
      lines = readFileSync(this.file, 'utf8').split('\n')
    } catch { return null }

    const byDraft = new Map<string, RecordedDraft & { recordedPool: number[] | null }>()
    for (const line of lines) {
      if (!line.trim()) continue
      let ev: HistoryEvent
      try { ev = JSON.parse(line) as HistoryEvent } catch { continue }
      if (!ev.type || typeof ev.at !== 'string') continue
      // Drafts are keyed the way events are, so rows from one draft group even
      // when the id is null, which it is for every bot draft.
      const key = `${ev.draftId ?? ''}|${ev.eventName ?? ''}`
      if (!ev.draftId && !ev.eventName) continue
      let d = byDraft.get(key)
      if (!d) {
        d = { eventName: ev.eventName, draftId: ev.draftId, set: ev.set, format: ev.format, pool: [], picks: [], complete: false, at: ev.at, recordedPool: null }
        byDraft.set(key, d)
      }
      if (ev.at > d.at) d.at = ev.at
      if (ev.set && !d.set) d.set = ev.set
      if (ev.format && !d.format) d.format = ev.format
      if (ev.type === 'pick' && typeof ev.grpId === 'number') {
        d.picks.push({ pack: Number(ev.pack), pick: Number(ev.pick), grpId: ev.grpId, name: typeof ev.name === 'string' ? ev.name : null })
      } else if (ev.type === 'draft-pool' && Array.isArray(ev.pool)) {
        d.recordedPool = (ev.pool as unknown[]).filter((n): n is number => typeof n === 'number')
      } else if (ev.type === 'draft-end') {
        d.complete = true
      }
    }
    // Newest first, but skip any draft with nothing to restore. Joining an
    // event and quitting before the first pick writes a draft-start and nothing
    // else; returning null there hid a perfectly recoverable earlier draft,
    // which is exactly the abort-and-restart case this exists for.
    const ordered = [...byDraft.values()].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    for (const d of ordered) {
      d.picks.sort((a, b) => a.pack - b.pack || a.pick - b.pick)
      const { recordedPool, ...draft } = d
      draft.pool = recordedPool ?? draft.picks.map(p => p.grpId)
      if (draft.pool.length > 0) return draft
    }
    return null
  }

  /** If the file does not end in a newline, add one before appending. */
  private closeTornLine(): void {
    if (this.repaired) return
    this.repaired = true
    try {
      const size = statSync(this.file).size
      if (size === 0) return
      const fd = openSync(this.file, 'r')
      const tail = Buffer.alloc(1)
      try { readSync(fd, tail, 0, 1, size - 1) } finally { closeSync(fd) }
      if (tail[0] !== 0x0a) appendFileSync(this.file, '\n')
    } catch { /* no file yet, or unreadable: the append below will report it */ }
  }

  /** Identity of every event already on disk; read once, lazily. */
  private keys(): Set<string> {
    if (this.seen) return this.seen
    const seen = new Set<string>()
    try {
      for (const line of readFileSync(this.file, 'utf8').split('\n')) {
        if (!line.trim()) continue
        try { seen.add(historyKey(JSON.parse(line) as HistoryEvent)) } catch { /* skip a torn line */ }
      }
    } catch { /* no history yet */ }
    this.seen = seen
    return seen
  }

  /**
   * Append one event unless it is already recorded.
   *
   * Persistence failures are swallowed: losing a history line must never stop
   * a draft. Returns whether the line was written.
   */
  append(ev: HistoryEvent): boolean {
    const key = historyKey(ev)
    const seen = this.keys()
    if (seen.has(key)) return false
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      // A crash mid-write leaves a partial line. Appending straight onto it
      // would weld the fragment to a good event, making ONE unparseable line
      // and losing both. Close the torn line first.
      this.closeTornLine()
      appendFileSync(this.file, JSON.stringify(ev) + '\n')
      seen.add(key)
      return true
    } catch (err) {
      console.error('[History] append failed:', err)
      return false
    }
  }
}

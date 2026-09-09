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
import { appendFileSync, mkdirSync, readFileSync } from 'fs'
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

/** Appends draft lifecycle events to a best-effort JSONL history file. */
export class DraftHistory {
  private seen: Set<string> | null = null

  constructor(private file: string) {}

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
      appendFileSync(this.file, JSON.stringify(ev) + '\n')
      seen.add(key)
      return true
    } catch (err) {
      console.error('[History] append failed:', err)
      return false
    }
  }
}

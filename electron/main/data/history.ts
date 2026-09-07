/**
 * Draft history: one JSON line per event, append-only, under userData.
 * Replaces the SQLite drafts/draft_picks tables (nothing in the app read them).
 */
import { appendFileSync, mkdirSync } from 'fs'
import { dirname } from 'path'

interface HistoryEvent {
  at: string
  type: 'draft-start' | 'pick' | 'draft-end' | 'deck-submit'
  draftId: string | null
  eventName: string | null
  set: string | null
  format: string | null
  [k: string]: unknown
}

/** Appends draft lifecycle events to a best-effort JSONL history file. */
export class DraftHistory {
  constructor(private file: string) {}

  /** Append one event without allowing persistence failures to stop a draft. */
  append(ev: HistoryEvent): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      appendFileSync(this.file, JSON.stringify(ev) + '\n')
    } catch (err) {
      console.error('[History] append failed:', err)
    }
  }
}

/**
 * Draft history: one JSON line per event, append-only, under userData.
 * Replaces the SQLite drafts/draft_picks tables (nothing in the app read them).
 */
import { appendFileSync, mkdirSync } from 'fs'
import { dirname } from 'path'

export interface HistoryEvent {
  at: string
  type: 'draft-start' | 'pick' | 'draft-end'
  draftId: string | null
  eventName: string | null
  set: string | null
  format: string | null
  [k: string]: unknown
}

export class DraftHistory {
  constructor(private file: string) {}
  append(ev: HistoryEvent): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      appendFileSync(this.file, JSON.stringify(ev) + '\n')
    } catch (err) {
      console.error('[History] append failed:', err)
    }
  }
}

/**
 * LogParser — the draft-only façade over DraftParser.
 *
 * Every Player.log line goes straight to DraftParser.handleLine, which does a
 * cheap substring pre-filter and only JSON.parses the handful of draft lines.
 * There is deliberately no generic JSON extraction here: the old
 * extractJson/routeEvent path parsed every multi-MB inventory/GRE body on the
 * main thread for match/deck/inventory features this app no longer has.
 */

import { EventEmitter } from 'events'
import { DraftParser, DraftSessionSnapshot, DraftPickRecord } from './draft-parser'

export type { DraftSessionSnapshot, DraftPickRecord } from './draft-parser'

export interface ParserEvents {
  'draft-start': (snapshot: DraftSessionSnapshot) => void
  'draft-pack': (snapshot: DraftSessionSnapshot) => void
  'draft-pick': (snapshot: DraftSessionSnapshot, pick: DraftPickRecord) => void
  'draft-end': (snapshot: DraftSessionSnapshot) => void
  /** Player.log's "DETAILED LOGS: ENABLED/DISABLED" sentinel. */
  'detailed-logs': (data: { enabled: boolean }) => void
}

export class LogParser extends EventEmitter {
  private readonly draftParser = new DraftParser()

  constructor() {
    super()
    // Re-emit draft events so main keeps its single-subscription pattern
    this.draftParser.on('draft-start', (snapshot) => this.emit('draft-start', snapshot))
    this.draftParser.on('draft-pack', (snapshot) => this.emit('draft-pack', snapshot))
    this.draftParser.on('draft-pick', (snapshot, pick) => this.emit('draft-pick', snapshot, pick))
    this.draftParser.on('draft-end', (snapshot) => this.emit('draft-end', snapshot))
    this.draftParser.on('detailed-logs', (data) => this.emit('detailed-logs', data))
  }

  getDraftSnapshot(): DraftSessionSnapshot | null {
    return this.draftParser.getSnapshot()
  }

  parseLine(line: string): void {
    this.draftParser.handleLine(line)
  }
}

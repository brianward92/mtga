import { DraftParser } from './draft-parser'
import type { SubmittedDeck } from './draft-session'
import { LogWatcher } from './watcher'
import type { DraftPickRecord, DraftSessionSnapshot } from './draft-session'

const DETAILED_LOGS_WARNING = 'Enable Detailed Logs in Arena: Options → Account → Detailed Logs (Plugin Support)'

/** Draft coordinator methods driven by normalized Player.log events. */
export interface DraftLogSink {
  onDraftStart: (snapshot: DraftSessionSnapshot) => void
  onDraftPack: (snapshot: DraftSessionSnapshot) => void
  onDraftPick: (snapshot: DraftSessionSnapshot, pick: DraftPickRecord) => void
  onDraftEnd: (snapshot: DraftSessionSnapshot) => void
  onDeckSubmitted: (deck: SubmittedDeck) => void
  setWarning: (warning: string | null) => void
  setReplaying: (replaying: boolean) => void
  resumeAfterReplay: () => void
}

/** Injectable parser/watcher pair used by focused wiring tests. */
export interface DraftLogPipelineDeps {
  parser?: DraftParser
  watcher?: LogWatcher
}

/** Wire and start the draft-only Player.log pipeline. */
export function startDraftLogPipeline(sink: DraftLogSink, deps: DraftLogPipelineDeps = {}): LogWatcher {
  const parser = deps.parser ?? new DraftParser()
  const watcher = deps.watcher ?? new LogWatcher()

  parser.on('draft-start', snapshot => sink.onDraftStart(snapshot))
  parser.on('draft-pack', snapshot => sink.onDraftPack(snapshot))
  parser.on('draft-pick', (snapshot, pick) => sink.onDraftPick(snapshot, pick))
  parser.on('draft-end', snapshot => sink.onDraftEnd(snapshot))
  parser.on('deck-submitted', deck => sink.onDeckSubmitted(deck))
  parser.on('detailed-logs', ({ enabled }: { enabled: boolean }) => {
    sink.setWarning(enabled ? null : DETAILED_LOGS_WARNING)
  })

  watcher.on('line', (line: string) => parser.handleLine(line))
  watcher.on('replay-start', () => sink.setReplaying(true))
  watcher.on('replay-complete', () => {
    console.log('[Watcher] replay complete, tailing live')
    sink.resumeAfterReplay()
  })
  void watcher.start()
  return watcher
}

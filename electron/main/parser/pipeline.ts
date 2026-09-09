import { DraftParser } from './draft-parser'
import { archiveLogs } from '../data/log-archive'
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
  /** Which Arena screen is showing, so the overlay can stay out of the way. */
  onScene: (scene: string) => void
  setWarning: (warning: string | null) => void
  setReplaying: (replaying: boolean) => void
  resumeAfterReplay: () => void
}

/** Injectable parser/watcher pair used by focused wiring tests. */
export interface DraftLogPipelineDeps {
  parser?: DraftParser
  watcher?: LogWatcher
  /** Where to keep copies of Arena's logs; omitted disables archiving. */
  archiveDir?: string
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
  parser.on('scene', (scene: string) => sink.onScene(scene))
  parser.on('detailed-logs', ({ enabled }: { enabled: boolean }) => {
    sink.setWarning(enabled ? null : DETAILED_LOGS_WARNING)
  })

  // Copy Arena's logs aside before it can roll past them. Unity keeps exactly
  // one backup, so a draft's raw log survives one restart of the game and the
  // next one destroys it. Done at startup and again whenever the log rotates
  // under us, which is Arena restarting while we are running.
  const archive = () => {
    if (!deps.archiveDir) return
    const added = archiveLogs(watcher.logFiles(), deps.archiveDir)
    if (added.length > 0) console.log(`[LogArchive] kept ${added.length} Arena log(s): ${added.join(', ')}`)
  }
  watcher.on('rotated', archive)
  // And when a draft finishes: archiving only at startup and on rotation meant
  // the session that CONTAINED the draft was never copied — the archive held
  // the pre-draft prefix, and Arena's next two launches destroyed the rest.
  parser.on('draft-end', () => archive())

  watcher.on('line', (line: string) => parser.handleLine(line))
  watcher.on('replay-start', () => { archive(); sink.setReplaying(true) })
  watcher.on('replay-complete', () => {
    console.log('[Watcher] replay complete, tailing live')
    sink.resumeAfterReplay()
  })
  void watcher.start()
  return watcher
}

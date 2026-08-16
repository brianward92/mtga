/**
 * MTGA log watcher.
 *
 * Tails the canonical detailed log every tracker parses:
 *   ~/Library/Logs/Wizards Of The Coast/MTGA/Player.log
 * (Unity recreates it on every game launch, moving the prior session to
 * Player-prev.log in the same directory.)
 *
 * Startup: parse Player-prev.log once, then Player.log from byte 0 — lines
 * are flagged as replay so downstream can suppress duplicate side effects
 * (the draft parser itself is idempotent, so replay converges). This gives
 * mid-draft resume even across an Arena restart.
 *
 * Tailing: byte-offset incremental reads via fs.createReadStream({ start }).
 * Byte offsets are never mixed with JS string indices; complete lines are
 * decoded by LineSplitter. On stat.size < lastOffset the file was recreated:
 * reopen from 0 (fresh session, live). Replace-without-shrink is caught by
 * inode tracking: a changed st_ino means a new file, reopen from 0.
 *
 * MTGA_LOG_PATH env var overrides the target file (its directory is watched)
 * for replay testing.
 *
 * Only Player.log is tailed. The legacy UTC_Log directory carries the same
 * draft messages (EventJoin, BotDraftDraftStatus, ...) and was a double-feed
 * risk, so it is no longer watched.
 */

import { EventEmitter } from 'events'
import { watch, FSWatcher } from 'chokidar'
import { stat } from 'fs/promises'
import { createReadStream, existsSync } from 'fs'
import { join, dirname } from 'path'
import { homedir } from 'os'
import { LineSplitter } from './line-splitter'

// Polling backstop (one stat/s when idle): fsevents can miss writes that land
// right after watch setup.
const POLL_INTERVAL_MS = 1_000

/** Incremental byte-offset tail of a single file. */
class FileTail {
  private offset = 0
  private splitter = new LineSplitter()
  private reading = false
  private pendingPoll: boolean | null = null
  /** Inode at the last stat — a changed st_ino means the file was replaced. */
  private lastIno: number | null = null

  constructor(
    readonly filePath: string,
    private readonly onLine: (line: string, replay: boolean) => void,
    private readonly onError: (error: Error) => void,
    private readonly onTruncated?: () => void
  ) {}

  reset(): void {
    this.offset = 0
    this.splitter.reset()
    this.lastIno = null
  }

  /**
   * Read any new bytes past the current offset. Serialized: overlapping
   * polls coalesce into one follow-up pass.
   */
  async poll(replay = false): Promise<void> {
    if (this.reading) {
      this.pendingPoll = this.pendingPoll || replay
      return
    }
    this.reading = true
    try {
      await this.readNewBytes(replay)
    } finally {
      this.reading = false
      if (this.pendingPoll !== null) {
        const again = this.pendingPoll
        this.pendingPoll = null
        await this.poll(again)
      }
    }
  }

  /** Emit any buffered partial line. Only for files that will not grow again. */
  flush(replay: boolean): void {
    const rest = this.splitter.flush()
    if (rest && rest.trim()) this.onLine(rest, replay)
  }

  private async readNewBytes(replay: boolean): Promise<void> {
    let size: number
    let ino: number
    try {
      const stats = await stat(this.filePath)
      size = stats.size
      ino = stats.ino
    } catch {
      return // file missing (Arena not started / mid-rotation): keep waiting
    }

    if (this.lastIno !== null && ino !== this.lastIno) {
      // Same path, new inode: the file was replaced — possibly without
      // shrinking, which the size check below would miss. Re-read from 0.
      this.reset()
      this.onTruncated?.()
    } else if (size < this.offset) {
      // File was recreated (Arena restart): re-read from 0. Content is a
      // brand-new session, so it is live, not replay.
      this.reset()
      this.onTruncated?.()
    }
    this.lastIno = ino

    if (size === this.offset) {
      return
    }

    await new Promise<void>((resolve) => {
      const stream = createReadStream(this.filePath, { start: this.offset, end: size - 1 })
      stream.on('data', (chunk) => {
        const buf = chunk as Buffer
        this.offset += buf.length
        for (const line of this.splitter.push(buf)) {
          if (line.trim()) this.onLine(line, replay)
        }
      })
      stream.on('error', (error) => {
        this.onError(error as Error)
        resolve()
      })
      stream.on('end', () => resolve())
      stream.on('close', () => resolve())
    })
  }
}

/** Replays prior Arena logs once, then tails the current Player.log. */
export class LogWatcher extends EventEmitter {
  private readonly logPath: string
  private readonly logDirectory: string
  private readonly usingOverride: boolean

  private playerTail: FileTail
  private watcher: FSWatcher | null = null
  private pollTimer: NodeJS.Timeout | null = null
  private stopped = false

  constructor() {
    super()

    const override = process.env.MTGA_LOG_PATH
    this.usingOverride = !!override
    this.logPath = override || join(homedir(), 'Library/Logs/Wizards Of The Coast/MTGA/Player.log')
    this.logDirectory = dirname(this.logPath)

    this.playerTail = new FileTail(
      this.logPath,
      (line, replay) => this.emit('line', line, replay),
      (error) => this.emit('error', error),
      () => this.emit('rotated', this.logPath)
    )
  }

  /** Replay existing logs, then start filesystem and polling live tails. */
  async start(): Promise<void> {
    this.stopped = false

    if (!existsSync(this.logDirectory)) {
      this.emit('error', new Error(`MTGA log directory not found: ${this.logDirectory}`))
      return
    }

    // ---- Initial replay: Player-prev.log once, then Player.log from byte 0
    this.emit('replay-start')

    if (!this.usingOverride) {
      const prevPath = join(this.logDirectory, 'Player-prev.log')
      if (existsSync(prevPath)) {
        const prevTail = new FileTail(
          prevPath,
          (line, replay) => this.emit('line', line, replay),
          (error) => this.emit('error', error)
        )
        await prevTail.poll(true)
        prevTail.flush(true) // file never grows again: safe to flush
      }
    }

    if (existsSync(this.logPath)) {
      await this.playerTail.poll(true)
    }
    this.emit('replay-complete')
    this.emit('watching', this.logPath)

    if (this.stopped) return

    // ---- Live tail via directory watch (catches recreate after rotation)
    this.watcher = watch(this.logDirectory, {
      persistent: true,
      ignoreInitial: true,
      depth: 0
    })

    const onFsEvent = (path: string): void => {
      if (path === this.logPath) {
        void this.playerTail.poll(false)
      }
    }
    this.watcher.on('change', onFsEvent)
    this.watcher.on('add', onFsEvent)
    this.watcher.on('error', (error) => this.emit('error', error as Error))

    // ---- Polling backstop for events chokidar misses (also drives the
    // inode-change replace-without-shrink detection in FileTail)
    this.pollTimer = setInterval(() => {
      void this.playerTail.poll(false)
    }, POLL_INTERVAL_MS)
  }

  /** Stop filesystem watching and polling; safe to call repeatedly. */
  stop(): void {
    this.stopped = true
    this.watcher?.close()
    this.watcher = null
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
  }
}

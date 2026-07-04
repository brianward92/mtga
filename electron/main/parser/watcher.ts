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
 * reopen from 0 (fresh session, live). A 60s mtime-vs-offset force-refresh
 * catches replace-without-shrink (re-read from 0, flagged replay).
 *
 * MTGA_LOG_PATH env var overrides the target file (its directory is watched)
 * for replay testing.
 *
 * The legacy UTC_Log directory watch is kept as an optional secondary source
 * (config flag, default on) so existing match tracking keeps working while
 * the Player.log switch is verified.
 */

import { EventEmitter } from 'events'
import { watch, FSWatcher } from 'chokidar'
import { stat } from 'fs/promises'
import { createReadStream, existsSync, readdirSync, statSync } from 'fs'
import { join, dirname } from 'path'
import { homedir } from 'os'
import { LineSplitter } from './line-splitter'

export interface LogWatcherEvents {
  line: (line: string, replay: boolean) => void
  error: (error: Error) => void
  watching: (path: string) => void
  rotated: (newPath: string) => void
  'replay-start': () => void
  'replay-complete': () => void
}

export interface LogWatcherOptions {
  /** Also tail the legacy UTC_Log directory (default true). */
  watchLegacyLogs?: boolean
}

const FORCE_REFRESH_MS = 60_000
// Polling backstop (one stat/s when idle): fsevents can miss writes that land
// right after watch setup, and the reference 17Lands follower polls anyway.
const POLL_INTERVAL_MS = 1_000

/** Incremental byte-offset tail of a single file. */
class FileTail {
  private offset = 0
  private splitter = new LineSplitter()
  private reading = false
  private pendingPoll: boolean | null = null
  /** Wall-clock time of the last successful stat+read cycle. */
  lastConsumeMs = 0

  constructor(
    readonly filePath: string,
    private readonly onLine: (line: string, replay: boolean) => void,
    private readonly onError: (error: Error) => void,
    private readonly onTruncated?: () => void
  ) {}

  get byteOffset(): number {
    return this.offset
  }

  reset(): void {
    this.offset = 0
    this.splitter.reset()
  }

  seekToEnd(size: number): void {
    this.offset = size
    this.splitter.reset()
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
    try {
      const stats = await stat(this.filePath)
      size = stats.size
    } catch {
      return // file missing (Arena not started / mid-rotation): keep waiting
    }

    if (size < this.offset) {
      // File was recreated (Arena restart): re-read from 0. Content is a
      // brand-new session, so it is live, not replay.
      this.reset()
      this.onTruncated?.()
    }

    if (size === this.offset) {
      this.lastConsumeMs = Date.now()
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

    this.lastConsumeMs = Date.now()
  }
}

export class LogWatcher extends EventEmitter {
  private readonly logPath: string
  private readonly logDirectory: string
  private readonly watchLegacy: boolean
  private readonly usingOverride: boolean

  private playerTail: FileTail
  private watcher: FSWatcher | null = null
  private refreshTimer: NodeJS.Timeout | null = null
  private pollTimer: NodeJS.Timeout | null = null
  private stopped = false

  // Legacy UTC_Log secondary watch
  private readonly legacyDirectory: string
  private legacyWatcher: FSWatcher | null = null
  private legacyTail: FileTail | null = null

  constructor(options: LogWatcherOptions = {}) {
    super()
    this.watchLegacy = options.watchLegacyLogs ?? true

    const override = process.env.MTGA_LOG_PATH
    this.usingOverride = !!override
    this.logPath = override || join(homedir(), 'Library/Logs/Wizards Of The Coast/MTGA/Player.log')
    this.logDirectory = dirname(this.logPath)

    this.legacyDirectory = join(homedir(), 'Library/Application Support/com.wizards.mtga/Logs/Logs')

    this.playerTail = new FileTail(
      this.logPath,
      (line, replay) => this.emit('line', line, replay),
      (error) => this.emit('error', error),
      () => this.emit('rotated', this.logPath)
    )
  }

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

    // ---- Polling backstop for events chokidar misses
    this.pollTimer = setInterval(() => {
      void this.playerTail.poll(false)
    }, POLL_INTERVAL_MS)

    // ---- 60s mtime-vs-offset force refresh (replace-without-shrink)
    this.refreshTimer = setInterval(() => {
      void this.forceRefreshCheck()
    }, FORCE_REFRESH_MS)

    // ---- Optional legacy UTC_Log secondary watch
    if (this.watchLegacy) {
      this.startLegacyWatch()
    }
  }

  private async forceRefreshCheck(): Promise<void> {
    try {
      const stats = await stat(this.logPath)
      if (stats.mtimeMs <= this.playerTail.lastConsumeMs + FORCE_REFRESH_MS) return

      if (stats.size !== this.playerTail.byteOffset) {
        // chokidar missed events: catch up incrementally
        await this.playerTail.poll(false)
      } else {
        // Same size but stale offset: file was replaced without shrinking.
        // Re-read from 0; content largely seen before, so flag as replay.
        this.emit('replay-start')
        this.playerTail.reset()
        await this.playerTail.poll(true)
        this.emit('replay-complete')
      }
    } catch {
      // file missing: nothing to refresh
    }
  }

  // ==========================================================================
  // Legacy UTC_Log directory (secondary source for match tracking)
  // ==========================================================================

  private startLegacyWatch(): void {
    if (!existsSync(this.legacyDirectory)) return

    const latest = this.findLatestLegacyLog()
    if (latest) {
      this.attachLegacyTail(latest, true)
    }

    this.legacyWatcher = watch(this.legacyDirectory, {
      persistent: true,
      ignoreInitial: true,
      depth: 0
    })

    this.legacyWatcher.on('change', (path) => {
      if (this.legacyTail && path === this.legacyTail.filePath) {
        void this.legacyTail.poll(false)
      }
    })

    this.legacyWatcher.on('add', (path) => {
      if (path.includes('UTC_Log') && path.endsWith('.log')) {
        const newest = this.findLatestLegacyLog()
        if (newest && newest !== this.legacyTail?.filePath) {
          this.attachLegacyTail(newest, false)
          void this.legacyTail?.poll(false)
        }
      }
    })

    this.legacyWatcher.on('error', (error) => this.emit('error', error as Error))
  }

  private attachLegacyTail(path: string, seekToEnd: boolean): void {
    this.legacyTail = new FileTail(
      path,
      (line, replay) => this.emit('line', line, replay),
      (error) => this.emit('error', error)
    )
    if (seekToEnd) {
      try {
        this.legacyTail.seekToEnd(statSync(path).size)
      } catch {
        // start from 0 if stat fails
      }
    }
    this.emit('watching', path)
  }

  private findLatestLegacyLog(): string | null {
    if (!existsSync(this.legacyDirectory)) return null

    const files = readdirSync(this.legacyDirectory)
      .filter(f => f.startsWith('UTC_Log') && f.endsWith('.log'))
      .map(f => ({
        path: join(this.legacyDirectory, f),
        time: this.parseLegacyFilename(f)
      }))
      .filter(f => f.time !== null)
      .sort((a, b) => (b.time?.getTime() ?? 0) - (a.time?.getTime() ?? 0))

    return files[0]?.path ?? null
  }

  private parseLegacyFilename(filename: string): Date | null {
    // Format: "UTC_Log - MM-DD-YYYY HH.MM.SS.log"
    const match = filename.match(
      /UTC_Log - (\d{2})-(\d{2})-(\d{4}) (\d{2})\.(\d{2})\.(\d{2})\.log/
    )
    if (!match) return null

    const [, month, day, year, hour, minute, second] = match
    return new Date(
      parseInt(year),
      parseInt(month) - 1,
      parseInt(day),
      parseInt(hour),
      parseInt(minute),
      parseInt(second)
    )
  }

  stop(): void {
    this.stopped = true
    this.watcher?.close()
    this.watcher = null
    this.legacyWatcher?.close()
    this.legacyWatcher = null
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer)
      this.refreshTimer = null
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
  }
}

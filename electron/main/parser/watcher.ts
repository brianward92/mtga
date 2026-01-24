import { EventEmitter } from 'events'
import { watch, FSWatcher } from 'chokidar'
import { readFile, stat } from 'fs/promises'
import { existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

export interface LogWatcherEvents {
  line: (line: string) => void
  error: (error: Error) => void
  watching: (path: string) => void
  rotated: (newPath: string) => void
}

export class LogWatcher extends EventEmitter {
  private watcher: FSWatcher | null = null
  private currentLogPath: string | null = null
  private lastPosition: number = 0
  private logDirectory: string

  constructor() {
    super()
    // macOS MTGA log directory
    this.logDirectory = join(
      homedir(),
      'Library/Application Support/com.wizards.mtga/Logs/Logs'
    )
  }

  private findLatestLog(): string | null {
    if (!existsSync(this.logDirectory)) {
      return null
    }

    const files = readdirSync(this.logDirectory)
      .filter(f => f.startsWith('UTC_Log') && f.endsWith('.log'))
      .map(f => ({
        name: f,
        path: join(this.logDirectory, f),
        // Extract timestamp from filename: "UTC_Log - MM-DD-YYYY HH.MM.SS.log"
        time: this.parseLogFilename(f)
      }))
      .filter(f => f.time !== null)
      .sort((a, b) => (b.time?.getTime() ?? 0) - (a.time?.getTime() ?? 0))

    return files[0]?.path ?? null
  }

  private parseLogFilename(filename: string): Date | null {
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

  async start(): Promise<void> {
    // Find the latest log file
    this.currentLogPath = this.findLatestLog()

    if (!this.currentLogPath) {
      this.emit('error', new Error(`MTGA log directory not found: ${this.logDirectory}`))
      return
    }

    // Get initial file size to start reading from end
    try {
      const stats = await stat(this.currentLogPath)
      this.lastPosition = stats.size
    } catch {
      this.lastPosition = 0
    }

    this.emit('watching', this.currentLogPath)

    // Watch the directory for new log files and changes
    this.watcher = watch(this.logDirectory, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50
      }
    })

    this.watcher.on('change', async (path) => {
      if (path === this.currentLogPath) {
        await this.readNewContent()
      }
    })

    this.watcher.on('add', async (path) => {
      // Check if this is a new, more recent log file
      if (path.includes('UTC_Log') && path.endsWith('.log')) {
        const newLogPath = this.findLatestLog()
        if (newLogPath && newLogPath !== this.currentLogPath) {
          this.currentLogPath = newLogPath
          this.lastPosition = 0
          this.emit('rotated', newLogPath)
          this.emit('watching', newLogPath)
          await this.readNewContent()
        }
      }
    })

    this.watcher.on('error', (error) => {
      this.emit('error', error)
    })

    // Do initial read of existing content (optional - can be removed to only watch new content)
    // await this.readNewContent()
  }

  private async readNewContent(): Promise<void> {
    if (!this.currentLogPath) return

    try {
      const stats = await stat(this.currentLogPath)

      // File was truncated/rotated
      if (stats.size < this.lastPosition) {
        this.lastPosition = 0
      }

      // No new content
      if (stats.size === this.lastPosition) {
        return
      }

      // Read new content
      const content = await readFile(this.currentLogPath, 'utf-8')
      const newContent = content.slice(this.lastPosition)
      this.lastPosition = stats.size

      // Split into lines and emit each one
      const lines = newContent.split('\n')
      for (const line of lines) {
        if (line.trim()) {
          this.emit('line', line)
        }
      }
    } catch (error) {
      this.emit('error', error as Error)
    }
  }

  stop(): void {
    this.watcher?.close()
    this.watcher = null
  }

  // Read the entire current log file (for initial state recovery)
  async readFullLog(): Promise<void> {
    if (!this.currentLogPath) return

    try {
      const content = await readFile(this.currentLogPath, 'utf-8')
      const lines = content.split('\n')
      for (const line of lines) {
        if (line.trim()) {
          this.emit('line', line)
        }
      }
      const stats = await stat(this.currentLogPath)
      this.lastPosition = stats.size
    } catch (error) {
      this.emit('error', error as Error)
    }
  }
}

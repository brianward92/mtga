/**
 * LogWatcher integration tests against real temp files:
 * startup replay (Player-prev.log then Player.log from byte 0, flagged
 * replay), live tailing of appended bytes, and truncation-reopen.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, appendFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { LogWatcher } from '../main/parser/watcher'

interface CapturedLine {
  line: string
  replay: boolean
}

function waitFor(condition: () => boolean, timeoutMs = 4000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const timer = setInterval(() => {
      if (condition()) {
        clearInterval(timer)
        resolve()
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(timer)
        reject(new Error('waitFor timed out'))
      }
    }, 25)
  })
}

describe('LogWatcher', () => {
  let dir: string
  let watcher: LogWatcher | null = null

  afterEach(() => {
    watcher?.stop()
    watcher = null
    delete process.env.MTGA_LOG_PATH
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  async function startWatcher(logPath: string): Promise<{
    lines: CapturedLine[]
    events: string[]
  }> {
    process.env.MTGA_LOG_PATH = logPath
    watcher = new LogWatcher({ watchLegacyLogs: false })

    const lines: CapturedLine[] = []
    const events: string[] = []
    watcher.on('line', (line: string, replay: boolean) => lines.push({ line, replay }))
    watcher.on('replay-start', () => events.push('replay-start'))
    watcher.on('replay-complete', () => events.push('replay-complete'))
    watcher.on('rotated', () => events.push('rotated'))
    watcher.on('error', () => events.push('error'))

    await watcher.start()
    return { lines, events }
  }

  it('replays the existing file from byte 0 with replay=true, then tails live', async () => {
    dir = mkdtempSync(join(tmpdir(), 'mtga-watch-'))
    const logPath = join(dir, 'Player.log')
    writeFileSync(logPath, 'historic one\nhistoric two\n')

    const { lines, events } = await startWatcher(logPath)

    // Initial scan happened inside start(), flagged as replay
    expect(events).toEqual(['replay-start', 'replay-complete'])
    expect(lines).toEqual([
      { line: 'historic one', replay: true },
      { line: 'historic two', replay: true }
    ])

    // Appended bytes arrive as live lines (byte-offset incremental read)
    appendFileSync(logPath, 'live three\n')
    await waitFor(() => lines.length >= 3)
    expect(lines[2]).toEqual({ line: 'live three', replay: false })
  })

  it('reopens from byte 0 when the file shrinks (Arena restart)', async () => {
    dir = mkdtempSync(join(tmpdir(), 'mtga-watch-'))
    const logPath = join(dir, 'Player.log')
    writeFileSync(logPath, 'old session line that is fairly long\n')

    const { lines, events } = await startWatcher(logPath)
    expect(lines.length).toBe(1)

    // Recreate smaller (fresh session): must re-read from 0, content is live
    writeFileSync(logPath, 'fresh\n')
    await waitFor(() => lines.some(l => l.line === 'fresh'))

    expect(events).toContain('rotated')
    expect(lines[lines.length - 1]).toEqual({ line: 'fresh', replay: false })
  })

  it('reopens from byte 0 when the inode changes without shrinking (replace-without-shrink)', async () => {
    dir = mkdtempSync(join(tmpdir(), 'mtga-watch-'))
    const logPath = join(dir, 'Player.log')
    writeFileSync(logPath, 'old-content-here\n') // 17 bytes

    const { lines, events } = await startWatcher(logPath)
    expect(lines).toEqual([{ line: 'old-content-here', replay: true }])

    // Replace with a NEW file of the SAME size: the size-vs-offset check
    // cannot fire; only the st_ino change can catch this.
    rmSync(logPath)
    writeFileSync(logPath, 'new-content-yes!\n') // also 17 bytes

    await waitFor(() => lines.some(l => l.line === 'new-content-yes!'))
    expect(events).toContain('rotated')
    expect(lines[lines.length - 1]).toEqual({ line: 'new-content-yes!', replay: false })
  })

  it('holds partial lines until the newline arrives', async () => {
    dir = mkdtempSync(join(tmpdir(), 'mtga-watch-'))
    const logPath = join(dir, 'Player.log')
    writeFileSync(logPath, '')

    const { lines } = await startWatcher(logPath)

    appendFileSync(logPath, 'incomplete')
    // Give the watcher a moment: the partial line must NOT be emitted
    await new Promise(resolve => setTimeout(resolve, 400))
    expect(lines.length).toBe(0)

    appendFileSync(logPath, ' now complete\n')
    await waitFor(() => lines.length >= 1)
    expect(lines[0]).toEqual({ line: 'incomplete now complete', replay: false })
  })
})

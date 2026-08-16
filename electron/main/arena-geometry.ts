/**
 * Arena window geometry (+ optional frames) from the native helper.
 *
 * native/arena-window-watch.swift streams over stdout:
 *   G x,y,w,h,frontmost   window frame in points, ~30 Hz on change + 1 Hz heartbeat
 *   G NOWIN               Arena not running / no on-screen window
 *   F w,h,<base64 gray>   one-shot ScreenCaptureKit luminance frame (only with
 *                         capture on — an opt-in that needs Screen Recording)
 *   C on|off              whether frames are flowing
 * and takes "capture on|off" / "rate <hz>" on stdin. Geometry needs NO
 * permission (CGWindowList); we never use AppleScript/Accessibility.
 *
 * Test seam: MTGA_FAKE_ARENA_FILE names a JSON {x,y,width,height} that is
 * polled instead of spawning the helper (e2e / dev without Arena).
 *
 * Events: 'geometry' (rect), 'lost', 'frontmost' (bool), 'frame' (HelperFrame),
 * 'capture' (bool), 'helper-missing' (once).
 */
import { EventEmitter } from 'events'
import { spawn, ChildProcess } from 'child_process'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { createInterface } from 'readline'

export interface ArenaRect {
  x: number
  y: number
  width: number
  height: number
}

export type ArenaProbe =
  | { status: 'found'; rect: ArenaRect; frontmost: boolean }
  | { status: 'no-window' }

const FAKE_ARENA_FILE = process.env.MTGA_FAKE_ARENA_FILE
const FAKE_POLL_MS = 500
const HELPER_RETRY_MS = 10_000

function probeFakeArena(file: string): ArenaProbe {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    const rect = { x: Number(raw.x), y: Number(raw.y), width: Number(raw.width), height: Number(raw.height) }
    const finite = Object.values(rect).every(v => Number.isFinite(v))
    if (finite && rect.width > 0 && rect.height > 0) return { status: 'found', rect, frontmost: raw.frontmost !== false }
  } catch { /* fall through */ }
  return { status: 'no-window' }
}

/** Resolve the bundled helper binary; null when absent (or when faking Arena). */
export function findWindowWatchHelper(): string | null {
  if (process.platform !== 'darwin' || FAKE_ARENA_FILE) return null
  const candidates = [
    join(process.resourcesPath ?? '', 'native', 'arena-window-watch'),
    join(__dirname, '..', '..', 'build', 'native', 'arena-window-watch'),
    join(process.cwd(), 'build', 'native', 'arena-window-watch')
  ]
  for (const c of candidates) {
    try { if (existsSync(c)) return c } catch { /* next */ }
  }
  return null
}

/** One downscaled luminance frame of the Arena window from the helper. */
export interface HelperFrame {
  width: number
  height: number
  /** Row-major luminance 0..255. */
  data: Uint8Array
}

/** Parse a helper "F w,h,base64" line. */
export function parseFrameLine(line: string): HelperFrame | null {
  if (!line.startsWith('F ')) return null
  const c1 = line.indexOf(',', 2)
  const c2 = c1 < 0 ? -1 : line.indexOf(',', c1 + 1)
  if (c1 < 0 || c2 < 0) return null
  const width = parseInt(line.slice(2, c1), 10)
  const height = parseInt(line.slice(c1 + 1, c2), 10)
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null
  const data = new Uint8Array(Buffer.from(line.slice(c2 + 1), 'base64'))
  if (data.length !== width * height) return null
  return { width, height, data }
}

/** Parse one helper geometry line ("G x,y,w,h,fm" / "G NOWIN"); null otherwise. */
export function parseWatchLine(line: string): ArenaProbe | null {
  let t = line.trim()
  if (t.startsWith('G ')) t = t.slice(2)
  if (!t || t.startsWith('F ') || t.startsWith('C ')) return null
  if (t === 'NOWIN' || t === 'NOPROC') return { status: 'no-window' }
  const parts = t.split(',').map(v => parseInt(v, 10))
  if (parts.length !== 5 || parts.some(v => !Number.isFinite(v))) return null
  const [x, y, width, height, fm] = parts
  if (width <= 0 || height <= 0) return { status: 'no-window' }
  return { status: 'found', rect: { x, y, width, height }, frontmost: fm === 1 }
}

export class ArenaGeometryPoller extends EventEmitter {
  /** Last observed rect (kept as a cache across lost/found). */
  lastKnown: ArenaRect | null = null
  /** Whether Arena (or we) was the frontmost app on the last sample. */
  arenaFrontmost = true
  /** Frames are flowing (capture on AND Screen Recording granted). */
  captureOn = false
  /** Desired capture state; applied at spawn and live via setCapture(). */
  wantCapture = false

  private helper: ChildProcess | null = null
  private helperAlive = false
  private fakeTimer: NodeJS.Timeout | null = null
  private retryTimer: NodeJS.Timeout | null = null
  private running = false
  private state: 'unknown' | 'found' | 'lost' = 'unknown'
  private warnedMissing = false

  isRunning(): boolean { return this.running }
  isFound(): boolean { return this.state === 'found' }
  isStreaming(): boolean { return this.helperAlive }

  start(): void {
    if (this.running) return
    this.running = true
    if (FAKE_ARENA_FILE) {
      const tick = (): void => this.apply(probeFakeArena(FAKE_ARENA_FILE))
      tick()
      this.fakeTimer = setInterval(tick, FAKE_POLL_MS)
      return
    }
    this.startHelper()
  }

  stop(): void {
    this.running = false
    if (this.fakeTimer) { clearInterval(this.fakeTimer); this.fakeTimer = null }
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null }
    this.stopHelper()
    this.state = 'unknown'
  }

  /** Turn the helper's frame feed on/off ("capture on|off" over stdin). */
  setCapture(on: boolean): void {
    if (this.wantCapture === on) return
    this.wantCapture = on
    this.helperWrite(`capture ${on ? 'on' : 'off'}`)
  }

  /** Base capture rate in Hz (0 pauses; helper default 4). */
  setCaptureRate(hz: number): void {
    if (!Number.isFinite(hz) || hz < 0) return
    this.helperWrite(`rate ${hz}`)
  }

  private helperWrite(cmd: string): void {
    const stdin = this.helper?.stdin
    if (!stdin || stdin.destroyed || !stdin.writable) return
    try { stdin.write(cmd + '\n') } catch { /* helper gone; 'exit' handles it */ }
  }

  private startHelper(): void {
    if (this.helper || !this.running) return
    const path = findWindowWatchHelper()
    if (!path) {
      if (!this.warnedMissing) { this.warnedMissing = true; this.emit('helper-missing') }
      this.apply({ status: 'no-window' })
      return
    }
    let child: ChildProcess
    try {
      child = spawn(path, this.wantCapture ? ['--capture'] : [], { stdio: ['pipe', 'pipe', 'ignore'] })
    } catch {
      this.scheduleRetry()
      return
    }
    this.helper = child
    child.stdin?.on('error', () => { /* helper gone; 'exit' handles it */ })
    const rl = createInterface({ input: child.stdout! })
    rl.on('line', line => {
      if (line.startsWith('F ')) {
        const frame = parseFrameLine(line)
        if (frame) this.emit('frame', frame)
        return
      }
      if (line.startsWith('C ')) {
        this.captureOn = line.slice(2).trim() === 'on'
        this.emit('capture', this.captureOn)
        return
      }
      const probe = parseWatchLine(line)
      if (!probe) return
      this.helperAlive = true
      this.apply(probe)
    })
    const done = (): void => {
      this.helperAlive = false
      this.helper = null
      if (this.captureOn) { this.captureOn = false; this.emit('capture', false) }
      this.apply({ status: 'no-window' })
      this.scheduleRetry()
    }
    child.on('exit', done)
    child.on('error', done)
  }

  private scheduleRetry(): void {
    if (!this.running || this.retryTimer) return
    this.retryTimer = setTimeout(() => { this.retryTimer = null; this.startHelper() }, HELPER_RETRY_MS)
  }

  private stopHelper(): void {
    const h = this.helper
    this.helper = null
    this.helperAlive = false
    if (h && !h.killed) {
      try { h.stdin?.end() } catch { /* ignore */ }
      try { h.kill() } catch { /* ignore */ }
    }
  }

  private apply(probe: ArenaProbe): void {
    if (probe.status === 'found') {
      const prev = this.lastKnown
      const changed = !prev || prev.x !== probe.rect.x || prev.y !== probe.rect.y ||
        prev.width !== probe.rect.width || prev.height !== probe.rect.height
      this.lastKnown = probe.rect
      const wasFound = this.state === 'found'
      this.state = 'found'
      if (!wasFound || changed) this.emit('geometry', probe.rect)
      if (this.arenaFrontmost !== probe.frontmost) {
        this.arenaFrontmost = probe.frontmost
        this.emit('frontmost', probe.frontmost)
      }
      return
    }
    if (this.state !== 'lost') {
      this.state = 'lost'
      this.emit('lost')
    }
  }
}

/**
 * Arena window geometry (+ optional frames) from the native helper.
 *
 * native/arena-window-watch.swift streams over stdout:
 *   G x,y,w,h,frontmost   window frame in points, ~30 Hz on change + 1 Hz heartbeat
 *   G NOWIN               Arena not running / no on-screen window
 *   F w,h,<base64 gray>   one-shot ScreenCaptureKit luminance frame (only with
 *                         capture on — an opt-in that needs Screen Recording)
 *   C on|off              whether frames are flowing
 *   D <JSON>              independent, opt-in deck-screen text observations
 * and takes "capture on|off" / "deck-scan on|off" / "rate <hz>" / "activate" on stdin. Geometry
 * needs NO permission (CGWindowList); we never use AppleScript/Accessibility.
 *
 * Test seam: MTGA_FAKE_ARENA_FILE names a JSON {x,y,width,height} that is
 * polled instead of spawning the helper (e2e / dev without Arena).
 *
 * Events: 'geometry' (rect), 'lost', 'frontmost' (bool), 'frame' (HelperFrame),
 * 'capture' (bool), 'deck-screen' (DeckScreenObservation), 'click' (global point),
 * 'helper-missing' (once).
 */
import { EventEmitter } from 'events'
import { spawn, ChildProcess } from 'child_process'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { createInterface } from 'readline'

/** Arena window bounds in global screen points. */
export interface ArenaRect {
  titleBarHeight?: number
  x: number
  y: number
  width: number
  height: number
}

type ArenaProbe =
  | { status: 'found'; rect: ArenaRect; frontmost: boolean }
  | { status: 'no-window' }

const FAKE_ARENA_FILE = process.env.MTGA_FAKE_ARENA_FILE
const FAKE_POLL_MS = 500
const HELPER_RETRY_MS = 10_000

interface ArenaGeometryPollerOptions {
  /** Override the environment seam; primarily useful for deterministic tests. */
  fakeArenaFile?: string
  fakePollMs?: number
}

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
function findWindowWatchHelper(): string | null {
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

/** One recognized line, normalized to the Arena window including its title bar. */
export interface DeckScreenLine {
  text: string
  confidence: number
  /** Fractional bounds with a top-left origin, independent of Retina scale. */
  x: number
  y: number
  width: number
  height: number
}

/** Text-only observation; screenshots are neither sent to Electron nor saved. */
export interface DeckScreenObservation {
  /** Capture start time in epoch milliseconds, so stale observations can be rejected. */
  at: number
  /** Arena window size in screen points (zero when no window is available). */
  width: number
  height: number
  status: 'ok' | 'unavailable'
  reason?: string
  lines: DeckScreenLine[]
}

/** Validate the native boundary instead of letting malformed observations alter a deck. */
export function parseDeckScreenLine(line: string): DeckScreenObservation | null {
  if (!line.startsWith('D ')) return null
  try {
    const raw: unknown = JSON.parse(line.slice(2))
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
    const o = raw as Record<string, unknown>
    const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
    const fraction = (n: unknown): n is number => finite(n) && n >= 0 && n <= 1
    if (!finite(o.at) || o.at < 0 || !finite(o.width) || o.width < 0 ||
        !finite(o.height) || o.height < 0 || (o.status !== 'ok' && o.status !== 'unavailable') ||
        (o.reason !== undefined && typeof o.reason !== 'string') || !Array.isArray(o.lines)) return null
    if (o.status === 'ok' && (o.width <= 0 || o.height <= 0)) return null
    if (o.status === 'unavailable' && o.lines.length > 0) return null
    const lines: DeckScreenLine[] = []
    for (const item of o.lines) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null
      const l = item as Record<string, unknown>
      if (typeof l.text !== 'string' || !l.text.trim() || !fraction(l.confidence) ||
          !fraction(l.x) || !fraction(l.y) || !fraction(l.width) || !fraction(l.height) ||
          l.width <= 0 || l.height <= 0 || l.x + l.width > 1.000001 || l.y + l.height > 1.000001) return null
      lines.push({ text: l.text, confidence: l.confidence, x: l.x, y: l.y, width: l.width, height: l.height })
    }
    return { at: o.at, width: o.width, height: o.height, status: o.status,
      ...(o.reason === undefined ? {} : { reason: o.reason }), lines }
  } catch { return null }
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

/** Parse a helper "M x,y" global mouse-down line; null otherwise. */
export function parseClickLine(line: string): { x: number; y: number } | null {
  if (!line.startsWith('M ')) return null
  const parts = line.slice(2).split(',').map(v => parseInt(v, 10))
  if (parts.length !== 2 || parts.some(v => !Number.isFinite(v))) return null
  return { x: parts[0], y: parts[1] }
}

/** Parse one helper geometry line ("G x,y,w,h,fm" / "G NOWIN"); null otherwise. */
export function parseWatchLine(line: string): ArenaProbe | null {
  let t = line.trim()
  if (t.startsWith('G ')) t = t.slice(2)
  if (!t || t.startsWith('F ') || t.startsWith('C ') || t.startsWith('M ') || t.startsWith('D ')) return null
  if (t === 'NOWIN' || t === 'NOPROC') return { status: 'no-window' }
  const parts = t.split(',').map(v => parseInt(v, 10))
  if ((parts.length !== 5 && parts.length !== 6) || parts.some(v => !Number.isFinite(v))) return null
  const [x, y, width, height, fm, titleBarHeight] = parts
  if (width <= 0 || height <= 0) return { status: 'no-window' }
  return { status: 'found', rect: { x, y, width, height, ...(titleBarHeight === undefined ? {} : { titleBarHeight }) }, frontmost: fm === 1 }
}

/** Polls Arena window presence, geometry, focus, and optional luminance frames. */
export class ArenaGeometryPoller extends EventEmitter {
  /** Last observed rect (kept as a cache across lost/found). */
  lastKnown: ArenaRect | null = null
  /** Whether Arena (or we) was the frontmost app on the last sample. */
  arenaFrontmost = true
  /** Frames are flowing (capture on AND Screen Recording granted). */
  captureOn = false
  /** Desired capture state; applied at spawn and live via setCapture(). */
  wantCapture = false
  /** Deck OCR is independent from the low-resolution occlusion feed. */
  wantDeckScan = false

  private helper: ChildProcess | null = null
  private fakeTimer: NodeJS.Timeout | null = null
  private retryTimer: NodeJS.Timeout | null = null
  private running = false
  private state: 'unknown' | 'found' | 'lost' = 'unknown'
  private warnedMissing = false
  private readonly fakeArenaFile: string | undefined
  private readonly fakePollMs: number

  constructor(options: ArenaGeometryPollerOptions = {}) {
    super()
    this.fakeArenaFile = options.fakeArenaFile ?? FAKE_ARENA_FILE
    this.fakePollMs = Math.max(1, Math.round(options.fakePollMs ?? FAKE_POLL_MS))
  }

  /** Whether the latest probe found an Arena window. */
  isFound(): boolean { return this.state === 'found' }

  /** Begin the native-helper stream or deterministic fake-file polling. */
  start(): void {
    if (this.running) return
    this.running = true
    if (this.fakeArenaFile) {
      const tick = (): void => this.apply(probeFakeArena(this.fakeArenaFile!))
      tick()
      this.fakeTimer = setInterval(tick, this.fakePollMs)
      return
    }
    this.startHelper()
  }

  /** Stop polling, child processes, and retry timers, then clear found state. */
  stop(): void {
    this.running = false
    if (this.fakeTimer) { clearInterval(this.fakeTimer); this.fakeTimer = null }
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null }
    this.stopHelper()
    this.state = 'unknown'
  }

  /**
   * Make Arena the active application again. The overlay takes activation
   * while the pointer is on the sidebar (main/overlay/sidebar-pointer.ts) and
   * hands it back through the helper: Electron can activate itself but not
   * another application. A no-op without the helper or without Arena.
   */
  activateArena(): void {
    this.helperWrite('activate')
  }

  /** Dismiss the native card hover without moving the user's pointer. */
  dismissHover(): void {
    this.helperWrite('dismiss-hover')
  }

  /** Turn the helper's frame feed on/off ("capture on|off" over stdin). */
  setCapture(on: boolean): void {
    if (this.wantCapture === on) return
    this.wantCapture = on
    this.helperWrite(`capture ${on ? 'on' : 'off'}`)
  }

  /** Observe deck text only while requested; never asks for Screen Recording permission. */
  setDeckScan(on: boolean): void {
    if (this.wantDeckScan === on) return
    this.wantDeckScan = on
    this.helperWrite(`deck-scan ${on ? 'on' : 'off'}`)
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
      const args = [...(this.wantCapture ? ['--capture'] : []), ...(this.wantDeckScan ? ['--deck-scan'] : [])]
      child = spawn(path, args, { stdio: ['pipe', 'pipe', 'ignore'] })
    } catch {
      this.scheduleRetry()
      return
    }
    this.helper = child
    child.stdin?.on('error', () => { /* helper gone; 'exit' handles it */ })
    const rl = createInterface({ input: child.stdout! })
    rl.on('line', line => {
      if (line.startsWith('D ')) {
        const observation = parseDeckScreenLine(line)
        if (observation && this.wantDeckScan) this.emit('deck-screen', observation)
        return
      }
      if (line.startsWith('F ')) {
        const frame = parseFrameLine(line)
        if (frame) this.emit('frame', frame)
        return
      }
      if (line === 'K escape') { this.emit('escape'); return }
      if (line.startsWith('M ')) {
        const point = parseClickLine(line)
        if (point) this.emit('click', point)
        return
      }
      if (line.startsWith('C ')) {
        this.captureOn = line.slice(2).trim() === 'on'
        this.emit('capture', this.captureOn)
        return
      }
      const probe = parseWatchLine(line)
      if (!probe) return
      this.apply(probe)
    })
    const done = (): void => {
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
    if (h && !h.killed) {
      try { h.stdin?.end() } catch { /* ignore */ }
      try { h.kill() } catch { /* ignore */ }
    }
  }

  private apply(probe: ArenaProbe): void {
    if (probe.status === 'found') {
      const prev = this.lastKnown
      const changed = !prev || prev.x !== probe.rect.x || prev.y !== probe.rect.y ||
        prev.width !== probe.rect.width || prev.height !== probe.rect.height || prev.titleBarHeight !== probe.rect.titleBarHeight
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

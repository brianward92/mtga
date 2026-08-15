/**
 * Arena window geometry (macOS).
 *
 * The badge overlay must sit exactly over the MTGA window, but Electron has
 * no cross-app window API — so we ask System Events (AppleScript) for the
 * front window's position + size of any process matching the known Arena
 * names, polling every 1.5s while a draft (or calibration) is active.
 *
 * Failure modes are first-class, never fatal:
 *   - Accessibility permission missing: osascript fails with -1719 /
 *     "assistive access" — 'accessibility-missing' fires ONCE (the dashboard
 *     shows a setup card with a "test again" button; a later successful
 *     probe re-arms the warning).
 *   - Arena not running / no window: 'lost' fires and the badges hide.
 *
 * Coordinates from System Events are global screen points with the origin at
 * the primary display's top-left — the same space Electron's setBounds uses.
 */

import { EventEmitter } from 'events'
import { execFile, spawn, ChildProcess } from 'child_process'
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
  | { status: 'no-accessibility' }
  | { status: 'error'; message: string }

const POLL_INTERVAL_MS = 1500
const PROBE_TIMEOUT_MS = 3000

// Arena-absent backoff: after this many consecutive misses the poller slows
// to the idle interval (each probe forks osascript — no point at full rate
// while Arena isn't even running), snapping back on the first found rect.
const IDLE_AFTER_MISSES = 5
const IDLE_POLL_INTERVAL_MS = 5000

/** Process names Arena has shipped under on macOS. */
const ARENA_PROCESS_NAMES = ['MTGA', 'MTG Arena', 'MTGArena']

const PROBE_SCRIPT = `
tell application "System Events"
  set ps to (every process whose ${ARENA_PROCESS_NAMES.map(n => `name is "${n}"`).join(' or ')})
  if (count of ps) = 0 then return "NOPROC"
  set p to item 1 of ps
  if (count of windows of p) = 0 then return "NOWIN"
  -- Largest window: macOS attaches small helper windows (e.g. the screen
  -- recording pill) to the process, and "window 1" can be one of those.
  set w to missing value
  set bestArea to 0
  repeat with cand in windows of p
    set csz to size of cand
    set area to (item 1 of csz) * (item 2 of csz)
    if area > bestArea then
      set bestArea to area
      set w to cand
    end if
  end repeat
  if w is missing value then return "NOWIN"
  set pos to position of w
  set sz to size of w
  set fm to "0"
  set fp to name of first process whose frontmost is true
  if fp is name of p or fp is "MTGA Draft Assistant" or fp is "Electron" then set fm to "1"
  return ((item 1 of pos) as text) & "," & ((item 2 of pos) as text) & "," & ((item 1 of sz) as text) & "," & ((item 2 of sz) as text) & "," & fm
end tell
`.trim()

const ACCESSIBILITY_ERROR = /-1719|-25211|assistive access|not authori[sz]ed/i

// Test seam: when MTGA_FAKE_ARENA_FILE names a JSON file ({x,y,width,height}),
// probes read it instead of asking System Events — lets the e2e harness and
// dev sessions exercise Arena-follow/badges without a running Arena. Rewrite
// the file and the poller sees the "window" move on its next tick.
const FAKE_ARENA_FILE = process.env.MTGA_FAKE_ARENA_FILE

function probeFakeArena(path: string): ArenaProbe {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>
    const rect = {
      x: Number(raw.x),
      y: Number(raw.y),
      width: Number(raw.width),
      height: Number(raw.height)
    }
    const finite = Object.values(rect).every(Number.isFinite)
    if (finite && rect.width > 0 && rect.height > 0) return { status: 'found', rect, frontmost: true }
  } catch {
    // Missing/malformed file = no Arena window, matching the real probe
  }
  return { status: 'no-window' }
}

/** One osascript probe for the Arena window. Never throws. */
export function probeArenaWindow(): Promise<ArenaProbe> {
  return new Promise(resolve => {
    if (FAKE_ARENA_FILE) {
      resolve(probeFakeArena(FAKE_ARENA_FILE))
      return
    }
    if (process.platform !== 'darwin') {
      resolve({ status: 'no-window' })
      return
    }
    try {
      execFile(
        '/usr/bin/osascript',
        ['-e', PROBE_SCRIPT],
        { timeout: PROBE_TIMEOUT_MS },
        (error, stdout, stderr) => {
          if (error) {
            const text = `${error.message} ${stderr ?? ''}`
            if (ACCESSIBILITY_ERROR.test(text)) {
              resolve({ status: 'no-accessibility' })
            } else {
              resolve({ status: 'error', message: (stderr || error.message).trim() })
            }
            return
          }

          const out = (stdout ?? '').trim()
          if (out === 'NOPROC' || out === 'NOWIN') {
            resolve({ status: 'no-window' })
            return
          }

          const parts = out.split(',').map(v => parseInt(v.trim(), 10))
          if (parts.length !== 5 || parts.some(v => !Number.isFinite(v))) {
            resolve({ status: 'error', message: `unexpected osascript output: ${out}` })
            return
          }
          const [x, y, width, height, fm] = parts
          if (width <= 0 || height <= 0) {
            resolve({ status: 'no-window' })
            return
          }
          resolve({ status: 'found', rect: { x, y, width, height }, frontmost: fm === 1 })
        }
      )
    } catch (error) {
      resolve({ status: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  })
}

/**
 * Native window-watch helper (native/arena-window-watch.swift): streams
 * "x,y,w,h,frontmost" at ~30Hz on change via CGWindowList — no Accessibility
 * needed, and smooth enough to ride along with a live drag. Resolved from the
 * packaged resources or the dev build dir; null when absent (osascript only).
 */
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

/**
 * Poll-while-active geometry source.
 *
 * Events:
 *   'geometry' (rect)          — Arena found and the rect changed (or was just re-found)
 *   'lost'                     — Arena window gone / not queryable (transition only)
 *   'accessibility-missing'    — one-time until a probe succeeds again
 */
export class ArenaGeometryPoller extends EventEmitter {
  /** Last successfully observed rect (kept across stop/start as a cache). */
  lastKnown: ArenaRect | null = null
  /** Whether Arena was the frontmost app on the last successful probe. */
  arenaFrontmost = true

  private timer: NodeJS.Timeout | null = null
  private helper: ChildProcess | null = null
  private helperAlive = false
  /** Whether the helper's window-capture stream is running (Screen Recording granted). */
  captureOn = false
  /** Ask the helper for the frame stream (needs Screen Recording). */
  wantCapture = true
  private probing = false
  private baseIntervalMs = POLL_INTERVAL_MS
  private currentIntervalMs = POLL_INTERVAL_MS
  private missStreak = 0
  private accessibilityWarned = false
  private state: 'unknown' | 'found' | 'lost' = 'unknown'

  isRunning(): boolean {
    return this.timer !== null
  }

  /** True while the most recent probe found the Arena window. */
  isFound(): boolean {
    return this.state === 'found'
  }

  start(intervalMs: number = POLL_INTERVAL_MS): void {
    if (this.timer) return
    this.baseIntervalMs = intervalMs
    this.currentIntervalMs = intervalMs
    this.missStreak = 0
    void this.pollOnce()
    this.timer = setInterval(() => void this.pollOnce(), intervalMs)
    this.startHelper()
  }

  /** True while the native 30Hz stream is feeding geometry. */
  isStreaming(): boolean {
    return this.helperAlive
  }

  private startHelper(): void {
    if (this.helper) return
    const path = findWindowWatchHelper()
    if (!path) return
    let child: ChildProcess
    try {
      child = spawn(path, this.wantCapture ? ['--capture'] : [], { stdio: ['ignore', 'pipe', 'ignore'] })
    } catch {
      return
    }
    this.helper = child
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
      // Fall back to osascript polling cadence; retry the helper in a while.
      if (this.timer) setTimeout(() => this.timer && this.startHelper(), 10_000)
    }
    child.on('exit', done)
    child.on('error', done)
  }

  private stopHelper(): void {
    const h = this.helper
    this.helper = null
    this.helperAlive = false
    if (h && !h.killed) {
      try { h.kill() } catch { /* ignore */ }
    }
  }

  /** Swap the running interval (idle backoff / recovery). */
  private retime(intervalMs: number): void {
    if (!this.timer || this.currentIntervalMs === intervalMs) return
    clearInterval(this.timer)
    this.currentIntervalMs = intervalMs
    this.timer = setInterval(() => void this.pollOnce(), intervalMs)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.stopHelper()
    this.state = 'unknown'
  }

  /** One immediate probe (also used by the dashboard's "test again" button). */
  async pollOnce(): Promise<ArenaProbe | null> {
    if (this.probing) return null
    // The native stream is authoritative while alive; polling would only add
    // stale, slower samples on top of it.
    if (this.helperAlive && this.timer) return null
    this.probing = true
    try {
      const probe = await probeArenaWindow()
      // A slow osascript result must never overwrite the live stream's rect.
      if (this.helperAlive && this.timer) return probe
      this.apply(probe)
      return probe
    } catch {
      // probeArenaWindow never throws, but the poller must never crash the app
      return null
    } finally {
      this.probing = false
    }
  }

  private apply(probe: ArenaProbe): void {
    // One-shot probe on a stopped poller (dashboard "test again"): report the
    // result to the caller only. Mutating state here would leave isFound()
    // latched true with a stale rect — snapping/anchoring to where Arena
    // used to be — since only running pollers see the correcting next tick.
    if (!this.timer) return

    if (probe.status === 'found') {
      // Success re-arms the one-time accessibility warning
      this.accessibilityWarned = false
      this.missStreak = 0
      this.retime(this.baseIntervalMs)
      const prev = this.lastKnown
      const changed =
        !prev ||
        prev.x !== probe.rect.x ||
        prev.y !== probe.rect.y ||
        prev.width !== probe.rect.width ||
        prev.height !== probe.rect.height
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

    this.missStreak++
    if (this.missStreak >= IDLE_AFTER_MISSES) {
      this.retime(IDLE_POLL_INTERVAL_MS)
    }

    if (probe.status === 'no-accessibility' && !this.accessibilityWarned) {
      this.accessibilityWarned = true
      this.emit('accessibility-missing')
    }

    if (this.state !== 'lost') {
      this.state = 'lost'
      this.emit('lost')
    }
  }
}

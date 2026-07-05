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
import { execFile } from 'child_process'

export interface ArenaRect {
  x: number
  y: number
  width: number
  height: number
}

export type ArenaProbe =
  | { status: 'found'; rect: ArenaRect }
  | { status: 'no-window' }
  | { status: 'no-accessibility' }
  | { status: 'error'; message: string }

const POLL_INTERVAL_MS = 1500
const PROBE_TIMEOUT_MS = 3000

/** Process names Arena has shipped under on macOS. */
const ARENA_PROCESS_NAMES = ['MTGA', 'MTG Arena', 'MTGArena']

const PROBE_SCRIPT = `
tell application "System Events"
  set ps to (every process whose ${ARENA_PROCESS_NAMES.map(n => `name is "${n}"`).join(' or ')})
  if (count of ps) = 0 then return "NOPROC"
  set p to item 1 of ps
  if (count of windows of p) = 0 then return "NOWIN"
  set w to window 1 of p
  set pos to position of w
  set sz to size of w
  return ((item 1 of pos) as text) & "," & ((item 2 of pos) as text) & "," & ((item 1 of sz) as text) & "," & ((item 2 of sz) as text)
end tell
`.trim()

const ACCESSIBILITY_ERROR = /-1719|-25211|assistive access|not authori[sz]ed/i

/** One osascript probe for the Arena window. Never throws. */
export function probeArenaWindow(): Promise<ArenaProbe> {
  return new Promise(resolve => {
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
          if (parts.length !== 4 || parts.some(v => !Number.isFinite(v))) {
            resolve({ status: 'error', message: `unexpected osascript output: ${out}` })
            return
          }
          const [x, y, width, height] = parts
          if (width <= 0 || height <= 0) {
            resolve({ status: 'no-window' })
            return
          }
          resolve({ status: 'found', rect: { x, y, width, height } })
        }
      )
    } catch (error) {
      resolve({ status: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  })
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

  private timer: NodeJS.Timeout | null = null
  private probing = false
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
    void this.pollOnce()
    this.timer = setInterval(() => void this.pollOnce(), intervalMs)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.state = 'unknown'
  }

  /** One immediate probe (also used by the dashboard's "test again" button). */
  async pollOnce(): Promise<ArenaProbe | null> {
    if (this.probing) return null
    this.probing = true
    try {
      const probe = await probeArenaWindow()
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
    if (probe.status === 'found') {
      // Success re-arms the one-time accessibility warning
      this.accessibilityWarned = false
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
      return
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

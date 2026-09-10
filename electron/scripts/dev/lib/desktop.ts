/**
 * Adapter onto `macctl`, the standalone macOS control tool.
 *
 * This file used to BE the control layer: it spawned locally compiled Swift
 * helpers, shelled out to `screencapture`, and drove AppleScript. None of that
 * belongs in a Magic repo, and all of it now lives in
 * ~/src/macOS-computer-control, installed as `macctl` on PATH.
 *
 * What is left here is a translation layer, kept so the Arena-specific tools
 * above it did not all have to change at once. It is deliberately thin: every
 * function is one `macctl` invocation.
 *
 * Two behaviours that came from `macctl` and are worth knowing about here:
 *
 *  - Geometry is read live inside the tool on every call. There is no rect to
 *    pass in and none to cache. A cached rect once said Arena's window was at
 *    113,112 while it was really at 152,33, and every coordinate derived from
 *    it was off by 39 by 79 points for an evening.
 *  - Coordinates below are still screen points, because the callers here work
 *    in points against a rect they fetched. `macctl` itself prefers fractions.
 */
import { execFileSync } from 'child_process'

export interface Point { x: number; y: number }
export interface Rect { x: number; y: number; width: number; height: number }

/** The app these helpers drive. */
const APP = 'MTGA'

export const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))

export function run(cmd: string, args: string[]): string {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })
}

/** One macctl call, returning its JSON line. */
function macctl(...args: Array<string | number>): Record<string, unknown> {
  try {
    // A hard timeout, because a hung macctl used to hang everything above it:
    // execFileSync blocks pick.ts, which blocks pick-next-card.sh inside a
    // command substitution, which blocks arena.sh's draft loop so its own
    // deadline never fires. The draft stops dead, mid-event, with no output and
    // no error. macctl now has its own watchdog; this is the second line of it.
    const out = execFileSync('macctl', args.map(String), {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20_000, killSignal: 'SIGKILL',
    })
    const lines = out.trim().split('\n').filter(Boolean)
    return lines.length ? JSON.parse(lines[lines.length - 1]) : {}
  } catch (err) {
    const e = err as { stdout?: string; status?: number }
    const lines = (e.stdout ?? '').trim().split('\n').filter(Boolean)
    if (lines.length) {
      try { return JSON.parse(lines[lines.length - 1]) } catch { /* fall through */ }
    }
    throw new Error(`macctl ${args.join(' ')} failed (exit ${e.status})`)
  }
}

/** Arena's window, read live. */
export function windowRect(): Rect {
  const w = macctl('window', APP).window as { bounds: number[] } | undefined
  if (!w) throw new Error('macctl could not find Arena\'s window')
  const [x, y, width, height] = w.bounds
  return { x, y, width, height }
}

/** Window-relative fraction to a screen point. */
export function at(rect: Rect, fx: number, fy: number): Point {
  return { x: Math.round(rect.x + fx * rect.width), y: Math.round(rect.y + fy * rect.height) }
}

/** Screen point back to a fraction of the window, which is what macctl takes. */
function fraction(p: Point, rect: Rect): [number, number] {
  return [(p.x - rect.x) / rect.width, (p.y - rect.y) / rect.height]
}

export function activate(): void { macctl('window', APP) }

export function frontmost(): string {
  const w = macctl('window', APP).window as { frontmost?: boolean } | undefined
  return w?.frontmost ? APP : 'other'
}

export function click(p: Point): void {
  const rect = windowRect()
  const [fx, fy] = fraction(p, rect)
  macctl('click', APP, fx, fy)
}

export function move(p: Point): void {
  const rect = windowRect()
  const [fx, fy] = fraction(p, rect)
  macctl('move', APP, fx, fy)
}

export function scroll(p: Point, lines: number): void {
  const rect = windowRect()
  const [fx, fy] = fraction(p, rect)
  macctl('scroll', APP, fx, fy, lines)
}

export function keystroke(text: string): void { macctl('type', text) }
export function selectAll(): void { macctl('key', 'cmd+a') }
export function keyCode(code: number): void {
  // The two codes these tools actually use.
  macctl('key', code === 36 ? 'return' : code === 51 ? 'delete' : String(code))
}

/** Park the pointer low and centre, where nothing hovers. */
export function park(rect: Rect): void { move(at(rect, 0.55, 0.985)) }

/**
 * Take the overlay down and put it back.
 *
 * The overlay's deckbuild sidebar is mirrored over the card pool and swallows
 * clicks in silence — a land tile reads as pressed and nothing is added.
 */
export function overlayApp(action: 'kill' | 'launch'): void {
  try { run('bash', ['scripts/dev/arena.sh', 'app', action]) } catch { /* best effort */ }
}

export function overlayRunning(): boolean {
  try {
    return run('pgrep', ['-f', '/Applications/MTGA Draft Assistant.app/Contents/MacOS']).trim().length > 0
  } catch {
    return false
  }
}

/** Take the overlay down and CONFIRM it went, rather than sleeping and hoping. */
export async function hideOverlayAndConfirm(timeoutMs = 8000): Promise<void> {
  if (!overlayRunning()) return
  overlayApp('kill')
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await sleep(400)
    if (!overlayRunning()) { await sleep(600); return }
  }
  throw new Error('the overlay is still running after a kill; it covers the pool and the land filter, and clicks there would be silently swallowed')
}

export interface OcrLine { text: string; x: number; y: number; w: number; h: number }

/**
 * OCR a screen region into text lines with screen-point y centres.
 *
 * `macctl read` merges Vision's boxes into visual lines, which is wanted —
 * Vision returns "3x" and the name beside it as separate boxes, so anything
 * reading a list has to group them or every row parses as a name with no count.
 *
 * But the merge has no horizontal limit: every box within about 1.2% of the
 * capture height joins one line. Read the whole 748pt window and all five card
 * titles in a pack row weld into one string, which matches no card, so the pick
 * verify fails closed on nearly every cell and the deck builder reads a rail row
 * as absent and adds cards that are already there.
 *
 * So the region is cropped BEFORE the OCR, not filtered after. The merge happens
 * inside Vision's output and cannot be undone downstream — an earlier version of
 * this function filtered the returned lines by y and discarded the caller's x
 * and width entirely, which is exactly the bug.
 *
 * The rect is read live immediately before the call so the fractions cannot be
 * computed against a window that has since moved.
 */
export function readTextLines(region: Rect, _tolerance = 0.012): Array<{ y: number; text: string }> {
  const win = windowRect()
  const fractions = [
    (region.x - win.x) / win.width,
    (region.y - win.y) / win.height,
    region.width / win.width,
    region.height / win.height,
  ]
  if (fractions.some(f => !Number.isFinite(f)) || fractions[2] <= 0 || fractions[3] <= 0) {
    throw new Error(`region ${JSON.stringify(region)} is not inside Arena's window ${JSON.stringify(win)}`)
  }
  const lines = macctl('read', APP, '--region', fractions.map(f => f.toFixed(5)).join(','))
    .lines as Array<{ text: string; at: [number, number] }> | undefined
  if (!lines) return []
  return lines.map(l => ({ y: Math.round(l.at[1]), text: l.text }))
}

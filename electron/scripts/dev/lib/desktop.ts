/**
 * Driving the Mac from a script: pointer, keyboard, screen capture, and OCR.
 *
 * Every dev tool that touches the desktop goes through here, because the
 * mistakes are the same every time and are worth making once:
 *
 *  - **Points, not pixels.** Every coordinate is a screen POINT, what
 *    CGWindowList and System Events report. A screenshot of a 1280pt window
 *    scaled to 1800px on a Retina display is 1.19 px/pt, and mixing the two
 *    puts the click a fifth of the way across the screen from the target.
 *  - **Park the cursor before capturing.** Arena pops a full-size card preview
 *    under the pointer, which covers whatever the shot was meant to read.
 *  - **Capture a region, never the screen.** A bare `screencapture -x` sweeps
 *    up every other window that happens to be open, including the overlay.
 *  - **The overlay covers the left of the deckbuilder.** Its sidebar is
 *    mirrored over the filter bar and the first pool columns, and it swallows
 *    clicks silently: the control reads as pressed and nothing happens.
 */
import { execFileSync } from 'child_process'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

export interface Point { x: number; y: number }
export interface Rect { x: number; y: number; width: number; height: number }

const BIN = join(process.cwd(), 'build', 'dev')

export function run(cmd: string, args: string[]): string {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })
}
const osa = (script: string) => run('osascript', ['-e', script])

export const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))

export function activate(): void { osa('tell application "MTGA" to activate') }
export function frontmost(): string {
  return osa('tell application "System Events" to get name of first application process whose frontmost is true').trim()
}
export function click(p: Point): void { run(join(BIN, 'click'), [String(p.x), String(p.y)]) }
export function move(p: Point): void { run(join(BIN, 'move-mouse'), [String(p.x), String(p.y)]) }
export function scroll(p: Point, lines: number): void { run(join(BIN, 'scroll'), [String(p.x), String(p.y), String(lines)]) }
export function keystroke(text: string): void {
  osa(`tell application "System Events" to keystroke ${JSON.stringify(text)}`)
}
export function selectAll(): void { osa('tell application "System Events" to keystroke "a" using command down') }
export function keyCode(code: number): void { osa(`tell application "System Events" to key code ${code}`) }

/** Window-relative fraction → screen point. */
export function at(rect: Rect, fx: number, fy: number): Point {
  return { x: Math.round(rect.x + fx * rect.width), y: Math.round(rect.y + fy * rect.height) }
}

/** Move the pointer out of the way, low and centre, where nothing hovers. */
export function park(rect: Rect): void { move(at(rect, 0.55, 0.985)) }

/**
 * Take the overlay down and put it back.
 *
 * The deckbuilder needs this: the overlay's sidebar sits over the pool and the
 * land filter, and clicks that land on it do nothing at all. Callers read the
 * plan from the mirrored state first, so nothing is lost while it is down.
 */
export function overlayApp(action: 'kill' | 'launch'): void {
  try { run('bash', ['scripts/dev/arena.sh', 'app', action]) } catch { /* best effort */ }
}

export interface OcrLine { text: string; x: number; y: number; w: number; h: number }

/** Capture one screen region and hand the PNG path to `use`, then delete it. */
export function withRegionCapture<T>(region: Rect, use: (png: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'arena-region-'))
  const png = join(dir, 'region.png')
  try {
    run('screencapture', ['-x', '-tpng', `-R${region.x},${region.y},${region.width},${region.height}`, png])
    return use(png)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** Apple Vision text boxes for a screen region, normalised to the region. */
export function ocrRegion(region: Rect, minHeightFraction?: number): OcrLine[] {
  return withRegionCapture(region, png => {
    const args = [png]
    if (minHeightFraction !== undefined) args.push(String(minHeightFraction))
    return run(join(BIN, 'ocr'), args).split('\n').filter(Boolean).map(l => JSON.parse(l) as OcrLine)
  })
}

/**
 * OCR a region and merge the boxes into text lines by vertical position.
 *
 * Vision returns "3x" and the card name as separate boxes on the same visual
 * line, so anything that reads a list has to group them or every row parses as
 * a name with no count.
 */
export function readTextLines(region: Rect, tolerance = 0.012): Array<{ y: number; text: string }> {
  const tokens = ocrRegion(region).sort((a, b) => a.y - b.y || a.x - b.x)
  const lines: Array<{ y: number; parts: Array<{ x: number; text: string }> }> = []
  for (const t of tokens) {
    const cy = t.y + t.h / 2
    const line = lines.find(l => Math.abs(l.y - cy) < tolerance)
    if (line) line.parts.push({ x: t.x, text: t.text })
    else lines.push({ y: cy, parts: [{ x: t.x, text: t.text }] })
  }
  return lines.map(l => ({
    y: Math.round(region.y + l.y * region.height),
    text: l.parts.sort((a, b) => a.x - b.x).map(p => p.text).join(' ')
  }))
}

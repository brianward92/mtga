/**
 * Keep a copy of Arena's log before Arena destroys it.
 *
 * Unity recreates Player.log on every launch, moving the previous session to
 * Player-prev.log — one backup, no more. So a draft's raw log survives exactly
 * one restart of the game, and the second restart takes it for good. The
 * distilled record in draft-history.jsonl covers the picks and the pool, but
 * the raw log is what any later diagnosis needs, and it cannot be recovered
 * once Arena has rolled past it.
 *
 * Archiving is by content, not by name: a file is copied only if a copy of the
 * same bytes is not already held. Arena's logs are large and mostly noise, so
 * only logs that actually mention a draft are kept, and only the newest few.
 */
import { copyFileSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync } from 'fs'
import { createHash } from 'crypto'
import { join } from 'path'

/** How many archived logs to keep, newest first. */
export const KEEP_ARCHIVES = 8

/** Lines that mean this log is worth keeping. */
const DRAFT_MARKERS = ['BotDraftDraftPick', 'EventPlayerDraftMakePick', 'Draft.Notify', 'EventGetCoursesV2']

function mentionsDraft(file: string): boolean {
  try {
    const text = readFileSync(file, 'utf8')
    return DRAFT_MARKERS.some(m => text.includes(m))
  } catch { return false }
}

function digest(file: string): string | null {
  try { return createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 16) } catch { return null }
}

/**
 * Copy any of `logs` that carries draft data into `dir`, skipping content
 * already held, then prune to the newest KEEP_ARCHIVES. Returns what was added.
 *
 * Best effort throughout: failing to archive a log must never stop the app.
 */
export function archiveLogs(logs: string[], dir: string, keep = KEEP_ARCHIVES): string[] {
  const added: string[] = []
  try {
    mkdirSync(dir, { recursive: true })
    const held = new Set(readdirSync(dir).map(f => f.split('.')[0]))
    for (const log of logs) {
      let stamp: Date
      try { stamp = statSync(log).mtime } catch { continue }
      if (!mentionsDraft(log)) continue
      const hash = digest(log)
      if (!hash || held.has(hash)) continue
      const name = `${hash}.${stamp.toISOString().slice(0, 19).replace(/[:T]/g, '-')}.log`
      copyFileSync(log, join(dir, name))
      held.add(hash)
      added.push(name)
    }
    const files = readdirSync(dir)
      .filter(f => f.endsWith('.log'))
      .map(f => ({ f, at: statSync(join(dir, f)).mtimeMs }))
      .sort((a, b) => b.at - a.at)
    for (const { f } of files.slice(keep)) unlinkSync(join(dir, f))
  } catch (err) {
    console.error('[LogArchive] failed:', err)
  }
  return added
}

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
import { copyFileSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, utimesSync } from 'fs'
import { createHash } from 'crypto'
import { join } from 'path'

/** How many archived logs to keep, newest first. */
export const KEEP_ARCHIVES = 8

/**
 * Lines that mean this log is worth keeping.
 *
 * Deliberately NOT EventGetCoursesV2: Arena emits it on every login, draft or
 * not, so including it made "only logs that mention a draft" mean "every log",
 * and the eight slots filled with noise that evicted the one file holding a
 * draft's picks.
 */
const DRAFT_MARKERS = ['BotDraftDraftPick', 'EventPlayerDraftMakePick', 'Draft.Notify']

/**
 * Read the file once, returning both its content hash and whether it mentions a
 * draft. Arena's logs run to several megabytes and this happens on the main
 * process at startup, so reading them twice — once decoded as UTF-8 for the
 * marker scan and once as bytes for the hash — was pure waste.
 */
function inspect(file: string): { hash: string; draft: boolean } | null {
  try {
    const bytes = readFileSync(file)
    const text = bytes.toString('utf8')
    return {
      hash: createHash('sha256').update(bytes).digest('hex').slice(0, 16),
      draft: DRAFT_MARKERS.some(m => text.includes(m))
    }
  } catch { return null }
}

/** How many picks a log holds, used to decide what to evict last. */
function pickCount(file: string): number {
  try {
    const text = readFileSync(file, 'utf8')
    return DRAFT_MARKERS.reduce((n, m) => n + text.split(m).length - 1, 0)
  } catch { return 0 }
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
      const seen = inspect(log)
      if (!seen || !seen.draft || held.has(seen.hash)) continue
      const name = `${seen.hash}.${stamp.toISOString().slice(0, 19).replace(/[:T]/g, '-')}.log`
      copyFileSync(log, join(dir, name))
      // copyFileSync does not carry the source's mtime, and pruning sorts by it.
      // Without this every copy looked equally new and the ordering was
      // arbitrary, so a fresh copy of today's noise could evict an older log
      // that actually held a draft.
      try { utimesSync(join(dir, name), stamp, stamp) } catch { /* best effort */ }
      held.add(seen.hash)
      added.push(name)
    }
    // Keep the logs with the most draft content first, then the newest. A live
    // log is archived while it is still growing, so several prefixes of one
    // session can pile up; the one with the whole draft in it must outlive them.
    const files = readdirSync(dir)
      .filter(f => f.endsWith('.log'))
      .map(f => ({ f, picks: pickCount(join(dir, f)), at: statSync(join(dir, f)).mtimeMs }))
      .sort((a, b) => b.picks - a.picks || b.at - a.at)
    for (const { f } of files.slice(keep)) unlinkSync(join(dir, f))
  } catch (err) {
    console.error('[LogArchive] failed:', err)
  }
  return added
}

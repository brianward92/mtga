/**
 * Live fallback to Arena's own card database, for grpIds nothing else knows.
 *
 * `arena-cards.json` (arena-cards.ts) ships with the app and covers everything
 * Arena knew when it was generated. A set released after that is exactly the
 * case DraftFM exists for: the client knows the cards on day zero, our bundle
 * does not. Rather than render an unidentified pack — which the badge layer now
 * refuses to draw at all — ask the client's own database.
 *
 * Shape borrowed from FirstPick's ArenaBasicLandResolver, which solves the same
 * problem: newest database by mtime, cache hits *and* misses keyed on the file's
 * identity so a client patch invalidates them, a bounded timeout, and silence
 * when Arena is not installed.
 *
 * sqlite3 is shelled out to because the app ships no SQLite binding and this is
 * a rare, small query. It is synchronous with a short timeout: a pack has at
 * most a handful of unknown ids, and each is asked once per client build.
 */

import { execFileSync } from 'child_process'
import { existsSync, readdirSync, statSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const RAW_DIR = join(homedir(), 'Library', 'Application Support', 'com.wizards.mtga', 'Downloads', 'Raw')
const SQLITE = '/usr/bin/sqlite3'
const TIMEOUT_MS = 2000
// A plain ASCII delimiter rather than a control byte: control characters do
// not survive every source transform and tooling layer intact, and no card name
// or type line contains this sequence.
const SEP = '|~|'

/** Arena's colour enum; Colors/ColorIdentity are numeric code lists, not letters. */
const COLOR: Record<string, string> = { '1': 'W', '2': 'U', '3': 'B', '4': 'R', '5': 'G' }
const RARITY: Record<string, string> = {
  '0': 'token', '1': 'land', '2': 'common', '3': 'uncommon', '4': 'rare', '5': 'mythic'
}

export interface ArenaDbCard {
  name: string
  type: string
  rarity: string
  colors: string
  colorIdentity: string
  order: readonly [number, number, string]
}

interface Snapshot { path: string; key: string }

const hits = new Map<number, ArenaDbCard>()
const misses = new Map<number, string>()

/** Newest Raw_CardDatabase_*.mtga, identified by path+mtime+size. */
function newestDatabase(): Snapshot | null {
  try {
    if (!existsSync(RAW_DIR) || !existsSync(SQLITE)) return null
    let best: Snapshot | null = null
    let bestMtime = -1
    for (const name of readdirSync(RAW_DIR)) {
      if (!name.startsWith('Raw_CardDatabase') || !name.endsWith('.mtga')) continue
      const path = join(RAW_DIR, name)
      const st = statSync(path)
      if (st.mtimeMs > bestMtime) {
        bestMtime = st.mtimeMs
        best = { path, key: `${path}:${st.mtimeMs}:${st.size}` }
      }
    }
    return best
  } catch {
    return null
  }
}

function letters(codes: string): string {
  const set = new Set(codes.split(',').map(c => COLOR[c.trim()]).filter(Boolean))
  return 'WUBRG'.split('').filter(c => set.has(c)).join('')
}

/** Look one grpId up in Arena's database; null when unknown or unavailable. */
export function resolveFromArenaDb(grpId: number): ArenaDbCard | null {
  const cached = hits.get(grpId)
  if (cached) return cached
  const db = newestDatabase()
  if (!db) return null
  if (misses.get(grpId) === db.key) return null

  try {
    const sql = `SELECT t.Loc || '|~|' || IFNULL(ty.Loc,'') || '|~|' || c.Rarity || '|~|'`
      + ` || IFNULL(c.Colors,'') || '|~|' || IFNULL(c.ColorIdentity,'') || '|~|'`
      + ` || c.Order_MythicToCommon || '|~|' || c.Order_ColorOrder || '|~|' || IFNULL(c.Order_Title,'')`
      + ` FROM Cards c`
      + ` JOIN Localizations_enUS t ON t.LocId = c.TitleId AND t.Formatted = 1`
      + ` LEFT JOIN Localizations_enUS ty ON ty.LocId = c.TypeTextId AND ty.Formatted = 1`
      + ` WHERE c.GrpId = ${Math.trunc(grpId)} LIMIT 1;`
    const out = execFileSync(SQLITE, ['-readonly', '-noheader', db.path, sql], {
      encoding: 'utf-8',
      timeout: TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim()
    if (!out) { misses.set(grpId, db.key); return null }

    const [rawName, rawType, rarity, colors, identity, oRarity, oColor, oTitle] = out.split(SEP)
    // Arena wraps hyphenated names in presentation markup: "<nobr>Cat-Gator</nobr>".
    const name = rawName.replace(/<[^>]*>/g, '').trim()
    if (!name) { misses.set(grpId, db.key); return null }
    const card: ArenaDbCard = {
      name,
      type: (rawType || '').replace(/<[^>]*>/g, '').trim(),
      rarity: RARITY[rarity] ?? 'common',
      colors: letters(colors || ''),
      colorIdentity: letters(identity || ''),
      order: [Number(oRarity), Number(oColor), oTitle || name.toLowerCase()]
    }
    hits.set(grpId, card)
    return card
  } catch {
    // Missing sqlite3, a locked database, a timeout: fall back to unresolved.
    misses.set(grpId, db.key)
    return null
  }
}

/** Test seam. */
export function clearArenaDbCache(): void {
  hits.clear()
  misses.clear()
}

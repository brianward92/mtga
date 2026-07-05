/**
 * Arena card database reader.
 *
 * Reads Arena's own card database directly — the only source that is correct
 * on day 0 of a new set and works fully offline:
 *   ~/Library/Application Support/com.wizards.mtga/Downloads/Raw/Raw_CardDatabase_<hash>.mtga
 * (SQLite; newest mtime wins when Arena keeps several around.)
 *
 * The query is a TypeScript port of scripts/build_arena_mapping.py:
 * Cards (IsToken=0 AND IsPrimaryCard=1) joined to the English localization
 * table via TitleId, with Arena's "o2oUoU" mana notation converted to
 * "{2}{U}{U}".
 *
 * A JSON snapshot is cached under userData/cache/ and used as fallback when
 * the DB is locked (Arena mid-update) or absent.
 */

import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { homedir } from 'os'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'

export interface ArenaCard {
  name: string
  manaCost: string
  type: string
  rarity: string
  colors: string[]
  colorIdentity: string[]
  setCode: string
  imageUrl?: string
}

const ARENA_RAW_DIR = join(homedir(), 'Library/Application Support/com.wizards.mtga/Downloads/Raw')

const COLOR_MAP: Record<number, string> = { 1: 'W', 2: 'U', 3: 'B', 4: 'R', 5: 'G' }
// Arena's Rarity enum: 0=token, 1=basic land, 2=common, 3=uncommon, 4=rare, 5=mythic
const RARITY_MAP: Record<number, string> = {
  0: 'token',
  1: 'land',
  2: 'common',
  3: 'uncommon',
  4: 'rare',
  5: 'mythic'
}

// Bump when snapshot contents change meaning (e.g. the rarity enum fix): a
// version mismatch discards the stale cache, which is rewritten on the next
// successful Arena DB read.
const SNAPSHOT_VERSION = 2

function snapshotPath(): string {
  // TODO: userData/cache collides with Chromium's disk cache (userData/Cache)
  // on macOS's case-insensitive filesystem, and Chromium deletes foreign
  // files there at startup (the ratings cache moved to ratings-cache/ for
  // this reason). Tolerable here only because the snapshot is rewritten on
  // every successful Arena DB read; move it when convenient.
  return join(app.getPath('userData'), 'cache', 'arena-cards.json')
}

/** Find the newest Raw_CardDatabase_*.mtga by mtime. */
export function findArenaDatabase(): string | null {
  if (!existsSync(ARENA_RAW_DIR)) return null

  let newest: { path: string; mtime: number } | null = null
  for (const file of readdirSync(ARENA_RAW_DIR)) {
    if (!file.startsWith('Raw_CardDatabase') || !file.endsWith('.mtga')) continue
    const path = join(ARENA_RAW_DIR, file)
    try {
      const mtime = statSync(path).mtimeMs
      if (!newest || mtime > newest.mtime) {
        newest = { path, mtime }
      }
    } catch {
      // ignore files that vanish mid-scan (Arena updating)
    }
  }
  return newest?.path ?? null
}

/** Convert Arena mana notation: "o2oUoU" -> "{2}{U}{U}", "o(W/U)" -> "{W/U}". */
export function convertManaCost(raw: string): string {
  if (!raw) return ''
  return raw.replace(/o(\([^)]*\)|\d+|[A-Za-z])/g, (_match, sym: string) => {
    return `{${sym.replace(/[()]/g, '')}}`
  })
}

function parseColorList(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw) return []
  return raw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(c => COLOR_MAP[parseInt(c, 10)] ?? c)
}

/**
 * Load the English localization lookup, handling schema drift across client
 * builds: current builds use Localizations_enUS(LocId, Loc, Formatted);
 * older ones a single Localizations table with an enUS column.
 * Prefers the lowest-Formatted row per LocId.
 */
function loadLocalizations(db: Database.Database): Map<number, string> {
  const tables = new Set(
    (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>)
      .map(row => row.name)
  )

  const loc = new Map<number, string>()

  if (tables.has('Localizations_enUS')) {
    const columns = new Set(
      (db.prepare('PRAGMA table_info(Localizations_enUS)').all() as Array<{ name: string }>)
        .map(row => row.name)
    )
    const query = columns.has('Formatted')
      ? 'SELECT LocId, Loc FROM Localizations_enUS ORDER BY Formatted DESC'
      : 'SELECT LocId, Loc FROM Localizations_enUS'
    // ORDER BY Formatted DESC: the map insert below overwrites, so the
    // lowest-Formatted (plain text) row per LocId wins.
    for (const row of db.prepare(query).iterate() as IterableIterator<{ LocId: number; Loc: string }>) {
      loc.set(row.LocId, row.Loc)
    }
  } else if (tables.has('Localizations')) {
    for (const row of db.prepare('SELECT LocId, enUS AS Loc FROM Localizations').iterate() as IterableIterator<{ LocId: number; Loc: string }>) {
      loc.set(row.LocId, row.Loc)
    }
  } else {
    throw new Error('Arena DB schema drift: no Localizations table found')
  }

  return loc
}

function readArenaDatabase(dbPath: string): Map<number, ArenaCard> {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true })
  try {
    const loc = loadLocalizations(db)

    const cardColumns = new Set(
      (db.prepare('PRAGMA table_info(Cards)').all() as Array<{ name: string }>).map(row => row.name)
    )
    // DigitalReleaseSet (when present) is more accurate than ExpansionCode
    // for Alchemy-only printings.
    const setExpr = cardColumns.has('DigitalReleaseSet')
      ? "COALESCE(NULLIF(DigitalReleaseSet, ''), ExpansionCode)"
      : 'ExpansionCode'

    const rows = db.prepare(`
      SELECT GrpId, TitleId, TypeTextId, Rarity, ${setExpr} AS SetCode,
             Colors, ColorIdentity, OldSchoolManaText
      FROM Cards
      WHERE IsToken = 0 AND IsPrimaryCard = 1
    `).all() as Array<Record<string, unknown>>

    const cards = new Map<number, ArenaCard>()
    for (const row of rows) {
      const grpId = Number(row.GrpId)
      if (!Number.isFinite(grpId)) continue

      cards.set(grpId, {
        name: loc.get(Number(row.TitleId)) ?? `Unknown (${row.TitleId})`,
        manaCost: convertManaCost((row.OldSchoolManaText as string) || ''),
        type: loc.get(Number(row.TypeTextId)) ?? '',
        rarity: RARITY_MAP[Number(row.Rarity)] ?? 'common',
        colors: parseColorList(row.Colors),
        colorIdentity: parseColorList(row.ColorIdentity),
        setCode: ((row.SetCode as string) || '').toUpperCase()
      })
    }
    return cards
  } finally {
    db.close()
  }
}

function writeSnapshot(cards: Map<number, ArenaCard>): void {
  try {
    const path = snapshotPath()
    const dir = join(app.getPath('userData'), 'cache')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(
      path,
      JSON.stringify({ version: SNAPSHOT_VERSION, cards: Object.fromEntries(cards) })
    )
  } catch (error) {
    console.error('[ArenaDB] Failed to write snapshot:', error)
  }
}

function loadSnapshot(): Map<number, ArenaCard> {
  try {
    const path = snapshotPath()
    if (!existsSync(path)) return new Map()
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as {
      version?: number
      cards?: Record<string, ArenaCard>
    }
    if (parsed.version !== SNAPSHOT_VERSION || !parsed.cards) {
      // Stale schema (or the legacy unversioned flat format): discard. A
      // fresh snapshot is written on the next successful Arena DB read.
      console.log('[ArenaDB] Discarding outdated snapshot (schema version change)')
      rmSync(path, { force: true })
      return new Map()
    }
    const cards = new Map<number, ArenaCard>()
    for (const [grpId, card] of Object.entries(parsed.cards)) {
      cards.set(parseInt(grpId, 10), card)
    }
    console.log(`[ArenaDB] Loaded ${cards.size} cards from snapshot`)
    return cards
  } catch (error) {
    console.error('[ArenaDB] Failed to load snapshot:', error)
    return new Map()
  }
}

/**
 * Load the grpId -> card map: Arena SQLite first (snapshotted for next time),
 * cached snapshot when the DB is locked or absent.
 */
export function loadArenaCards(): Map<number, ArenaCard> {
  const dbPath = findArenaDatabase()
  if (dbPath) {
    try {
      const cards = readArenaDatabase(dbPath)
      console.log(`[ArenaDB] Loaded ${cards.size} cards from ${dbPath}`)
      writeSnapshot(cards)
      return cards
    } catch (error) {
      console.error('[ArenaDB] Failed to read Arena DB, falling back to snapshot:', error)
    }
  } else {
    console.log('[ArenaDB] No Arena card database found, using snapshot')
  }
  return loadSnapshot()
}

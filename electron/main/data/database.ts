/**
 * Database module for MTGA Tracker
 *
 * Handles all SQLite database operations including:
 * - Match history storage and retrieval
 * - Deck tracking
 * - Collection management
 * - Inventory snapshots
 *
 * Uses better-sqlite3 for synchronous, high-performance SQLite operations.
 */

import Database from 'better-sqlite3'
import { join } from 'path'
import { app } from 'electron'
import { existsSync, mkdirSync } from 'fs'

/** Match record from the database */
export interface Match {
  id: string
  eventId: string
  format: string
  deckId: string | null
  deckName: string | null
  opponentName: string
  result: 'win' | 'loss' | 'draw'
  gameCount: number
  startedAt: Date
  endedAt: Date | null
  onPlay: boolean
  notes?: string
  winCondition?: string
  finalTurn?: number
  opponentPlatform?: string
}

export interface Deck {
  id: string
  name: string
  format: string
  mainDeck: string // JSON
  sideboard: string // JSON
  lastPlayed: Date | null
  createdAt: Date
}

export interface CollectionEntry {
  grpId: number
  quantity: number
  updatedAt: Date
}

/** Singleton database instance */
let db: Database.Database | null = null

/**
 * Initialize the SQLite database.
 * Creates tables if they don't exist and enables WAL mode for better performance.
 * @returns The initialized database instance
 */
export function initDatabase(): Database.Database {
  if (db) return db

  // Get user data path
  const userDataPath = app.getPath('userData')
  const dbDir = join(userDataPath, 'data')

  // Ensure directory exists
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true })
  }

  const dbPath = join(dbDir, 'mtga-tracker.db')
  db = new Database(dbPath)

  // Enable WAL mode for better performance
  db.pragma('journal_mode = WAL')

  // Create tables
  createTables(db)

  return db
}

function createTables(db: Database.Database): void {
  // Matches table
  db.exec(`
    CREATE TABLE IF NOT EXISTS matches (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      format TEXT NOT NULL,
      deck_id TEXT,
      deck_name TEXT,
      opponent_name TEXT NOT NULL,
      result TEXT NOT NULL CHECK (result IN ('win', 'loss', 'draw')),
      game_count INTEGER DEFAULT 1,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      on_play INTEGER DEFAULT 0,
      notes TEXT
    )
  `)

  // Add columns if they don't exist (for existing databases)
  const newColumns = [
    'notes TEXT',
    'win_condition TEXT',
    'final_turn INTEGER',
    'opponent_platform TEXT'
  ]
  for (const col of newColumns) {
    try {
      db.exec(`ALTER TABLE matches ADD COLUMN ${col}`)
    } catch {
      // Column already exists, ignore error
    }
  }

  // Decks table
  db.exec(`
    CREATE TABLE IF NOT EXISTS decks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      format TEXT,
      main_deck TEXT NOT NULL,
      sideboard TEXT,
      last_played TEXT,
      created_at TEXT NOT NULL
    )
  `)

  // Collection table
  db.exec(`
    CREATE TABLE IF NOT EXISTS collection (
      grp_id INTEGER PRIMARY KEY,
      quantity INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    )
  `)

  // Inventory table (for tracking gems, gold, wildcards over time)
  db.exec(`
    CREATE TABLE IF NOT EXISTS inventory_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      gems INTEGER NOT NULL,
      gold INTEGER NOT NULL,
      wc_common INTEGER NOT NULL,
      wc_uncommon INTEGER NOT NULL,
      wc_rare INTEGER NOT NULL,
      wc_mythic INTEGER NOT NULL,
      vault_progress REAL NOT NULL,
      recorded_at TEXT NOT NULL
    )
  `)

  // Create indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_matches_started ON matches(started_at);
    CREATE INDEX IF NOT EXISTS idx_matches_deck ON matches(deck_id);
    CREATE INDEX IF NOT EXISTS idx_decks_name ON decks(name);
  `)
}

// ============================================================================
// Match Operations
// ============================================================================

/**
 * Insert or update a match record.
 * Uses ON CONFLICT to handle duplicate match IDs gracefully.
 */
export function insertMatch(match: Omit<Match, 'endedAt'>): void {
  const db = initDatabase()
  const stmt = db.prepare(`
    INSERT INTO matches (id, event_id, format, deck_id, deck_name, opponent_name, result, game_count, started_at, on_play, opponent_platform)
    VALUES (@id, @eventId, @format, @deckId, @deckName, @opponentName, @result, @gameCount, @startedAt, @onPlay, @opponentPlatform)
    ON CONFLICT(id) DO UPDATE SET
      event_id = @eventId,
      format = @format,
      deck_id = COALESCE(@deckId, deck_id),
      deck_name = COALESCE(@deckName, deck_name),
      opponent_name = @opponentName,
      result = @result,
      game_count = @gameCount,
      opponent_platform = COALESCE(@opponentPlatform, opponent_platform)
  `)

  stmt.run({
    id: match.id,
    eventId: match.eventId,
    format: match.format,
    deckId: match.deckId,
    deckName: match.deckName,
    opponentName: match.opponentName,
    result: match.result,
    gameCount: match.gameCount,
    startedAt: match.startedAt.toISOString(),
    onPlay: match.onPlay ? 1 : 0,
    opponentPlatform: match.opponentPlatform || null
  })
}

/**
 * Update a match with the final result.
 * Called when a match ends to record the outcome.
 */
export function updateMatchEnd(
  matchId: string,
  result: 'win' | 'loss' | 'draw',
  gameCount: number,
  winCondition?: string,
  finalTurn?: number
): void {
  const db = initDatabase()
  const stmt = db.prepare(`
    UPDATE matches SET result = @result, game_count = @gameCount, ended_at = @endedAt,
      win_condition = @winCondition, final_turn = @finalTurn
    WHERE id = @matchId
  `)

  stmt.run({
    matchId,
    result,
    gameCount,
    endedAt: new Date().toISOString(),
    winCondition: winCondition || null,
    finalTurn: finalTurn || null
  })
}

/**
 * Update the deck name for an existing match.
 * Called when deck information arrives after match start.
 */
export function updateMatchDeckName(matchId: string, deckName: string, deckId?: string | null): void {
  const db = initDatabase()
  const stmt = db.prepare(`
    UPDATE matches SET deck_name = @deckName, deck_id = COALESCE(@deckId, deck_id)
    WHERE id = @matchId AND (deck_name IS NULL OR deck_name = 'Unknown Deck')
  `)

  stmt.run({
    matchId,
    deckName,
    deckId: deckId || null
  })
}

/**
 * Update match notes
 */
export function updateMatchNotes(matchId: string, notes: string): void {
  const db = initDatabase()
  const stmt = db.prepare(`
    UPDATE matches SET notes = @notes WHERE id = @matchId
  `)

  stmt.run({
    matchId,
    notes: notes || null
  })
}

/**
 * Get recent matches ordered by start time.
 * @param limit Maximum number of matches to return (default: 50)
 */
export function getRecentMatches(limit: number = 50): Match[] {
  const db = initDatabase()
  const stmt = db.prepare(`
    SELECT * FROM matches ORDER BY started_at DESC LIMIT ?
  `)

  const rows = stmt.all(limit) as Array<Record<string, unknown>>
  return rows.map(rowToMatch)
}

/**
 * Get aggregated match statistics.
 * @param deckId Optional deck ID to filter by
 * @returns Win/loss/draw counts and overall win rate
 */
export function getMatchStats(deckId?: string): { wins: number; losses: number; draws: number; winRate: number } {
  const db = initDatabase()

  let query = 'SELECT result, COUNT(*) as count FROM matches'
  const params: unknown[] = []

  if (deckId) {
    query += ' WHERE deck_id = ?'
    params.push(deckId)
  }

  query += ' GROUP BY result'

  const stmt = db.prepare(query)
  const rows = stmt.all(...params) as Array<{ result: string; count: number }>

  const stats = { wins: 0, losses: 0, draws: 0, winRate: 0 }

  for (const row of rows) {
    if (row.result === 'win') stats.wins = row.count
    else if (row.result === 'loss') stats.losses = row.count
    else if (row.result === 'draw') stats.draws = row.count
  }

  const total = stats.wins + stats.losses
  stats.winRate = total > 0 ? (stats.wins / total) * 100 : 0

  return stats
}

/**
 * Get play/draw specific win rates.
 * @param deckId Optional deck ID to filter by
 * @returns Win/loss counts for on_play and on_draw
 */
export function getPlayDrawStats(deckId?: string): {
  onPlay: { wins: number; losses: number; winRate: number }
  onDraw: { wins: number; losses: number; winRate: number }
} {
  const db = initDatabase()

  let whereClause = ''
  const params: unknown[] = []

  if (deckId) {
    whereClause = ' WHERE deck_id = ?'
    params.push(deckId)
  }

  // Query for on_play matches
  const playQuery = `SELECT result, COUNT(*) as count FROM matches${whereClause} AND on_play = 1 GROUP BY result`
  const playStmt = db.prepare(playQuery)
  const playRows = playStmt.all(...params) as Array<{ result: string; count: number }>

  // Query for on_draw matches
  const drawQuery = `SELECT result, COUNT(*) as count FROM matches${whereClause} AND on_play = 0 GROUP BY result`
  const drawStmt = db.prepare(drawQuery)
  const drawRows = drawStmt.all(...params) as Array<{ result: string; count: number }>

  const onPlay = { wins: 0, losses: 0, winRate: 0 }
  const onDraw = { wins: 0, losses: 0, winRate: 0 }

  for (const row of playRows) {
    if (row.result === 'win') onPlay.wins = row.count
    else if (row.result === 'loss') onPlay.losses = row.count
  }

  for (const row of drawRows) {
    if (row.result === 'win') onDraw.wins = row.count
    else if (row.result === 'loss') onDraw.losses = row.count
  }

  const playTotal = onPlay.wins + onPlay.losses
  onPlay.winRate = playTotal > 0 ? (onPlay.wins / playTotal) * 100 : 0

  const drawTotal = onDraw.wins + onDraw.losses
  onDraw.winRate = drawTotal > 0 ? (onDraw.wins / drawTotal) * 100 : 0

  return { onPlay, onDraw }
}

/**
 * Get opponent statistics
 * @param deckId Optional deck ID to filter by
 * @returns Array of opponent stats sorted by match count
 */
export function getOpponentStats(deckId?: string): Array<{
  opponentName: string
  wins: number
  losses: number
  draws: number
  winRate: number
  total: number
  lastPlayed: Date
}> {
  const db = initDatabase()

  let query = 'SELECT opponent_name, result, started_at, COUNT(*) as count FROM matches'
  const params: unknown[] = []

  if (deckId) {
    query += ' WHERE deck_id = ?'
    params.push(deckId)
  }

  query += ' GROUP BY opponent_name, result ORDER BY started_at DESC'

  const stmt = db.prepare(query)
  const rows = stmt.all(...params) as Array<{ opponent_name: string; result: string; started_at: string; count: number }>

  // Aggregate by opponent
  const opponentMap = new Map<string, { wins: number; losses: number; draws: number; lastPlayed: Date }>()

  for (const row of rows) {
    if (!opponentMap.has(row.opponent_name)) {
      opponentMap.set(row.opponent_name, { wins: 0, losses: 0, draws: 0, lastPlayed: new Date(row.started_at) })
    }

    const stats = opponentMap.get(row.opponent_name)!
    if (row.result === 'win') stats.wins += row.count
    else if (row.result === 'loss') stats.losses += row.count
    else if (row.result === 'draw') stats.draws += row.count

    // Update last played
    const rowDate = new Date(row.started_at)
    if (rowDate > stats.lastPlayed) {
      stats.lastPlayed = rowDate
    }
  }

  // Convert to array and calculate win rates
  const result = Array.from(opponentMap.entries()).map(([opponentName, stats]) => {
    const total = stats.wins + stats.losses + stats.draws
    const winRate = stats.wins + stats.losses > 0 ? (stats.wins / (stats.wins + stats.losses)) * 100 : 0

    return {
      opponentName,
      wins: stats.wins,
      losses: stats.losses,
      draws: stats.draws,
      winRate,
      total,
      lastPlayed: stats.lastPlayed
    }
  })

  // Sort by total matches
  result.sort((a, b) => b.total - a.total)

  return result
}

/**
 * Get statistics broken down by format.
 * @param deckId Optional deck ID to filter by
 * @returns Array of format stats
 */
export function getStatsByFormat(deckId?: string): Array<{
  format: string
  eventId: string
  wins: number
  losses: number
  draws: number
  winRate: number
  total: number
}> {
  const db = initDatabase()

  let query = 'SELECT format, event_id, result, COUNT(*) as count FROM matches'
  const params: unknown[] = []

  if (deckId) {
    query += ' WHERE deck_id = ?'
    params.push(deckId)
  }

  query += ' GROUP BY format, event_id, result'

  const stmt = db.prepare(query)
  const rows = stmt.all(...params) as Array<{ format: string; event_id: string; result: string; count: number }>

  // Aggregate by format
  const formatMap = new Map<string, { wins: number; losses: number; draws: number }>()

  for (const row of rows) {
    const key = row.format || row.event_id
    if (!formatMap.has(key)) {
      formatMap.set(key, { wins: 0, losses: 0, draws: 0 })
    }

    const stats = formatMap.get(key)!
    if (row.result === 'win') stats.wins += row.count
    else if (row.result === 'loss') stats.losses += row.count
    else if (row.result === 'draw') stats.draws += row.count
  }

  // Convert to array and calculate win rates
  const result = Array.from(formatMap.entries()).map(([format, stats]) => {
    const total = stats.wins + stats.losses + stats.draws
    const winRate = stats.wins + stats.losses > 0 ? (stats.wins / (stats.wins + stats.losses)) * 100 : 0

    return {
      format,
      eventId: format,
      wins: stats.wins,
      losses: stats.losses,
      draws: stats.draws,
      winRate,
      total
    }
  })

  // Sort by total matches
  result.sort((a, b) => b.total - a.total)

  return result
}

// ============================================================================
// Deck Operations
// ============================================================================

/**
 * Insert or update a deck record.
 */
export function upsertDeck(deck: Deck): void {
  const db = initDatabase()
  const stmt = db.prepare(`
    INSERT INTO decks (id, name, format, main_deck, sideboard, last_played, created_at)
    VALUES (@id, @name, @format, @mainDeck, @sideboard, @lastPlayed, @createdAt)
    ON CONFLICT(id) DO UPDATE SET
      name = @name,
      format = @format,
      main_deck = @mainDeck,
      sideboard = @sideboard,
      last_played = @lastPlayed
  `)

  stmt.run({
    id: deck.id,
    name: deck.name,
    format: deck.format,
    mainDeck: deck.mainDeck,
    sideboard: deck.sideboard,
    lastPlayed: deck.lastPlayed?.toISOString() || null,
    createdAt: deck.createdAt.toISOString()
  })
}

export function getDeck(id: string): Deck | null {
  const db = initDatabase()
  const stmt = db.prepare('SELECT * FROM decks WHERE id = ?')
  const row = stmt.get(id) as Record<string, unknown> | undefined

  if (!row) return null
  return rowToDeck(row)
}

// ============================================================================
// Collection Operations
// ============================================================================

/**
 * Update the card collection from MTGA inventory data.
 * Uses a transaction for bulk updates.
 */
export function updateCollection(collection: Record<number, number>): void {
  const db = initDatabase()
  const now = new Date().toISOString()

  const stmt = db.prepare(`
    INSERT INTO collection (grp_id, quantity, updated_at)
    VALUES (@grpId, @quantity, @updatedAt)
    ON CONFLICT(grp_id) DO UPDATE SET
      quantity = @quantity,
      updated_at = @updatedAt
  `)

  const updateMany = db.transaction((items: Array<{ grpId: number; quantity: number }>) => {
    for (const item of items) {
      stmt.run({ grpId: item.grpId, quantity: item.quantity, updatedAt: now })
    }
  })

  const items = Object.entries(collection).map(([grpId, quantity]) => ({
    grpId: parseInt(grpId, 10),
    quantity
  }))

  updateMany(items)
}

export function getCollection(): Record<number, number> {
  const db = initDatabase()
  const stmt = db.prepare('SELECT grp_id, quantity FROM collection')
  const rows = stmt.all() as Array<{ grp_id: number; quantity: number }>

  const collection: Record<number, number> = {}
  for (const row of rows) {
    collection[row.grp_id] = row.quantity
  }

  return collection
}

/**
 * Get collection statistics
 */
export function getCollectionStats(): {
  totalCards: number
  uniqueCards: number
  byRarity: Record<string, number>
} {
  const db = initDatabase()
  const stmt = db.prepare('SELECT SUM(quantity) as total, COUNT(*) as unique FROM collection')
  const result = stmt.get() as { total: number | null; unique: number | null }

  return {
    totalCards: result.total || 0,
    uniqueCards: result.unique || 0,
    byRarity: {}
  }
}

// ============================================================================
// Inventory Snapshots
// ============================================================================

/**
 * Record an inventory snapshot for historical tracking.
 * Called each time inventory data is received from the game.
 */
export function recordInventorySnapshot(inventory: {
  gems: number
  gold: number
  wcCommon: number
  wcUncommon: number
  wcRare: number
  wcMythic: number
  vaultProgress: number
}): void {
  const db = initDatabase()
  const stmt = db.prepare(`
    INSERT INTO inventory_snapshots (gems, gold, wc_common, wc_uncommon, wc_rare, wc_mythic, vault_progress, recorded_at)
    VALUES (@gems, @gold, @wcCommon, @wcUncommon, @wcRare, @wcMythic, @vaultProgress, @recordedAt)
  `)

  stmt.run({
    gems: inventory.gems,
    gold: inventory.gold,
    wcCommon: inventory.wcCommon,
    wcUncommon: inventory.wcUncommon,
    wcRare: inventory.wcRare,
    wcMythic: inventory.wcMythic,
    vaultProgress: inventory.vaultProgress,
    recordedAt: new Date().toISOString()
  })
}

// ============================================================================
// Helper Functions
// ============================================================================

/** Convert a database row to a Match object */
function rowToMatch(row: Record<string, unknown>): Match {
  return {
    id: row.id as string,
    eventId: row.event_id as string,
    format: row.format as string,
    deckId: row.deck_id as string | null,
    deckName: row.deck_name as string | null,
    opponentName: row.opponent_name as string,
    result: row.result as 'win' | 'loss' | 'draw',
    gameCount: row.game_count as number,
    startedAt: new Date(row.started_at as string),
    endedAt: row.ended_at ? new Date(row.ended_at as string) : null,
    onPlay: Boolean(row.on_play),
    notes: row.notes as string | undefined,
    winCondition: row.win_condition as string | undefined,
    finalTurn: row.final_turn as number | undefined,
    opponentPlatform: row.opponent_platform as string | undefined
  }
}

/** Convert a database row to a Deck object */
function rowToDeck(row: Record<string, unknown>): Deck {
  return {
    id: row.id as string,
    name: row.name as string,
    format: row.format as string,
    mainDeck: row.main_deck as string,
    sideboard: row.sideboard as string,
    lastPlayed: row.last_played ? new Date(row.last_played as string) : null,
    createdAt: new Date(row.created_at as string)
  }
}

/**
 * Close the database connection.
 * Should be called when the application is quitting.
 */
export function closeDatabase(): void {
  if (db) {
    db.close()
    db = null
  }
}

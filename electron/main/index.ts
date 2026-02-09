/**
 * MTGA Tracker - Main Process Entry Point
 *
 * This is the Electron main process that coordinates:
 * - Log file watching and parsing
 * - Database operations for match history
 * - Window management (overlay and dashboard)
 * - IPC communication with renderer processes
 */

import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { LogWatcher } from './parser/watcher'
import { LogParser } from './parser/index'
import { createOverlayWindow } from './windows/overlay'
import { createRegistryWindow } from './windows/registry'
import {
  initDatabase,
  closeDatabase,
  insertMatch,
  updateMatchEnd,
  updateMatchDeckName,
  updateMatchNotes,
  getRecentMatches,
  getMatchStats,
  getPlayDrawStats,
  getStatsByFormat,
  getOpponentStats,
  updateCollection,
  getCollection,
  getCollectionStats,
  recordInventorySnapshot
} from './data/database'
import { loadCardRegistry, getCard, getCardName, getSetList, getCardsBySet } from './data/card-registry'
import { formatEventId } from './utils/format-utils'

// Window references
let overlayWindow: BrowserWindow | null = null
let registryWindow: BrowserWindow | null = null

// Core services
let logWatcher: LogWatcher | null = null
let logParser: LogParser | null = null

// Current match state
let currentMatchId: string | null = null
let currentDeckName: string | null = null

/**
 * Create all application windows
 */
async function createWindows(): Promise<void> {
  overlayWindow = createOverlayWindow()
  registryWindow = createRegistryWindow()
}

/**
 * Initialize the log parser and set up event handlers.
 * Events from the parser are forwarded to renderer windows and persisted to the database.
 */
function setupLogParser(): void {
  logParser = new LogParser()

  // Inventory updates (gems, gold, wildcards)
  logParser.on('inventory', (data) => {
    overlayWindow?.webContents.send('inventory-update', data)
    registryWindow?.webContents.send('inventory-update', data)

    console.log('[Parser] Inventory:', {
      gems: data.gems,
      gold: data.gold,
      wc: `${data.wcMythic}M/${data.wcRare}R/${data.wcUncommon}U/${data.wcCommon}C`
    })

    try {
      recordInventorySnapshot(data)
    } catch (error) {
      console.error('[DB] Failed to record inventory:', error)
    }
  })

  // Collection updates
  logParser.on('collection', (data) => {
    registryWindow?.webContents.send('collection-update', data)
    console.log('[Parser] Collection:', Object.keys(data).length, 'cards')

    try {
      updateCollection(data)
    } catch (error) {
      console.error('[DB] Failed to update collection:', error)
    }
  })

  // Match start
  logParser.on('match-start', (data) => {
    overlayWindow?.webContents.send('match-start', data)
    currentMatchId = data.matchId

    const deckName = currentDeckName || logParser?.getCurrentDeckName() || null
    console.log('[Parser] Match started:', data.matchId, 'Deck:', deckName || 'Unknown')

    try {
      insertMatch({
        id: data.matchId,
        eventId: data.eventId,
        format: data.gameMode || data.eventId,
        deckId: null,
        deckName: deckName,
        opponentName: data.opponentName,
        result: 'draw',
        gameCount: 1,
        startedAt: new Date(),
        onPlay: data.seatId === 1
      })
    } catch (error) {
      console.error('[DB] Failed to insert match:', error)
    }
  })

  // Match end
  logParser.on('match-end', (data) => {
    overlayWindow?.webContents.send('match-end', data)
    registryWindow?.webContents.send('match-end', data)
    console.log('[Parser] Match ended:', data.matchId, 'Result:', data.result)

    try {
      updateMatchEnd(data.matchId, data.result, data.gameCount)
    } catch (error) {
      console.error('[DB] Failed to update match:', error)
    }

    currentMatchId = null
  })

  // Game state updates (for deck tracker)
  logParser.on('game-state', (data) => {
    overlayWindow?.webContents.send('game-state', data)
  })

  // Deck submission (cards in deck)
  logParser.on('deck-submission', (data) => {
    overlayWindow?.webContents.send('deck-submission', data)

    if (data.deckName && data.deckName !== 'Unknown Deck') {
      currentDeckName = data.deckName

      // Update the database if we're in a match and got a valid deck name
      if (currentMatchId) {
        try {
          updateMatchDeckName(currentMatchId, data.deckName, data.deckId || null)
          console.log('[Parser] Updated match deck name:', data.deckName)
        } catch (error) {
          console.error('[DB] Failed to update match deck name:', error)
        }
      }
    }
    console.log('[Parser] Deck:', data.deckName)
  })

  // Deck selected (from Courses data)
  logParser.on('deck-selected', (data) => {
    if (data.deckName && data.deckName !== 'Unknown Deck') {
      currentDeckName = data.deckName
      overlayWindow?.webContents.send('deck-selected', data)
      console.log('[Parser] Deck selected:', data.deckName)

      // Update the database if we're in a match
      if (currentMatchId) {
        try {
          updateMatchDeckName(currentMatchId, data.deckName, data.deckId || null)
          console.log('[Parser] Updated match deck name from selection:', data.deckName)
        } catch (error) {
          console.error('[DB] Failed to update match deck name:', error)
        }
      }
    }
  })
}

/**
 * Initialize the log file watcher.
 * Watches MTGA log files and forwards lines to the parser.
 */
function setupLogWatcher(): void {
  logWatcher = new LogWatcher()

  logWatcher.on('line', (line: string) => {
    logParser?.parseLine(line)
  })

  logWatcher.on('error', (error: Error) => {
    console.error('[Watcher] Error:', error.message)
  })

  logWatcher.on('watching', (path: string) => {
    console.log('[Watcher] Watching:', path)
  })

  logWatcher.start()
}

// ============================================================================
// IPC Handlers - Expose data to renderer processes
// ============================================================================

ipcMain.handle('get-state', () => {
  return logParser?.getState() ?? null
})

ipcMain.handle('get-match-history', (_, limit?: number) => {
  try {
    return getRecentMatches(limit || 50)
  } catch (error) {
    console.error('[IPC] Failed to get match history:', error)
    return []
  }
})

ipcMain.handle('get-match-stats', (_, deckId?: string) => {
  try {
    return getMatchStats(deckId)
  } catch (error) {
    console.error('[IPC] Failed to get match stats:', error)
    return { wins: 0, losses: 0, draws: 0, winRate: 0 }
  }
})

ipcMain.handle('get-play-draw-stats', (_, deckId?: string) => {
  try {
    return getPlayDrawStats(deckId)
  } catch (error) {
    console.error('[IPC] Failed to get play/draw stats:', error)
    return {
      onPlay: { wins: 0, losses: 0, winRate: 0 },
      onDraw: { wins: 0, losses: 0, winRate: 0 }
    }
  }
})

ipcMain.handle('get-stats-by-format', (_, deckId?: string) => {
  try {
    return getStatsByFormat(deckId)
  } catch (error) {
    console.error('[IPC] Failed to get stats by format:', error)
    return []
  }
})

ipcMain.handle('get-collection', () => {
  try {
    return getCollection()
  } catch (error) {
    console.error('[IPC] Failed to get collection:', error)
    return {}
  }
})

ipcMain.handle('get-card', (_, grpId: number) => {
  return getCard(grpId)
})

ipcMain.handle('get-card-name', (_, grpId: number) => {
  return getCardName(grpId)
})

ipcMain.handle('get-collection-stats', () => {
  try {
    return getCollectionStats()
  } catch (error) {
    console.error('[IPC] Failed to get collection stats:', error)
    return { totalCards: 0, uniqueCards: 0, byRarity: {} }
  }
})

ipcMain.handle('get-set-list', () => {
  try {
    return getSetList()
  } catch (error) {
    console.error('[IPC] Failed to get set list:', error)
    return []
  }
})

ipcMain.handle('get-cards-by-set', (_, setCode: string) => {
  try {
    return getCardsBySet(setCode)
  } catch (error) {
    console.error('[IPC] Failed to get cards by set:', error)
    return []
  }
})

ipcMain.handle('update-match-notes', (_, matchId: string, notes: string) => {
  try {
    updateMatchNotes(matchId, notes)
    return true
  } catch (error) {
    console.error('[IPC] Failed to update match notes:', error)
    return false
  }
})

ipcMain.handle('get-opponent-stats', (_, deckId?: string) => {
  try {
    return getOpponentStats(deckId)
  } catch (error) {
    console.error('[IPC] Failed to get opponent stats:', error)
    return []
  }
})

ipcMain.handle('format-event-id', (_, eventId: string) => {
  try {
    return formatEventId(eventId)
  } catch (error) {
    console.error('[IPC] Failed to format event ID:', error)
    return eventId
  }
})

// ============================================================================
// Application Lifecycle
// ============================================================================

app.whenReady().then(async () => {
  // Initialize database
  try {
    initDatabase()
    console.log('[App] Database initialized')
  } catch (error) {
    console.error('[App] Failed to initialize database:', error)
  }

  // Load card registry
  try {
    loadCardRegistry()
    console.log('[App] Card registry loaded')
  } catch (error) {
    console.error('[App] Failed to load card registry:', error)
  }

  // Start services
  setupLogParser()
  setupLogWatcher()
  await createWindows()

  // macOS: Re-create windows when dock icon is clicked
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindows()
    }
  })
})

app.on('window-all-closed', () => {
  cleanup()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  cleanup()
})

/**
 * Clean up resources before quitting
 */
function cleanup(): void {
  logWatcher?.stop()
  closeDatabase()
}

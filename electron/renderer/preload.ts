/**
 * Preload script for MTGA Tracker
 * Exposes IPC methods to renderer processes securely
 */

import { contextBridge, ipcRenderer } from 'electron'

// Expose protected methods that allow the renderer process to use
// ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('mtgaTracker', {
  // State queries
  getState: () => ipcRenderer.invoke('get-state'),
  getMatchHistory: (limit?: number) => ipcRenderer.invoke('get-match-history', limit),
  getMatchStats: (deckId?: string) => ipcRenderer.invoke('get-match-stats', deckId),
  getPlayDrawStats: (deckId?: string) => ipcRenderer.invoke('get-play-draw-stats', deckId),
  getStatsByFormat: (deckId?: string) => ipcRenderer.invoke('get-stats-by-format', deckId),
  getOpponentStats: (deckId?: string) => ipcRenderer.invoke('get-opponent-stats', deckId),
  getCollection: () => ipcRenderer.invoke('get-collection'),
  getCollectionStats: () => ipcRenderer.invoke('get-collection-stats'),
  getSetList: () => ipcRenderer.invoke('get-set-list'),
  getCardsBySet: (setCode: string) => ipcRenderer.invoke('get-cards-by-set', setCode),

  // Card data
  getCard: (grpId: number) => ipcRenderer.invoke('get-card', grpId),
  getCardName: (grpId: number) => ipcRenderer.invoke('get-card-name', grpId),

  // Match updates
  updateMatchNotes: (matchId: string, notes: string) => ipcRenderer.invoke('update-match-notes', matchId, notes),

  // Event listeners
  onInventoryUpdate: (callback: (data: unknown) => void) => {
    ipcRenderer.on('inventory-update', (_event, data) => callback(data))
  },
  onCollectionUpdate: (callback: (data: unknown) => void) => {
    ipcRenderer.on('collection-update', (_event, data) => callback(data))
  },
  onMatchStart: (callback: (data: unknown) => void) => {
    ipcRenderer.on('match-start', (_event, data) => callback(data))
  },
  onMatchEnd: (callback: (data: unknown) => void) => {
    ipcRenderer.on('match-end', (_event, data) => callback(data))
  },
  onGameState: (callback: (data: unknown) => void) => {
    ipcRenderer.on('game-state', (_event, data) => callback(data))
  },
  onDeckSubmission: (callback: (data: unknown) => void) => {
    ipcRenderer.on('deck-submission', (_event, data) => callback(data))
  },
  onDeckSelected: (callback: (data: unknown) => void) => {
    ipcRenderer.on('deck-selected', (_event, data) => callback(data))
  },

  // Cleanup
  removeAllListeners: () => {
    ipcRenderer.removeAllListeners('inventory-update')
    ipcRenderer.removeAllListeners('collection-update')
    ipcRenderer.removeAllListeners('match-start')
    ipcRenderer.removeAllListeners('match-end')
    ipcRenderer.removeAllListeners('game-state')
    ipcRenderer.removeAllListeners('deck-submission')
    ipcRenderer.removeAllListeners('deck-selected')
  }
})

// Type declaration for the exposed API
declare global {
  interface Window {
    mtgaTracker: {
      getState: () => Promise<unknown>
      getMatchHistory: (limit?: number) => Promise<unknown[]>
      getMatchStats: (deckId?: string) => Promise<{ wins: number; losses: number; draws: number; winRate: number }>
      getPlayDrawStats: (deckId?: string) => Promise<{ onPlay: { wins: number; losses: number; winRate: number }; onDraw: { wins: number; losses: number; winRate: number } }>
      getStatsByFormat: (deckId?: string) => Promise<Array<{ format: string; eventId: string; wins: number; losses: number; draws: number; winRate: number; total: number }>>
      getOpponentStats: (deckId?: string) => Promise<Array<any>>
      getCollection: () => Promise<Record<number, number>>
      getCollectionStats: () => Promise<{ totalCards: number; uniqueCards: number; byRarity: Record<string, number> }>
      getSetList: () => Promise<string[]>
      getCardsBySet: (setCode: string) => Promise<Array<any>>
      getCard: (grpId: number) => Promise<{ name: string; manaCost: string; type: string } | null>
      getCardName: (grpId: number) => Promise<string | null>
      updateMatchNotes: (matchId: string, notes: string) => Promise<boolean>
      onInventoryUpdate: (callback: (data: unknown) => void) => void
      onCollectionUpdate: (callback: (data: unknown) => void) => void
      onMatchStart: (callback: (data: unknown) => void) => void
      onMatchEnd: (callback: (data: unknown) => void) => void
      onGameState: (callback: (data: unknown) => void) => void
      onDeckSubmission: (callback: (data: unknown) => void) => void
      onDeckSelected: (callback: (data: unknown) => void) => void
      removeAllListeners: () => void
    }
  }
}

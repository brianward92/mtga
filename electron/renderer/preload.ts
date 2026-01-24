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
  getCollection: () => ipcRenderer.invoke('get-collection'),

  // Card data
  getCard: (grpId: number) => ipcRenderer.invoke('get-card', grpId),
  getCardName: (grpId: number) => ipcRenderer.invoke('get-card-name', grpId),

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
      getCollection: () => Promise<Record<number, number>>
      getCard: (grpId: number) => Promise<{ name: string; manaCost: string; type: string } | null>
      getCardName: (grpId: number) => Promise<string | null>
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

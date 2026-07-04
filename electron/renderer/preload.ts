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

  // Draft state
  getDraftState: () => ipcRenderer.invoke('get-draft-state'),
  dismissDraft: () => ipcRenderer.send('draft-dismiss'),

  // Overlay window controls (manual drag/resize — the window is focusable:false)
  overlayDragStart: () => ipcRenderer.invoke('overlay-drag-start'),
  overlayMove: (x: number, y: number) => ipcRenderer.send('overlay-move', { x, y }),
  overlayMoveEnd: () => ipcRenderer.send('overlay-move-end'),
  overlayResizeStart: () => ipcRenderer.invoke('overlay-resize-start'),
  overlayResize: (width: number, height: number) => ipcRenderer.send('overlay-resize', { width, height }),
  overlayResizeEnd: () => ipcRenderer.send('overlay-resize-end'),
  overlaySetSize: (width: number | null, height: number | null, animate?: boolean) =>
    ipcRenderer.send('overlay-set-size', { width, height, animate: animate ?? false }),
  setOverlayDensity: (density: string) => ipcRenderer.send('overlay-density', { density }),
  getOverlayPrefs: () => ipcRenderer.invoke('overlay-get-prefs'),
  setOverlayPrefs: (patch: { autoHideDashboard?: boolean }) => ipcRenderer.send('overlay-set-prefs', patch),
  hideOverlay: () => ipcRenderer.send('overlay-hide'),
  toggleOverlay: () => ipcRenderer.invoke('overlay-toggle'),
  getOverlayVisible: () => ipcRenderer.invoke('overlay-visible'),

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

  // Draft event listeners
  onDraftStart: (callback: (data: unknown) => void) => {
    ipcRenderer.on('draft-start', (_event, data) => callback(data))
  },
  onDraftPack: (callback: (data: unknown) => void) => {
    ipcRenderer.on('draft-pack', (_event, data) => callback(data))
  },
  onDraftPick: (callback: (data: unknown) => void) => {
    ipcRenderer.on('draft-pick', (_event, data) => callback(data))
  },
  onDraftEnd: (callback: (data: unknown) => void) => {
    ipcRenderer.on('draft-end', (_event, data) => callback(data))
  },
  onDraftScores: (callback: (data: unknown) => void) => {
    ipcRenderer.on('draft-scores', (_event, data) => callback(data))
  },
  onDraftRatings: (callback: (data: unknown) => void) => {
    ipcRenderer.on('draft-ratings', (_event, data) => callback(data))
  },
  onServerStatus: (callback: (data: unknown) => void) => {
    ipcRenderer.on('server-status', (_event, data) => callback(data))
  },
  onDetailedLogs: (callback: (data: unknown) => void) => {
    ipcRenderer.on('detailed-logs', (_event, data) => callback(data))
  },
  onDensityCycle: (callback: () => void) => {
    ipcRenderer.on('density-cycle', () => callback())
  },
  onOverlayVisibility: (callback: (data: unknown) => void) => {
    ipcRenderer.on('overlay-visibility', (_event, data) => callback(data))
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
    ipcRenderer.removeAllListeners('draft-start')
    ipcRenderer.removeAllListeners('draft-pack')
    ipcRenderer.removeAllListeners('draft-pick')
    ipcRenderer.removeAllListeners('draft-end')
    ipcRenderer.removeAllListeners('draft-scores')
    ipcRenderer.removeAllListeners('draft-ratings')
    ipcRenderer.removeAllListeners('server-status')
    ipcRenderer.removeAllListeners('detailed-logs')
    ipcRenderer.removeAllListeners('density-cycle')
    ipcRenderer.removeAllListeners('overlay-visibility')
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
      getDraftState: () => Promise<unknown>
      dismissDraft: () => void
      overlayDragStart: () => Promise<{ x: number; y: number; width: number; height: number } | null>
      overlayMove: (x: number, y: number) => void
      overlayMoveEnd: () => void
      overlayResizeStart: () => Promise<{ x: number; y: number; width: number; height: number } | null>
      overlayResize: (width: number, height: number) => void
      overlayResizeEnd: () => void
      overlaySetSize: (width: number | null, height: number | null, animate?: boolean) => void
      setOverlayDensity: (density: string) => void
      getOverlayPrefs: () => Promise<{ draftDensity: string; autoHideDashboard: boolean }>
      setOverlayPrefs: (patch: { autoHideDashboard?: boolean }) => void
      hideOverlay: () => void
      toggleOverlay: () => Promise<boolean>
      getOverlayVisible: () => Promise<boolean>
      onInventoryUpdate: (callback: (data: unknown) => void) => void
      onCollectionUpdate: (callback: (data: unknown) => void) => void
      onMatchStart: (callback: (data: unknown) => void) => void
      onMatchEnd: (callback: (data: unknown) => void) => void
      onGameState: (callback: (data: unknown) => void) => void
      onDeckSubmission: (callback: (data: unknown) => void) => void
      onDeckSelected: (callback: (data: unknown) => void) => void
      onDraftStart: (callback: (data: unknown) => void) => void
      onDraftPack: (callback: (data: unknown) => void) => void
      onDraftPick: (callback: (data: unknown) => void) => void
      onDraftEnd: (callback: (data: unknown) => void) => void
      onDraftScores: (callback: (data: unknown) => void) => void
      onDraftRatings: (callback: (data: unknown) => void) => void
      onServerStatus: (callback: (data: unknown) => void) => void
      onDetailedLogs: (callback: (data: unknown) => void) => void
      onDensityCycle: (callback: () => void) => void
      onOverlayVisibility: (callback: (data: unknown) => void) => void
      removeAllListeners: () => void
    }
  }
}

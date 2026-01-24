/**
 * Match event parser for MTGA log files.
 * Handles match start/end events and player detection.
 */

export interface MatchStartData {
  matchId: string
  eventId: string
  opponentName: string
  opponentRank: string
  seatId: number
  teamId: number
  gameMode: string
  playerName: string
}

export interface MatchEndData {
  matchId: string
  result: 'win' | 'loss' | 'draw'
  winningTeamId: number
  reason: string
  gameCount: number
}

export interface MatchEvent {
  type: 'start' | 'end'
  data: MatchStartData | MatchEndData
}

interface ReservedPlayer {
  userId?: string
  playerName?: string
  systemSeatId?: number
  teamId?: number
  platformId?: string
  sessionId?: string
  eventId?: string
}

interface GameRoomConfig {
  eventId?: string
  matchId?: string
  reservedPlayers?: ReservedPlayer[]
  gameMode?: string
}

interface MatchResult {
  scope?: string
  result?: string
  winningTeamId?: number
  reason?: string
}

interface FinalMatchResult {
  matchId?: string
  matchCompletedReason?: string
  resultList?: MatchResult[]
}

interface GameRoomInfo {
  stateType?: string
  gameRoomConfig?: GameRoomConfig
  finalMatchResult?: FinalMatchResult
}

// Track our player info across match events
let currentPlayerInfo: { seatId: number; teamId: number; name: string } | null = null

/**
 * Parse match events from log data.
 */
export function parseMatchEvent(data: Record<string, unknown>): MatchEvent | null {
  const eventData = data.matchGameRoomStateChangedEvent as Record<string, unknown> | undefined
  if (!eventData) return null

  const gameRoomInfo = eventData.gameRoomInfo as GameRoomInfo | undefined
  if (!gameRoomInfo) return null

  // Check for match end (final result) - this comes with MatchCompleted state
  if (gameRoomInfo.stateType === 'MatchGameRoomStateType_MatchCompleted' && gameRoomInfo.finalMatchResult) {
    return parseMatchEnd(gameRoomInfo)
  }

  // Check for match start
  if (gameRoomInfo.stateType === 'MatchGameRoomStateType_Playing') {
    return parseMatchStart(gameRoomInfo)
  }

  return null
}

/**
 * Detect which player is the local user.
 * We identify ourselves by platform (Mac) or by being the second player.
 */
function detectLocalPlayer(players: ReservedPlayer[]): ReservedPlayer | null {
  if (players.length === 0) return null
  if (players.length === 1) return players[0]

  // Try to find by Mac platform (local user)
  const macPlayer = players.find(p => p.platformId === 'Mac')
  if (macPlayer) return macPlayer

  // Fall back to second player (usually sorted by seatId)
  // In most cases, the local player has the higher seatId
  const sorted = [...players].sort((a, b) => (b.systemSeatId || 0) - (a.systemSeatId || 0))
  return sorted[0]
}

/**
 * Parse match start event.
 */
function parseMatchStart(gameRoomInfo: GameRoomInfo): MatchEvent | null {
  const config = gameRoomInfo.gameRoomConfig
  if (!config) return null

  const players = config.reservedPlayers || []
  const localPlayer = detectLocalPlayer(players)

  if (!localPlayer) return null

  // Find opponent
  const opponent = players.find(p => p.userId !== localPlayer.userId) || players[0]

  // Store our info for match end comparison
  currentPlayerInfo = {
    seatId: localPlayer.systemSeatId || 0,
    teamId: localPlayer.teamId || 0,
    name: localPlayer.playerName || 'Unknown'
  }

  return {
    type: 'start',
    data: {
      matchId: config.matchId || '',
      eventId: config.eventId || localPlayer.eventId || 'Unknown',
      opponentName: opponent?.playerName || 'Unknown',
      opponentRank: '',
      seatId: localPlayer.systemSeatId || 0,
      teamId: localPlayer.teamId || 0,
      gameMode: config.gameMode || 'Unknown',
      playerName: localPlayer.playerName || 'Unknown'
    }
  }
}

/**
 * Parse match end event and determine win/loss.
 */
function parseMatchEnd(gameRoomInfo: GameRoomInfo): MatchEvent | null {
  const result = gameRoomInfo.finalMatchResult
  const config = gameRoomInfo.gameRoomConfig
  if (!result) return null

  // Re-detect player if we missed match start
  if (!currentPlayerInfo && config?.reservedPlayers) {
    const localPlayer = detectLocalPlayer(config.reservedPlayers)
    if (localPlayer) {
      currentPlayerInfo = {
        seatId: localPlayer.systemSeatId || 0,
        teamId: localPlayer.teamId || 0,
        name: localPlayer.playerName || 'Unknown'
      }
    }
  }

  // Find the match-scope result
  const matchResult = result.resultList?.find(r => r.scope === 'MatchScope_Match')
  const winningTeamId = matchResult?.winningTeamId ?? result.resultList?.[0]?.winningTeamId ?? -1
  const reason = matchResult?.reason || result.matchCompletedReason || 'Unknown'

  // Determine our result
  let ourResult: 'win' | 'loss' | 'draw' = 'draw'

  if (winningTeamId > 0 && currentPlayerInfo) {
    ourResult = currentPlayerInfo.teamId === winningTeamId ? 'win' : 'loss'
  } else if (winningTeamId > 0) {
    // If we don't know our team, assume team 2 is us (common case)
    ourResult = winningTeamId === 2 ? 'win' : 'loss'
  }

  // Count games from result list
  const gameResults = result.resultList?.filter(r => r.scope === 'MatchScope_Game') || []
  const gameCount = gameResults.length || 1

  // Clear player info for next match
  const matchData: MatchEndData = {
    matchId: result.matchId || config?.matchId || '',
    result: ourResult,
    winningTeamId,
    reason,
    gameCount
  }

  currentPlayerInfo = null

  return {
    type: 'end',
    data: matchData
  }
}

/**
 * Get human-readable format name from eventId.
 */
export function parseFormatFromEventId(eventId: string): string {
  const patterns: Record<string, string> = {
    'Historic_Ladder': 'Historic Ranked',
    'Traditional_Historic_Ladder': 'Traditional Historic',
    'Ladder': 'Standard Ranked',
    'Traditional_Ladder': 'Traditional Standard',
    'Alchemy_Ladder': 'Alchemy Ranked',
    'Explorer_Ladder': 'Explorer Ranked',
    'Timeless_Ladder': 'Timeless Ranked',
    'Historic_Play': 'Historic Play',
    'Play': 'Standard Play',
    'Bot_Match': 'Bot Match',
    'DirectChallenge': 'Direct Challenge',
    'PremierDraft': 'Premier Draft',
    'QuickDraft': 'Quick Draft',
    'TradDraft': 'Traditional Draft',
    'Sealed': 'Sealed',
    'Cube': 'Cube'
  }

  // Exact match first
  if (patterns[eventId]) {
    return patterns[eventId]
  }

  // Partial match
  for (const [pattern, format] of Object.entries(patterns)) {
    if (eventId.toLowerCase().includes(pattern.toLowerCase())) {
      return format
    }
  }

  return eventId
}

/**
 * Reset player tracking (call when app starts or connection resets).
 */
export function resetPlayerTracking(): void {
  currentPlayerInfo = null
}

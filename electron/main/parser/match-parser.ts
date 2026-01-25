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

  // Find the match-scope result first, fall back to game results
  const matchResult = result.resultList?.find(r => r.scope === 'MatchScope_Match')
  const gameResults = result.resultList?.filter(r => r.scope === 'MatchScope_Game') || []
  const gameCount = gameResults.length || 1

  // Try multiple sources for winning team
  let winningTeamId = matchResult?.winningTeamId ?? -1

  // If match result doesn't have a winner, count game wins
  if (winningTeamId <= 0 && gameResults.length > 0) {
    const teamWins = new Map<number, number>()
    for (const game of gameResults) {
      if (game.winningTeamId && game.winningTeamId > 0) {
        teamWins.set(game.winningTeamId, (teamWins.get(game.winningTeamId) || 0) + 1)
      }
    }
    // Team with most game wins is the match winner
    let maxWins = 0
    for (const [teamId, wins] of teamWins) {
      if (wins > maxWins) {
        maxWins = wins
        winningTeamId = teamId
      }
    }
  }

  // Fall back to first result's winning team
  if (winningTeamId <= 0 && result.resultList?.[0]?.winningTeamId) {
    winningTeamId = result.resultList[0].winningTeamId
  }

  const reason = matchResult?.reason || result.matchCompletedReason || 'Unknown'

  // Determine our result using multiple strategies
  let ourResult: 'win' | 'loss' | 'draw' = 'draw'

  if (winningTeamId > 0 && currentPlayerInfo) {
    // Primary: compare winning team to our team
    ourResult = currentPlayerInfo.teamId === winningTeamId ? 'win' : 'loss'
  } else if (winningTeamId > 0) {
    // Fallback: assume team 2 is us (common case on Mac)
    ourResult = winningTeamId === 2 ? 'win' : 'loss'
  } else if (currentPlayerInfo) {
    // No winning team ID - check match result reason and individual results
    const reasonLower = reason.toLowerCase()

    // Concession: if opponent conceded, we win
    if (reasonLower.includes('concede') || reasonLower.includes('concession')) {
      // Check if any result indicates a win for us
      const ourTeamResult = result.resultList?.find(r =>
        r.winningTeamId === currentPlayerInfo?.teamId ||
        (r.result?.toLowerCase().includes('win') && r.scope === 'MatchScope_Match')
      )
      ourResult = ourTeamResult ? 'win' : 'loss'
      // If we can't determine who conceded, assume opponent (we're still here parsing)
      if (!ourTeamResult && !result.resultList?.some(r => r.winningTeamId && r.winningTeamId !== currentPlayerInfo?.teamId)) {
        ourResult = 'win'
      }
    }

    // Timeout: if opponent timed out, we win
    if (reasonLower.includes('timeout') || reasonLower.includes('idle')) {
      ourResult = 'win'
    }

    // Disconnect: if opponent disconnected, we likely win
    if (reasonLower.includes('disconnect') || reasonLower.includes('connection')) {
      ourResult = 'win'
    }
  }

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

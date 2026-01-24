export interface CardInstance {
  instanceId: number
  grpId: number
  zoneId: number
  ownerSeatId: number
}

export interface ZoneData {
  zoneId: number
  type: ZoneType
  ownerSeatId: number
  objectInstanceIds: number[]
}

export type ZoneType =
  | 'ZoneType_Library'
  | 'ZoneType_Hand'
  | 'ZoneType_Battlefield'
  | 'ZoneType_Graveyard'
  | 'ZoneType_Exile'
  | 'ZoneType_Stack'
  | 'ZoneType_Limbo'
  | 'ZoneType_Sideboard'
  | 'ZoneType_Command'
  | string

export interface GameStateData {
  turnNumber: number
  activePlayer: number
  priorityPlayer: number
  gameStage: string
  zones: Map<ZoneType, ZoneData>
  objects: Map<number, CardInstance>
  // Derived data for deck tracker
  librarySize: number
  handSize: number
  graveyardCards: number[]
  cardsDrawn: number[]
  cardsOnBattlefield: number[]
  cardsInExile: number[]
}

export interface DeckSubmissionData {
  deckId: string
  deckName: string
  mainDeck: Array<{ grpId: number; quantity: number }>
  sideboard: Array<{ grpId: number; quantity: number }>
}

export interface GameStateResult {
  type: 'game-state' | 'deck-submission'
  data: GameStateData | DeckSubmissionData
}

export function parseGameState(data: Record<string, unknown>): GameStateResult | null {
  // Handle deck submission/payload
  if ('deckPayload' in data) {
    const deckData = parseDeckPayload(data.deckPayload as Record<string, unknown>)
    if (deckData) {
      return { type: 'deck-submission', data: deckData }
    }
  }

  // Handle GRE to client events (game state)
  const greEvent = data.greToClientEvent || data.GreToClientEvent
  if (!greEvent || typeof greEvent !== 'object') {
    return null
  }

  const event = greEvent as Record<string, unknown>
  const messages = event.greToClientMessages as Array<Record<string, unknown>> | undefined

  if (!messages || !Array.isArray(messages)) {
    return null
  }

  // Look for GameStateMessage
  for (const msg of messages) {
    if (msg.type === 'GREMessageType_GameStateMessage') {
      const gameState = parseGameStateMessage(msg)
      if (gameState) {
        return { type: 'game-state', data: gameState }
      }
    }

    // Look for deck submission in connect response
    if (msg.type === 'GREMessageType_ConnectResp') {
      const connectResp = msg.connectResp as Record<string, unknown> | undefined
      if (connectResp?.deckMessage) {
        const deckData = parseDeckMessage(connectResp.deckMessage as Record<string, unknown>)
        if (deckData) {
          return { type: 'deck-submission', data: deckData }
        }
      }
    }
  }

  return null
}

function parseGameStateMessage(msg: Record<string, unknown>): GameStateData | null {
  const gameStateMessage = msg.gameStateMessage as Record<string, unknown> | undefined
  if (!gameStateMessage) return null

  const zones = new Map<ZoneType, ZoneData>()
  const objects = new Map<number, CardInstance>()

  // Parse zones - store with composite key to handle multiple players
  const zonesArray = gameStateMessage.zones as Array<Record<string, unknown>> | undefined
  const playerZones: ZoneData[] = []

  if (zonesArray && Array.isArray(zonesArray)) {
    for (const zone of zonesArray) {
      const zoneData: ZoneData = {
        zoneId: (zone.zoneId as number) || 0,
        type: (zone.type as ZoneType) || 'Unknown',
        ownerSeatId: (zone.ownerSeatId as number) || 0,
        objectInstanceIds: (zone.objectInstanceIds as number[]) || []
      }

      // Keep track of all zones for finding our player
      playerZones.push(zoneData)

      // For the zones map, prioritize our player's zones (seat 1 is local player)
      // or zones with higher seatId if that's where our deck is
      const existingZone = zones.get(zoneData.type)
      if (!existingZone || zoneData.ownerSeatId === 1) {
        zones.set(zoneData.type, zoneData)
      }
    }
  }

  // Parse game objects - only track cards owned by the local player (seat 1)
  const gameObjects = gameStateMessage.gameObjects as Array<Record<string, unknown>> | undefined
  if (gameObjects && Array.isArray(gameObjects)) {
    for (const obj of gameObjects) {
      const instanceId = (obj.instanceId as number) || 0
      const grpId = (obj.grpId as number) || 0
      const zoneId = (obj.zoneId as number) || 0
      const ownerSeatId = (obj.ownerSeatId as number) || 0

      // Only track our player's cards (seat 1)
      if (instanceId && grpId && ownerSeatId === 1) {
        objects.set(instanceId, { instanceId, grpId, zoneId, ownerSeatId })
      }
    }
  }

  // Parse turn info
  const turnInfo = gameStateMessage.turnInfo as Record<string, unknown> | undefined

  // Find our player's zones specifically (seat 1)
  const ourLibraryZone = playerZones.find(z => z.type === 'ZoneType_Library' && z.ownerSeatId === 1)
  const ourHandZone = playerZones.find(z => z.type === 'ZoneType_Hand' && z.ownerSeatId === 1)
  const ourGraveyardZone = playerZones.find(z => z.type === 'ZoneType_Graveyard' && z.ownerSeatId === 1)
  const ourBattlefieldZone = playerZones.find(z => z.type === 'ZoneType_Battlefield' && z.ownerSeatId === 1)
  const ourExileZone = playerZones.find(z => z.type === 'ZoneType_Exile' && z.ownerSeatId === 1)

  const librarySize = ourLibraryZone?.objectInstanceIds.length || 0
  const handSize = ourHandZone?.objectInstanceIds.length || 0

  // Get grpIds for graveyard cards
  const graveyardCards: number[] = []
  if (ourGraveyardZone) {
    for (const instanceId of ourGraveyardZone.objectInstanceIds) {
      const obj = objects.get(instanceId)
      if (obj) {
        graveyardCards.push(obj.grpId)
      }
    }
  }

  // Track cards drawn (in hand)
  const cardsDrawn: number[] = []
  if (ourHandZone) {
    for (const instanceId of ourHandZone.objectInstanceIds) {
      const obj = objects.get(instanceId)
      if (obj) {
        cardsDrawn.push(obj.grpId)
      }
    }
  }

  // Also track cards on battlefield and in exile as "not in library"
  const cardsOnBattlefield: number[] = []
  if (ourBattlefieldZone) {
    for (const instanceId of ourBattlefieldZone.objectInstanceIds) {
      const obj = objects.get(instanceId)
      if (obj) {
        cardsOnBattlefield.push(obj.grpId)
      }
    }
  }

  const cardsInExile: number[] = []
  if (ourExileZone) {
    for (const instanceId of ourExileZone.objectInstanceIds) {
      const obj = objects.get(instanceId)
      if (obj) {
        cardsInExile.push(obj.grpId)
      }
    }
  }

  return {
    turnNumber: (turnInfo?.turnNumber as number) || 0,
    activePlayer: (turnInfo?.activePlayer as number) || 0,
    priorityPlayer: (turnInfo?.priorityPlayer as number) || 0,
    gameStage: (turnInfo?.phase as string) || 'Unknown',
    zones,
    objects,
    librarySize,
    handSize,
    graveyardCards,
    cardsDrawn,
    cardsOnBattlefield,
    cardsInExile
  }
}

function parseDeckPayload(payload: Record<string, unknown>): DeckSubmissionData | null {
  const mainDeck: Array<{ grpId: number; quantity: number }> = []
  const sideboard: Array<{ grpId: number; quantity: number }> = []

  // Handle mainDeck format
  const mainDeckData = payload.mainDeck || payload.deckCards
  if (Array.isArray(mainDeckData)) {
    for (const entry of mainDeckData) {
      if (typeof entry === 'object' && entry !== null) {
        const obj = entry as Record<string, unknown>
        const grpId = (obj.cardId as number) || (obj.grpId as number) || 0
        const quantity = (obj.quantity as number) || 1
        if (grpId) {
          mainDeck.push({ grpId, quantity })
        }
      } else if (typeof entry === 'number') {
        // Simple array of grpIds (each occurrence = 1 copy)
        const existing = mainDeck.find(c => c.grpId === entry)
        if (existing) {
          existing.quantity++
        } else {
          mainDeck.push({ grpId: entry, quantity: 1 })
        }
      }
    }
  }

  // Handle sideboard
  const sideboardData = payload.sideboard || payload.sideboardCards
  if (Array.isArray(sideboardData)) {
    for (const entry of sideboardData) {
      if (typeof entry === 'object' && entry !== null) {
        const obj = entry as Record<string, unknown>
        const grpId = (obj.cardId as number) || (obj.grpId as number) || 0
        const quantity = (obj.quantity as number) || 1
        if (grpId) {
          sideboard.push({ grpId, quantity })
        }
      } else if (typeof entry === 'number') {
        const existing = sideboard.find(c => c.grpId === entry)
        if (existing) {
          existing.quantity++
        } else {
          sideboard.push({ grpId: entry, quantity: 1 })
        }
      }
    }
  }

  if (mainDeck.length === 0) {
    return null
  }

  return {
    deckId: (payload.id as string) || (payload.deckId as string) || '',
    deckName: (payload.name as string) || (payload.deckName as string) || 'Unknown Deck',
    mainDeck,
    sideboard
  }
}

function parseDeckMessage(deckMessage: Record<string, unknown>): DeckSubmissionData | null {
  return parseDeckPayload(deckMessage)
}

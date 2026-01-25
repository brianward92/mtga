import { EventEmitter } from 'events'
import { parseInventory, InventoryData, CollectionData } from './inventory'
import { parseMatchEvent, MatchStartData, MatchEndData } from './match-parser'
import { parseGameState, GameStateData, DeckSubmissionData } from './game-state'

export interface ParserState {
  inMatch: boolean
  currentMatchId: string | null
  currentDeck: DeckSubmissionData | null
  currentDeckName: string | null
  inventory: InventoryData | null
  collection: CollectionData | null
  deckSummaries: Map<string, string>  // DeckId -> Name mapping
}

export interface ParserEvents {
  inventory: (data: InventoryData) => void
  collection: (data: CollectionData) => void
  'match-start': (data: MatchStartData) => void
  'match-end': (data: MatchEndData) => void
  'game-state': (data: GameStateData) => void
  'deck-submission': (data: DeckSubmissionData) => void
  'deck-selected': (data: { deckId: string; deckName: string }) => void
}

export class LogParser extends EventEmitter {
  private state: ParserState = {
    inMatch: false,
    currentMatchId: null,
    currentDeck: null,
    currentDeckName: null,
    inventory: null,
    collection: null,
    deckSummaries: new Map()
  }

  // Buffer for multi-line JSON objects
  private jsonBuffer: string = ''
  private inJsonBlock: boolean = false

  parseLine(line: string): void {
    // Try to extract JSON from the line
    const jsonData = this.extractJson(line)

    if (!jsonData) {
      return
    }

    // Route to appropriate parser based on content
    this.routeEvent(jsonData, line)
  }

  private extractJson(line: string): unknown | null {
    // Handle [UnityCrossThreadLogger] prefix
    // Format: [timestamp] [UnityCrossThreadLogger]MessageType { json... }
    // Or: [timestamp] [UnityCrossThreadLogger]<== ResponseType(id) { json... }

    // Check for response format: <== TypeName(id)\n{json}
    if (line.includes('<==') && line.includes('{')) {
      const jsonStart = line.indexOf('{')
      if (jsonStart !== -1) {
        try {
          return JSON.parse(line.slice(jsonStart))
        } catch {
          // Might be start of multi-line JSON
          this.jsonBuffer = line.slice(jsonStart)
          this.inJsonBlock = true
          return null
        }
      }
    }

    // Check for request format: ==> TypeName { json }
    if (line.includes('==>') && line.includes('{')) {
      const jsonStart = line.indexOf('{')
      if (jsonStart !== -1) {
        try {
          return JSON.parse(line.slice(jsonStart))
        } catch {
          this.jsonBuffer = line.slice(jsonStart)
          this.inJsonBlock = true
          return null
        }
      }
    }

    // Handle multi-line JSON continuation
    if (this.inJsonBlock) {
      this.jsonBuffer += '\n' + line
      try {
        const result = JSON.parse(this.jsonBuffer)
        this.jsonBuffer = ''
        this.inJsonBlock = false
        return result
      } catch {
        // Check for obvious end of JSON
        if (line.trim() === '}' || line.trim() === '},') {
          this.jsonBuffer = ''
          this.inJsonBlock = false
        }
        return null
      }
    }

    // Direct JSON line (some log entries are pure JSON)
    if (line.trim().startsWith('{') && line.trim().endsWith('}')) {
      try {
        return JSON.parse(line.trim())
      } catch {
        return null
      }
    }

    // Look for embedded JSON in the line
    const jsonMatch = line.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0])
      } catch {
        return null
      }
    }

    return null
  }

  private routeEvent(data: unknown, rawLine: string): void {
    if (typeof data !== 'object' || data === null) {
      return
    }

    const obj = data as Record<string, unknown>

    // Check raw line for deck name patterns before JSON parsing
    // MTGA logs often have deck info in specific line patterns
    this.extractDeckNameFromRawLine(rawLine)

    // Inventory and collection data (from StartHook/Authenticate response)
    if ('InventoryInfo' in obj || 'PlayerInventory' in obj || 'inventoryInfo' in obj) {
      const inventoryResult = parseInventory(obj)
      if (inventoryResult.inventory) {
        this.state.inventory = inventoryResult.inventory
        this.emit('inventory', inventoryResult.inventory)
      }
      if (inventoryResult.collection) {
        this.state.collection = inventoryResult.collection
        this.emit('collection', inventoryResult.collection)
      }
      return
    }

    // Match events
    if ('matchGameRoomStateChangedEvent' in obj) {
      const matchEvent = parseMatchEvent(obj)
      if (matchEvent) {
        if (matchEvent.type === 'start') {
          this.state.inMatch = true
          this.state.currentMatchId = matchEvent.data.matchId
          this.emit('match-start', matchEvent.data as MatchStartData)
        } else if (matchEvent.type === 'end') {
          this.state.inMatch = false
          this.state.currentMatchId = null
          this.state.currentDeck = null
          this.emit('match-end', matchEvent.data as MatchEndData)
        }
      }
      return
    }

    // Game state messages (GreToClientEvent)
    if ('greToClientEvent' in obj || 'GreToClientEvent' in obj) {
      const gameStateResult = parseGameState(obj)
      if (gameStateResult) {
        if (gameStateResult.type === 'game-state') {
          this.emit('game-state', gameStateResult.data as GameStateData)
        } else if (gameStateResult.type === 'deck-submission') {
          const deckData = gameStateResult.data as DeckSubmissionData

          // If deck name is unknown but we have a deckId, try to look it up from summaries
          if ((!deckData.deckName || deckData.deckName === 'Unknown Deck') && deckData.deckId) {
            const knownName = this.state.deckSummaries.get(deckData.deckId)
            if (knownName) {
              deckData.deckName = knownName
              console.log(`[Parser] Resolved deck name from summaries: ${knownName}`)
            }
          }

          // Update currentDeckName if we have a valid name
          if (deckData.deckName && deckData.deckName !== 'Unknown Deck') {
            this.state.currentDeckName = deckData.deckName
          }

          this.state.currentDeck = deckData
          this.emit('deck-submission', deckData)
        }
      }
      return
    }

    // Deck list requests
    if ('Payload' in obj && typeof obj.Payload === 'string') {
      try {
        const payload = JSON.parse(obj.Payload as string)
        if (payload.deckCards || payload.mainDeck || payload.MainDeck) {
          const deckResult = parseGameState({ deckPayload: payload })
          if (deckResult && deckResult.type === 'deck-submission') {
            const deckData = deckResult.data as DeckSubmissionData

            // If deck name is unknown but we have a deckId, try to look it up from summaries
            if ((!deckData.deckName || deckData.deckName === 'Unknown Deck') && deckData.deckId) {
              const knownName = this.state.deckSummaries.get(deckData.deckId)
              if (knownName) {
                deckData.deckName = knownName
                console.log(`[Parser] Resolved deck name from summaries (payload): ${knownName}`)
              }
            }

            // Update currentDeckName if we have a valid name
            if (deckData.deckName && deckData.deckName !== 'Unknown Deck') {
              this.state.currentDeckName = deckData.deckName
            }

            this.state.currentDeck = deckData
            this.emit('deck-submission', deckData)
          }
        }
      } catch {
        // Not a deck payload
      }
    }

    // DeckGetDeckSummariesV2 response - contains all player deck names
    if ('Summaries' in obj && Array.isArray(obj.Summaries)) {
      this.parseDeckSummaries(obj.Summaries as Array<Record<string, unknown>>)
      return
    }

    // Courses data (contains deck names) - from Event_GetCourses response
    if ('Courses' in obj && Array.isArray(obj.Courses)) {
      this.parseCourses(obj.Courses as Array<Record<string, unknown>>)
      return
    }

    // Also check for deck selection in DeckSubmit or similar events
    if ('CourseDeck' in obj || 'DeckSubmit' in obj) {
      const deckInfo = (obj.CourseDeck || obj.DeckSubmit) as Record<string, unknown> | undefined
      if (deckInfo) {
        const deckId = (deckInfo.DeckId as string) || (deckInfo.deckId as string) || ''
        const deckName = (deckInfo.Name as string) || (deckInfo.name as string) || ''
        if (deckName && deckName !== 'Unknown Deck') {
          this.state.currentDeckName = deckName
          this.emit('deck-selected', { deckId, deckName })
        }
      }
    }

    // Handle Event_SetDeck requests which contain deck selection info
    if ('request' in obj || 'Request' in obj) {
      const request = (obj.request || obj.Request) as string | Record<string, unknown> | undefined
      if (typeof request === 'string') {
        try {
          const requestData = JSON.parse(request)
          this.extractDeckNameFromRequest(requestData)
        } catch {
          // Not JSON
        }
      } else if (request && typeof request === 'object') {
        this.extractDeckNameFromRequest(request as Record<string, unknown>)
      }
    }

    // Check for deck info in nested params
    if ('params' in obj && typeof obj.params === 'object') {
      const params = obj.params as Record<string, unknown>
      this.extractDeckNameFromRequest(params)
    }
  }

  /**
   * Extract deck name from request payloads (Event_SetDeck, etc.)
   */
  private extractDeckNameFromRequest(data: Record<string, unknown>): void {
    // Check for deck field variations
    const deck = (data.deck || data.Deck || data.deckPayload || data.DeckPayload) as Record<string, unknown> | undefined
    if (deck) {
      const deckId = (deck.id as string) || (deck.Id as string) || (deck.deckId as string) || (deck.DeckId as string) || ''
      const deckName = (deck.name as string) || (deck.Name as string) || (deck.deckName as string) || (deck.DeckName as string) || ''

      if (deckName && deckName !== 'Unknown Deck') {
        this.state.currentDeckName = deckName
        if (deckId) {
          this.state.deckSummaries.set(deckId, deckName)
        }
        this.emit('deck-selected', { deckId, deckName })
        console.log(`[Parser] Deck name from request: ${deckName}`)
      }
    }

    // Also check for direct deck name fields in the data
    const directDeckName = (data.deckName as string) || (data.DeckName as string) || (data.Name as string)
    const directDeckId = (data.deckId as string) || (data.DeckId as string) || (data.Id as string) || ''

    if (directDeckName && directDeckName !== 'Unknown Deck' && !this.state.currentDeckName) {
      this.state.currentDeckName = directDeckName
      if (directDeckId) {
        this.state.deckSummaries.set(directDeckId, directDeckName)
      }
      this.emit('deck-selected', { deckId: directDeckId, deckName: directDeckName })
      console.log(`[Parser] Deck name from direct field: ${directDeckName}`)
    }
  }

  /**
   * Parse DeckGetDeckSummariesV2 response to get deck ID -> name mapping.
   * This data is sent when the player views their deck list.
   */
  private parseDeckSummaries(summaries: Array<Record<string, unknown>>): void {
    for (const summary of summaries) {
      const deckId = (summary.DeckId as string) || ''
      const deckName = (summary.Name as string) || ''

      if (deckId && deckName) {
        this.state.deckSummaries.set(deckId, deckName)
        console.log(`[Parser] Deck summary: ${deckId} -> ${deckName}`)
      }
    }
    console.log(`[Parser] Loaded ${this.state.deckSummaries.size} deck summaries`)
  }

  /**
   * Parse Courses data to extract deck information.
   * The MTGA log sends this when querying active events/courses.
   */
  private parseCourses(courses: Array<Record<string, unknown>>): void {
    for (const course of courses) {
      // Check for CourseDeckSummary which contains the deck name
      const deckSummary = course.CourseDeckSummary as Record<string, unknown> | undefined
      if (deckSummary) {
        const deckId = (deckSummary.DeckId as string) || ''
        const deckName = (deckSummary.Name as string) || ''

        if (deckName && deckName !== 'Unknown Deck') {
          this.state.currentDeckName = deckName
          this.emit('deck-selected', { deckId, deckName })
        }
      }

      // Also check for CourseDeck (full deck data)
      const courseDeck = course.CourseDeck as Record<string, unknown> | undefined
      if (courseDeck) {
        const deckId = (courseDeck.DeckId as string) || ''
        const deckName = (courseDeck.Name as string) || ''
        const mainDeck = courseDeck.MainDeck as Array<Record<string, unknown>> | undefined

        if (deckName && deckName !== 'Unknown Deck') {
          this.state.currentDeckName = deckName
        }

        // If we have deck cards, also emit a deck-submission event
        if (mainDeck && mainDeck.length > 0) {
          const cards: Array<{ grpId: number; quantity: number }> = []
          for (const card of mainDeck) {
            const grpId = (card.CardId as number) || (card.cardId as number) || 0
            const quantity = (card.Quantity as number) || (card.quantity as number) || 1
            if (grpId) {
              cards.push({ grpId, quantity })
            }
          }

          if (cards.length > 0) {
            const deckData: DeckSubmissionData = {
              deckId,
              deckName: deckName || 'Unknown Deck',
              mainDeck: cards,
              sideboard: []
            }
            this.state.currentDeck = deckData
            this.emit('deck-submission', deckData)
          }
        }
      }
    }
  }

  getState(): ParserState {
    return { ...this.state }
  }

  resetState(): void {
    this.state = {
      inMatch: false,
      currentMatchId: null,
      currentDeck: null,
      currentDeckName: null,
      inventory: null,
      collection: null,
      deckSummaries: new Map()
    }
  }

  /**
   * Get the current deck name (from Courses or deck submission).
   */
  getCurrentDeckName(): string | null {
    return this.state.currentDeckName || this.state.currentDeck?.deckName || null
  }

  /**
   * Extract deck name from raw log line patterns.
   * MTGA often logs deck info in Event_SetDeck or similar formats.
   */
  private extractDeckNameFromRawLine(line: string): void {
    // Pattern: Event_SetDeck with deck name
    // Format: ==> Event_SetDeck(...) {"deckId":"...", "deckName":"...", ...}
    if (line.includes('Event_SetDeck') || line.includes('SetDeck')) {
      // Try to find the deck name in the line
      const deckNameMatch = line.match(/"(?:deckName|DeckName|name|Name)"\s*:\s*"([^"]+)"/i)
      if (deckNameMatch && deckNameMatch[1] && deckNameMatch[1] !== 'Unknown Deck') {
        const deckName = deckNameMatch[1]
        if (this.state.currentDeckName !== deckName) {
          this.state.currentDeckName = deckName
          console.log(`[Parser] Deck name from raw line (SetDeck): ${deckName}`)

          // Also extract deckId if present
          const deckIdMatch = line.match(/"(?:deckId|DeckId|id|Id)"\s*:\s*"([^"]+)"/i)
          const deckId = deckIdMatch ? deckIdMatch[1] : ''

          if (deckId) {
            this.state.deckSummaries.set(deckId, deckName)
          }
          this.emit('deck-selected', { deckId, deckName })
        }
      }
    }

    // Pattern: DeckSubmit or DeckSubmitV3 events
    if (line.includes('DeckSubmit') || line.includes('SubmitDeck')) {
      const deckNameMatch = line.match(/"(?:deckName|DeckName|name|Name)"\s*:\s*"([^"]+)"/i)
      if (deckNameMatch && deckNameMatch[1] && deckNameMatch[1] !== 'Unknown Deck') {
        const deckName = deckNameMatch[1]
        if (this.state.currentDeckName !== deckName) {
          this.state.currentDeckName = deckName
          console.log(`[Parser] Deck name from raw line (Submit): ${deckName}`)

          const deckIdMatch = line.match(/"(?:deckId|DeckId|id|Id)"\s*:\s*"([^"]+)"/i)
          const deckId = deckIdMatch ? deckIdMatch[1] : ''

          if (deckId) {
            this.state.deckSummaries.set(deckId, deckName)
          }
          this.emit('deck-selected', { deckId, deckName })
        }
      }
    }

    // Pattern: CourseDeck in Event_Join or Event_GetCourses
    if (line.includes('CourseDeck') || line.includes('courseDeck')) {
      const deckNameMatch = line.match(/"(?:deckName|DeckName|name|Name)"\s*:\s*"([^"]+)"/i)
      if (deckNameMatch && deckNameMatch[1] && deckNameMatch[1] !== 'Unknown Deck') {
        const deckName = deckNameMatch[1]
        if (this.state.currentDeckName !== deckName) {
          this.state.currentDeckName = deckName
          console.log(`[Parser] Deck name from raw line (CourseDeck): ${deckName}`)

          const deckIdMatch = line.match(/"(?:deckId|DeckId|id|Id)"\s*:\s*"([^"]+)"/i)
          const deckId = deckIdMatch ? deckIdMatch[1] : ''

          if (deckId) {
            this.state.deckSummaries.set(deckId, deckName)
          }
          this.emit('deck-selected', { deckId, deckName })
        }
      }
    }
  }
}

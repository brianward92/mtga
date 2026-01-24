export interface InventoryData {
  gems: number
  gold: number
  wcCommon: number
  wcUncommon: number
  wcRare: number
  wcMythic: number
  vaultProgress: number
  boosters: BoosterData[]
  draftTokens: number
  sealedTokens: number
}

export interface BoosterData {
  collationId: number
  count: number
}

// Map of grpId -> quantity
export type CollectionData = Record<number, number>

export interface InventoryParseResult {
  inventory: InventoryData | null
  collection: CollectionData | null
}

export function parseInventory(data: Record<string, unknown>): InventoryParseResult {
  const result: InventoryParseResult = {
    inventory: null,
    collection: null
  }

  // Try to find inventory info in various formats
  const invInfo = findInventoryInfo(data)
  if (invInfo) {
    result.inventory = extractInventory(invInfo)
  }

  // Try to find collection data
  const collectionData = findCollectionData(data)
  if (collectionData) {
    result.collection = collectionData
  }

  return result
}

function findInventoryInfo(data: Record<string, unknown>): Record<string, unknown> | null {
  // Direct InventoryInfo field
  if (data.InventoryInfo && typeof data.InventoryInfo === 'object') {
    return data.InventoryInfo as Record<string, unknown>
  }

  // inventoryInfo (lowercase)
  if (data.inventoryInfo && typeof data.inventoryInfo === 'object') {
    return data.inventoryInfo as Record<string, unknown>
  }

  // PlayerInventory wrapper
  if (data.PlayerInventory && typeof data.PlayerInventory === 'object') {
    const pi = data.PlayerInventory as Record<string, unknown>
    if (pi.InventoryInfo) {
      return pi.InventoryInfo as Record<string, unknown>
    }
    return pi
  }

  // Nested in payload
  if (data.payload && typeof data.payload === 'object') {
    const payload = data.payload as Record<string, unknown>
    if (payload.InventoryInfo) {
      return payload.InventoryInfo as Record<string, unknown>
    }
  }

  // Check if data itself is inventory info
  if ('Gems' in data || 'gems' in data || 'Gold' in data || 'gold' in data) {
    return data
  }

  return null
}

function extractInventory(inv: Record<string, unknown>): InventoryData {
  return {
    gems: getNumber(inv, 'Gems', 'gems'),
    gold: getNumber(inv, 'Gold', 'gold'),
    wcCommon: getNumber(inv, 'WildCardCommons', 'wcCommon', 'wcCommons'),
    wcUncommon: getNumber(inv, 'WildCardUnCommons', 'wcUncommon', 'wcUncommons'),
    wcRare: getNumber(inv, 'WildCardRares', 'wcRare', 'wcRares'),
    wcMythic: getNumber(inv, 'WildCardMythics', 'wcMythic', 'wcMythics'),
    vaultProgress: getNumber(inv, 'TotalVaultProgress', 'vaultProgress') / 1000, // Convert to percentage
    boosters: extractBoosters(inv),
    draftTokens: getNumber(inv, 'DraftTokens', 'draftTokens'),
    sealedTokens: getNumber(inv, 'SealedTokens', 'sealedTokens')
  }
}

function getNumber(obj: Record<string, unknown>, ...keys: string[]): number {
  for (const key of keys) {
    if (key in obj) {
      const val = obj[key]
      if (typeof val === 'number') return val
      if (typeof val === 'string') {
        const num = parseInt(val, 10)
        if (!isNaN(num)) return num
      }
    }
  }
  return 0
}

function extractBoosters(inv: Record<string, unknown>): BoosterData[] {
  const boosters: BoosterData[] = []
  const boosterData = inv.Boosters || inv.boosters

  if (Array.isArray(boosterData)) {
    for (const b of boosterData) {
      if (typeof b === 'object' && b !== null) {
        const booster = b as Record<string, unknown>
        boosters.push({
          collationId: getNumber(booster, 'CollationId', 'collationId'),
          count: getNumber(booster, 'Count', 'count')
        })
      }
    }
  }

  return boosters
}

function findCollectionData(data: Record<string, unknown>): CollectionData | null {
  // Look for collection/cards array or object
  const possibleFields = [
    'cardsInInventory',
    'CardsInInventory',
    'collection',
    'Collection',
    'cards',
    'Cards'
  ]

  for (const field of possibleFields) {
    if (field in data) {
      const collData = data[field]
      return parseCollectionFormat(collData)
    }
  }

  // Check in nested payload
  if (data.payload && typeof data.payload === 'object') {
    const payload = data.payload as Record<string, unknown>
    for (const field of possibleFields) {
      if (field in payload) {
        return parseCollectionFormat(payload[field])
      }
    }
  }

  return null
}

function parseCollectionFormat(data: unknown): CollectionData | null {
  if (!data) return null

  const collection: CollectionData = {}

  // Format 1: Object with grpId as key and quantity as value
  // { "12345": 4, "12346": 2 }
  if (typeof data === 'object' && !Array.isArray(data)) {
    const obj = data as Record<string, unknown>
    for (const [key, value] of Object.entries(obj)) {
      const grpId = parseInt(key, 10)
      if (!isNaN(grpId) && typeof value === 'number') {
        collection[grpId] = value
      }
    }
    if (Object.keys(collection).length > 0) {
      return collection
    }
  }

  // Format 2: Array of [grpId, quantity] pairs
  // [[12345, 4], [12346, 2]]
  if (Array.isArray(data)) {
    for (const item of data) {
      if (Array.isArray(item) && item.length >= 2) {
        const grpId = parseInt(String(item[0]), 10)
        const quantity = parseInt(String(item[1]), 10)
        if (!isNaN(grpId) && !isNaN(quantity)) {
          collection[grpId] = quantity
        }
      }
      // Format 3: Array of objects { grpId: 12345, quantity: 4 }
      if (typeof item === 'object' && item !== null) {
        const obj = item as Record<string, unknown>
        const grpId = getNumber(obj, 'grpId', 'GrpId', 'id')
        const quantity = getNumber(obj, 'quantity', 'Quantity', 'count', 'Count')
        if (grpId > 0) {
          collection[grpId] = quantity || 1
        }
      }
    }
    if (Object.keys(collection).length > 0) {
      return collection
    }
  }

  return null
}

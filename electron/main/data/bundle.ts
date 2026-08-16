/**
 * The offline set bundle shipped with the app (electron/resources/draftfm):
 *   model/<tag>/…                DraftFM ONNX export (+ featurizer_manifest.json)
 *   sets/index.json              {model_id, model_manifest_hash, scryfall_updated_at,
 *                                 built_at, sets:{SET:{picks_per_pack, manifest_hash, …}}}
 *   sets/<SET>/assets.npz        per-set model assets: features, names, grp_ids (name → grpIds)
 *   sets/<SET>/cards.json        {set, scryfall_updated_at, built_at,
 *                                 cards:{name:{rarity, colors, colorIdentity,
 *                                              manaCost, manaValue, type}}}
 * Produced by scripts/build_app_bundle.py from a dated raw Scryfall snapshot.
 * Card identity is keyed by name; grpId → name comes from the assets' grp_ids
 * map, so every Arena printing for a model name resolves. Everything is read-only.
 */
import { existsSync, readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { parseNpz } from '../model/npz'

export interface CardInfo {
  grpId: number
  name: string
  rarity: string
  /** Printed WUBRG colours ('' for colourless cards and lands). */
  colors: string
  /** WUBRG colour identity, carried into CardRow for Arena display ordering. */
  colorIdentity: string
  manaCost: string
  manaValue: number | null
  type: string
}

export interface SetBundle {
  set: string
  dir: string
  assetsPath: string
  picksPerPack: number
  manifestHash: string | null
  /** Scryfall bulk-data `updated_at` the set was built from (null if unknown). */
  scryfallUpdatedAt: string | null
  /** grpId → identity, fanned out from name-keyed cards.json via assets grp_ids. */
  cards: Map<number, CardInfo>
  /** Names in assets row order. */
  names: string[]
}

export interface BundleSetEntry {
  picks_per_pack?: number
  manifest_hash?: string
  cards?: number
  grp_ids?: number
  text_missing?: number
  built_at?: string
  scryfall_updated_at?: string
}

export interface BundleIndex {
  modelDir: string
  modelTag: string
  /** Exported model id (index.json's model_id, else the model dir's meta.json). */
  modelId: string | null
  modelManifestHash: string | null
  scryfallUpdatedAt: string | null
  builtAt: string | null
  sets: Record<string, BundleSetEntry>
}

interface IndexFile {
  model_id?: string
  model_manifest_hash?: string
  scryfall_updated_at?: string
  built_at?: string
  sets?: Record<string, BundleSetEntry>
}

interface CardFields {
  rarity?: string
  colors?: string
  colorIdentity?: string
  manaCost?: string
  manaValue?: number | null
  type?: string
}

interface CardsFile {
  set?: string
  scryfall_updated_at?: string
  built_at?: string
  cards?: Record<string, CardFields>
}

/** Locate the bundle root: packaged Resources/draftfm, else the repo's electron/resources/draftfm. */
export function findBundleRoot(): string | null {
  const candidates = [
    join(process.resourcesPath ?? '', 'draftfm'),
    join(__dirname, '..', '..', 'resources', 'draftfm'),
    join(process.cwd(), 'resources', 'draftfm')
  ]
  for (const c of candidates) if (existsSync(join(c, 'model'))) return c
  return null
}

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null
  try { return JSON.parse(readFileSync(path, 'utf8')) as T } catch { return null }
}

export function readBundleIndex(root: string): BundleIndex | null {
  const modelParent = join(root, 'model')
  if (!existsSync(modelParent)) return null
  const tags = readdirSync(modelParent).filter(t => existsSync(join(modelParent, t, 'scorer.onnx'))).sort()
  if (!tags.length) return null
  const modelTag = tags[tags.length - 1]
  const modelDir = join(modelParent, modelTag)
  const idx = readJson<IndexFile>(join(root, 'sets', 'index.json'))
  const sets: BundleIndex['sets'] = { ...(idx?.sets ?? {}) }
  // Tolerate a bundle without index.json: discover set dirs.
  const setsDir = join(root, 'sets')
  if (existsSync(setsDir)) {
    for (const d of readdirSync(setsDir)) {
      if (existsSync(join(setsDir, d, 'assets.npz')) && !sets[d]) sets[d] = {}
    }
  }
  const meta = readJson<{ model_id?: string; manifest_hash?: string }>(join(modelDir, 'meta.json'))
  return {
    modelDir,
    modelTag,
    modelId: idx?.model_id ?? meta?.model_id ?? null,
    modelManifestHash: idx?.model_manifest_hash ?? meta?.manifest_hash ?? null,
    scryfallUpdatedAt: idx?.scryfall_updated_at ?? null,
    builtAt: idx?.built_at ?? null,
    sets
  }
}

/** Read names + grp_ids from assets.npz without decoding the feature matrix. */
export function readAssetsIdentity(assetsPath: string): { names: string[]; grpIds: Record<string, number[]> } {
  const archive = parseNpz(readFileSync(assetsPath))
  const names = archive.names?.kind === 'str' ? archive.names.data : []
  const rawGrpIds = archive.grp_ids?.kind === 'str' ? archive.grp_ids.data[0] ?? '{}' : '{}'
  let parsed: unknown = {}
  try { parsed = JSON.parse(rawGrpIds) } catch { parsed = {} }
  const grpIds: Record<string, number[]> = {}
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    for (const [name, values] of Object.entries(parsed)) {
      if (!Array.isArray(values)) continue
      grpIds[name] = values.map(Number).filter(Number.isFinite)
    }
  }
  return { names, grpIds }
}

const cache = new Map<string, SetBundle | null>()

/** Load (and memoise) one set's bundle; null when the set isn't shipped. */
export function loadSetBundle(root: string, set: string): SetBundle | null {
  const key = `${root}:${set}`
  if (cache.has(key)) return cache.get(key)!
  const dir = join(root, 'sets', set)
  const assetsPath = join(dir, 'assets.npz')
  if (!existsSync(assetsPath)) { cache.set(key, null); return null }

  let names: string[] = []
  let grpIds: Record<string, number[]> = {}
  try { ({ names, grpIds } = readAssetsIdentity(assetsPath)) } catch { /* identity is best-effort */ }

  const cardsFile = readJson<CardsFile>(join(dir, 'cards.json'))
  if (!cardsFile?.cards || typeof cardsFile.cards !== 'object' || Array.isArray(cardsFile.cards)) {
    console.warn(`[Bundle] ${set} cards.json is missing the name-keyed cards object; rebuild the shipped set bundles`)
  }
  const byName = cardsFile?.cards ?? {}
  const cards = new Map<number, CardInfo>()
  for (const [name, ids] of Object.entries(grpIds)) {
    const raw = byName[name] ?? {}
    for (const value of ids) {
      const grpId = Number(value)
      if (!Number.isFinite(grpId) || cards.has(grpId)) continue
      const manaValue = raw.manaValue === null || raw.manaValue === undefined ? null : Number(raw.manaValue)
      cards.set(grpId, {
        grpId,
        name,
        rarity: String(raw.rarity || 'common'),
        colors: String(raw.colors ?? ''),
        colorIdentity: String(raw.colorIdentity ?? ''),
        manaCost: String(raw.manaCost ?? ''),
        manaValue: Number.isFinite(manaValue) ? manaValue : null,
        type: String(raw.type ?? '')
      })
    }
  }

  let picksPerPack = 14
  let manifestHash: string | null = null
  const index = readJson<IndexFile>(join(root, 'sets', 'index.json'))
  const entry = index?.sets?.[set]
  if (entry?.picks_per_pack) picksPerPack = entry.picks_per_pack
  if (entry?.manifest_hash) manifestHash = entry.manifest_hash
  const scryfallUpdatedAt = cardsFile?.scryfall_updated_at
    ?? entry?.scryfall_updated_at
    ?? index?.scryfall_updated_at
    ?? null

  const bundle: SetBundle = {
    set, dir, assetsPath, picksPerPack, manifestHash, scryfallUpdatedAt, cards, names
  }
  cache.set(key, bundle)
  return bundle
}

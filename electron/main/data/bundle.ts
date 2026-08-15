/**
 * The offline set bundle shipped with the app (electron/resources/draftfm):
 *   model/<tag>/…                       DraftFM ONNX export
 *   sets/index.json                      {sets:{SET:{picks_per_pack, manifest_hash, …}}}
 *   sets/<SET>/assets.npz                per-set model assets (scripts/build_set_assets.py)
 *   sets/<SET>/cards.json                card identity per grpId (name, rarity, colours, cost, type, art)
 *   sets/<SET>/ratings.json              17Lands stats snapshot per format (display only; attribution required)
 * Produced by scripts/build_app_bundle.py. Everything here is read-only.
 */
import { existsSync, readFileSync, readdirSync } from 'fs'
import { join } from 'path'

export interface CardInfo {
  grpId: number
  name: string
  rarity: string
  colors: string
  manaCost: string
  manaValue: number | null
  type: string
  setCode: string
  imageSmall: string | null
  imageNormal: string | null
}

export interface CardRating {
  gih_wr?: number | null
  oh_wr?: number | null
  gd_wr?: number | null
  alsa?: number | null
  ata?: number | null
  games?: number | null
  [k: string]: unknown
}

export interface SetBundle {
  set: string
  dir: string
  assetsPath: string
  picksPerPack: number
  manifestHash: string | null
  cards: Map<number, CardInfo>
  /** format -> (grpId -> rating) */
  ratings: Map<string, Map<number, CardRating>>
  attribution: string | null
}

export interface BundleIndex {
  modelDir: string
  modelTag: string
  sets: Record<string, { picks_per_pack?: number; manifest_hash?: string; cards?: number; built_at?: string; formats_with_ratings?: string[] }>
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

export function readBundleIndex(root: string): BundleIndex | null {
  const modelParent = join(root, 'model')
  if (!existsSync(modelParent)) return null
  const tags = readdirSync(modelParent).filter(t => existsSync(join(modelParent, t, 'scorer.onnx'))).sort()
  if (!tags.length) return null
  const modelTag = tags[tags.length - 1]
  let sets: BundleIndex['sets'] = {}
  const idx = join(root, 'sets', 'index.json')
  if (existsSync(idx)) {
    try { sets = (JSON.parse(readFileSync(idx, 'utf8')) as { sets?: BundleIndex['sets'] }).sets ?? {} } catch { sets = {} }
  }
  // Tolerate a bundle without index.json: discover set dirs.
  const setsDir = join(root, 'sets')
  if (existsSync(setsDir)) {
    for (const d of readdirSync(setsDir)) {
      if (existsSync(join(setsDir, d, 'assets.npz')) && !sets[d]) sets[d] = {}
    }
  }
  return { modelDir: join(modelParent, modelTag), modelTag, sets }
}

const cache = new Map<string, SetBundle | null>()

/** Load (and memoise) one set's bundle; null when the set isn't shipped. */
export function loadSetBundle(root: string, set: string): SetBundle | null {
  const key = `${root}:${set}`
  if (cache.has(key)) return cache.get(key)!
  const dir = join(root, 'sets', set)
  const assetsPath = join(dir, 'assets.npz')
  if (!existsSync(assetsPath)) { cache.set(key, null); return null }
  const cards = new Map<number, CardInfo>()
  const cardsPath = join(dir, 'cards.json')
  if (existsSync(cardsPath)) {
    for (const raw of JSON.parse(readFileSync(cardsPath, 'utf8')) as Array<Record<string, unknown>>) {
      const grpId = Number(raw.grpId)
      if (!Number.isFinite(grpId)) continue
      cards.set(grpId, {
        grpId,
        name: String(raw.name ?? ''),
        rarity: String(raw.rarity ?? 'common'),
        colors: String(raw.colors ?? ''),
        manaCost: String(raw.manaCost ?? ''),
        manaValue: raw.manaValue === null || raw.manaValue === undefined ? null : Number(raw.manaValue),
        type: String(raw.type ?? ''),
        setCode: String(raw.setCode ?? set),
        imageSmall: raw.imageSmall ? String(raw.imageSmall) : null,
        imageNormal: raw.imageNormal ? String(raw.imageNormal) : null
      })
    }
  }
  const ratings = new Map<string, Map<number, CardRating>>()
  let attribution: string | null = null
  const ratingsPath = join(dir, 'ratings.json')
  if (existsSync(ratingsPath)) {
    try {
      const raw = JSON.parse(readFileSync(ratingsPath, 'utf8')) as Record<string, unknown>
      attribution = typeof raw.attribution === 'string' ? raw.attribution : null
      const formats = (raw.formats ?? raw) as Record<string, Record<string, CardRating>>
      for (const [fmt, byKey] of Object.entries(formats)) {
        if (fmt === 'attribution' || typeof byKey !== 'object' || !byKey) continue
        const m = new Map<number, CardRating>()
        for (const [k, v] of Object.entries(byKey)) {
          const g = Number(k)
          if (Number.isFinite(g)) m.set(g, v)
        }
        // Name-keyed ratings: fan out to every grpId with that name.
        for (const [k, v] of Object.entries(byKey)) {
          if (Number.isFinite(Number(k))) continue
          for (const c of cards.values()) if (c.name === k && !m.has(c.grpId)) m.set(c.grpId, v)
        }
        ratings.set(fmt, m)
      }
    } catch { /* ratings are optional */ }
  }
  let picksPerPack = 14
  let manifestHash: string | null = null
  const idx = join(root, 'sets', 'index.json')
  if (existsSync(idx)) {
    try {
      const entry = (JSON.parse(readFileSync(idx, 'utf8')) as { sets?: Record<string, { picks_per_pack?: number; manifest_hash?: string }> }).sets?.[set]
      if (entry?.picks_per_pack) picksPerPack = entry.picks_per_pack
      if (entry?.manifest_hash) manifestHash = entry.manifest_hash
    } catch { /* ignore */ }
  }
  const bundle: SetBundle = { set, dir, assetsPath, picksPerPack, manifestHash, cards, ratings, attribution }
  cache.set(key, bundle)
  return bundle
}

/** Ratings for a format with the usual fallbacks (QuickDraft → PremierDraft, etc.). */
export function ratingsFor(bundle: SetBundle, format: string | null): Map<number, CardRating> | null {
  const order = [format, 'PremierDraft', 'TradDraft', 'QuickDraft'].filter((f): f is string => !!f)
  for (const f of order) { const m = bundle.ratings.get(f); if (m && m.size) return m }
  const first = bundle.ratings.values().next()
  return first.done ? null : first.value
}

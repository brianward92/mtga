/**
 * Draft server API client (main process; Node >= 20 global fetch).
 *
 * Contract (see mtga/draft_api.py):
 *   GET  /api/v1/health
 *   GET  /api/v1/ratings?set=MSH&format=PremierDraft
 *   POST /api/v1/score {"set"?, "format", "pack", "pool", "pack_number"?, "pick_number"?}
 *
 * Ratings are fetched once per draft and cached to disk
 * (userData/cache/ratings-<set>-<format>.json with fetched_at) — the disk
 * cache is the offline fallback, and its ev_p1p1 doubles as the human-P1P1
 * tier list. Per-pick score POSTs use a short AbortSignal.timeout so the
 * pack UI is never blocked on the network.
 *
 * Status semantics:
 *   green — live model scores flowing
 *   amber — serving stale disk cache (stats only)
 *   red   — no server, no cache (names only)
 */

import { EventEmitter } from 'events'
import { join } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { TrackerConfig } from '../config'

export type ServerStatus = 'green' | 'amber' | 'red'

export interface ServerCardRow {
  grp_id: number
  name: string | null
  colors: string | null
  rarity: string | null
  mana_value: number | null
  image_small: string | null
  image_normal: string | null
  gih_wr?: number | null
  gih_wr_shrunk?: number | null
  gih_n?: number | null
  oh_wr?: number | null
  gd_wr?: number | null
  iwd?: number | null
  alsa?: number | null
  ata?: number | null
  ev_p1p1?: number | null
  ev?: number | null
  prob?: number | null
  rank?: number | null
}

export interface ModelInfo {
  id: string
  kind: string
  fallback: boolean | string | null
}

export interface RatingsResult {
  set: string
  format: string
  model: ModelInfo | null
  cards: ServerCardRow[]
  attribution?: string
  stale: boolean
  fetchedAt: string | null
}

export interface ScoreRequest {
  set?: string | null
  format: string
  pack: number[]
  pool: number[]
  packNumber?: number
  pickNumber?: number
}

export interface ScoreResult {
  set: string
  format: string
  model: ModelInfo | null
  cards: ServerCardRow[]
}

const RATINGS_TIMEOUT_MS = 10_000
const HEALTH_TIMEOUT_MS = 3_000
const RETRY_INTERVAL_MS = 30_000

export class ServerClient extends EventEmitter {
  private status: ServerStatus = 'red'
  private activeUrl: string | null = null
  private retryTimer: NodeJS.Timeout | null = null
  private hasCache = false

  constructor(
    private readonly config: TrackerConfig,
    private readonly cacheDir: string
  ) {
    super()
  }

  getStatus(): ServerStatus {
    return this.status
  }

  private setStatus(status: ServerStatus): void {
    if (status !== this.status) {
      this.status = status
      this.emit('status', status)
    }
  }

  private markOffline(): void {
    this.setStatus(this.hasCache ? 'amber' : 'red')
  }

  private cachePath(set: string, format: string): string {
    return join(this.cacheDir, `ratings-${set}-${format}.json`)
  }

  /**
   * Try each configured base URL in order (last-good URL first).
   */
  private async request(path: string, init: RequestInit, timeoutMs: number): Promise<unknown> {
    const urls = this.activeUrl
      ? [this.activeUrl, ...this.config.serverUrls.filter(u => u !== this.activeUrl)]
      : [...this.config.serverUrls]

    let lastError: Error = new Error('no server URLs configured')
    for (const base of urls) {
      try {
        const response = await fetch(`${base}${path}`, {
          ...init,
          signal: AbortSignal.timeout(timeoutMs)
        })
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }
        this.activeUrl = base
        return await response.json()
      } catch (error) {
        lastError = error as Error
        if (base === this.activeUrl) this.activeUrl = null
      }
    }
    throw lastError
  }

  /**
   * Fetch the ratings table for a set/format. Live fetch is written to the
   * disk cache; on failure the newest disk cache is served (stale).
   */
  async getRatings(set: string, format: string): Promise<RatingsResult | null> {
    try {
      const data = await this.request(
        `/api/v1/ratings?set=${encodeURIComponent(set)}&format=${encodeURIComponent(format)}`,
        { method: 'GET' },
        RATINGS_TIMEOUT_MS
      ) as Record<string, unknown>

      const result: RatingsResult = {
        set: (data.set as string) || set,
        format: (data.format as string) || format,
        model: (data.model as ModelInfo) ?? null,
        cards: (data.cards as ServerCardRow[]) ?? [],
        attribution: data.attribution as string | undefined,
        stale: false,
        fetchedAt: new Date().toISOString()
      }

      this.writeCache(set, format, result)
      this.hasCache = true
      this.setStatus('green')
      return result
    } catch (error) {
      console.error(`[Server] Ratings fetch failed for ${set}/${format}:`, (error as Error).message)
      const cached = this.readCache(set, format)
      if (cached) {
        this.hasCache = true
        this.setStatus('amber')
        return cached
      }
      this.markOffline()
      return null
    }
  }

  /**
   * Score a pack. Short timeout — the pack UI renders from cached stats
   * first and re-sorts when this resolves; a miss just leaves the amber path.
   */
  async score(req: ScoreRequest, timeoutMs: number = this.config.requestTimeoutMs): Promise<ScoreResult | null> {
    const body: Record<string, unknown> = {
      format: req.format,
      pack: req.pack,
      pool: req.pool
    }
    if (req.set) body.set = req.set
    if (req.packNumber !== undefined) body.pack_number = req.packNumber
    if (req.pickNumber !== undefined) body.pick_number = req.pickNumber

    try {
      const data = await this.request(
        '/api/v1/score',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        },
        timeoutMs
      ) as Record<string, unknown>

      this.setStatus('green')
      return {
        set: (data.set as string) || req.set || '',
        format: (data.format as string) || req.format,
        model: (data.model as ModelInfo) ?? null,
        cards: (data.cards as ServerCardRow[]) ?? []
      }
    } catch (error) {
      console.error('[Server] Score request failed:', (error as Error).message)
      this.markOffline()
      return null
    }
  }

  async checkHealth(): Promise<boolean> {
    try {
      await this.request('/api/v1/health', { method: 'GET' }, HEALTH_TIMEOUT_MS)
      return true
    } catch {
      return false
    }
  }

  /**
   * Background retry: while not green, probe health every 30s and emit
   * 'reconnected' on recovery so live ratings can be re-fetched.
   */
  startRetryLoop(): void {
    if (this.retryTimer) return
    this.retryTimer = setInterval(() => {
      if (this.status === 'green') return
      void this.checkHealth().then(ok => {
        if (ok) {
          this.setStatus('green')
          this.emit('reconnected')
        }
      })
    }, RETRY_INTERVAL_MS)
  }

  stop(): void {
    if (this.retryTimer) {
      clearInterval(this.retryTimer)
      this.retryTimer = null
    }
  }

  // -- disk cache ------------------------------------------------------------

  private writeCache(set: string, format: string, result: RatingsResult): void {
    try {
      if (!existsSync(this.cacheDir)) mkdirSync(this.cacheDir, { recursive: true })
      writeFileSync(this.cachePath(set, format), JSON.stringify({
        set: result.set,
        format: result.format,
        model: result.model,
        cards: result.cards,
        attribution: result.attribution,
        fetched_at: result.fetchedAt
      }))
    } catch (error) {
      console.error('[Server] Failed to write ratings cache:', error)
    }
  }

  private readCache(set: string, format: string): RatingsResult | null {
    try {
      const path = this.cachePath(set, format)
      if (!existsSync(path)) return null
      const data = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>
      return {
        set: (data.set as string) || set,
        format: (data.format as string) || format,
        model: (data.model as ModelInfo) ?? null,
        cards: (data.cards as ServerCardRow[]) ?? [],
        attribution: data.attribution as string | undefined,
        stale: true,
        fetchedAt: (data.fetched_at as string) ?? null
      }
    } catch (error) {
      console.error('[Server] Failed to read ratings cache:', error)
      return null
    }
  }
}

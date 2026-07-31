/**
 * On-disk cache for Scryfall card art.
 *
 * The overlay renders thumbnails for pack rows, which must not mean an HTTPS
 * request per render (or per re-render — the pack table rebuilds its innerHTML
 * on every score update). Art is immutable per grpId, so it is fetched once,
 * written under userData/card-art, and thereafter served from a file:// URL.
 *
 * Everything here is best-effort and non-blocking: a cache miss returns null so
 * the renderer simply shows no thumbnail, and a download failure is recorded so
 * the same URL is not retried in a tight loop.
 */

import { createWriteStream, existsSync, mkdirSync, renameSync, unlinkSync } from 'fs'
import { get as httpsGet } from 'https'
import { join } from 'path'
import { pathToFileURL } from 'url'

/** Downloads in flight or permanently failed, keyed by grpId. */
const inFlight = new Set<number>()
const failed = new Map<number, number>()

/** Do not retry a failed fetch more often than this (ms). */
const RETRY_AFTER_MS = 10 * 60 * 1000
const MAX_REDIRECTS = 3

let cacheDir: string | null = null
let onCached: ((grpId: number) => void) | null = null

/**
 * @param dir     directory for cached art (created on demand)
 * @param notify  called after a successful download so the caller can re-push
 *                rows to the renderer with the now-local URL
 */
export function initCardArtCache(dir: string, notify?: (grpId: number) => void): void {
  cacheDir = dir
  onCached = notify ?? null
}

function artPath(grpId: number): string | null {
  return cacheDir ? join(cacheDir, `${grpId}.jpg`) : null
}

/**
 * Local file:// URL for this card's art, or null when it is not cached yet.
 * Kicks off a background download on a miss when `remoteUrl` is provided.
 */
export function cachedArtUrl(grpId: number, remoteUrl: string | null): string | null {
  const path = artPath(grpId)
  if (!path) return null
  if (existsSync(path)) return pathToFileURL(path).href
  if (remoteUrl) void fetchArt(grpId, remoteUrl)
  return null
}

function shouldSkip(grpId: number): boolean {
  if (inFlight.has(grpId)) return true
  const failedAt = failed.get(grpId)
  return failedAt !== undefined && Date.now() - failedAt < RETRY_AFTER_MS
}

function fetchArt(grpId: number, remoteUrl: string, redirects = 0): void {
  const path = artPath(grpId)
  if (!path || shouldSkip(grpId)) return
  if (!/^https:\/\//i.test(remoteUrl)) return

  inFlight.add(grpId)
  const tmp = `${path}.part`

  const fail = (reason: string): void => {
    inFlight.delete(grpId)
    failed.set(grpId, Date.now())
    try {
      if (existsSync(tmp)) unlinkSync(tmp)
    } catch {
      /* the temp file is disposable */
    }
    console.warn(`[CardArt] ${grpId}: ${reason}`)
  }

  try {
    if (!existsSync(cacheDir!)) mkdirSync(cacheDir!, { recursive: true })
  } catch (error) {
    fail(`cache dir unavailable: ${String(error)}`)
    return
  }

  const request = httpsGet(remoteUrl, response => {
    const status = response.statusCode ?? 0
    const location = response.headers.location

    if (status >= 300 && status < 400 && location) {
      response.resume()
      inFlight.delete(grpId)
      if (redirects >= MAX_REDIRECTS) {
        failed.set(grpId, Date.now())
        return
      }
      fetchArt(grpId, new URL(location, remoteUrl).href, redirects + 1)
      return
    }

    if (status !== 200) {
      response.resume()
      fail(`HTTP ${status}`)
      return
    }

    const file = createWriteStream(tmp)
    response.pipe(file)
    file.on('finish', () => {
      file.close(() => {
        try {
          // Rename last so a torn download never looks like a valid cache hit.
          renameSync(tmp, path)
          inFlight.delete(grpId)
          failed.delete(grpId)
          onCached?.(grpId)
        } catch (error) {
          fail(`rename failed: ${String(error)}`)
        }
      })
    })
    file.on('error', error => fail(`write failed: ${String(error)}`))
  })

  request.setTimeout(8000, () => {
    request.destroy()
    fail('timed out')
  })
  request.on('error', error => fail(String(error)))
}

/** Test seam. */
export function resetCardArtCacheState(): void {
  inFlight.clear()
  failed.clear()
}

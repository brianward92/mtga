/**
 * Card art cache: local-hit resolution and the guards that keep a cache miss
 * from becoming a render-time network dependency. The download path itself is
 * not exercised here (no live HTTPS in tests).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { pathToFileURL } from 'url'
import {
  initCardArtCache,
  cachedArtUrl,
  resetCardArtCacheState
} from '../main/utils/card-art-cache'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'card-art-'))
  resetCardArtCacheState()
  initCardArtCache(dir)
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('cachedArtUrl', () => {
  it('returns a file:// URL for art already on disk', () => {
    mkdirSync(dir, { recursive: true })
    const path = join(dir, '105051.jpg')
    writeFileSync(path, 'jpeg-bytes')

    expect(cachedArtUrl(105051, null)).toBe(pathToFileURL(path).href)
  })

  it('returns null on a miss so the row renders without a thumbnail', () => {
    expect(cachedArtUrl(999999, 'https://cards.scryfall.io/small/x.jpg')).toBeNull()
  })

  it('returns null on a miss with no remote URL and starts no download', () => {
    expect(cachedArtUrl(888888, null)).toBeNull()
  })

  it('never returns a remote URL — a miss must not become a render-time fetch', () => {
    const remote = 'https://cards.scryfall.io/small/front/1/0/abc.jpg'
    expect(cachedArtUrl(777777, remote)).not.toBe(remote)
  })

  it('ignores non-HTTPS remote URLs', () => {
    expect(cachedArtUrl(666666, 'http://insecure.example/x.jpg')).toBeNull()
    expect(cachedArtUrl(666667, 'file:///etc/passwd')).toBeNull()
  })

  it('returns null when the cache was never initialised', () => {
    initCardArtCache('')
    expect(cachedArtUrl(105051, null)).toBeNull()
  })
})

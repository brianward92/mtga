/**
 * Tracker configuration: ~/.mtga-tracker/config.json
 * (same directory the overlay position file already lives in).
 * Created with defaults on first run; missing keys are backfilled.
 */

import { join } from 'path'
import { homedir } from 'os'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'

export interface TrackerConfig {
  /** Draft server base URLs, tried in order. */
  serverUrls: string[]
  /** Optional model override sent to the server (reserved). */
  model?: string
  /** Per-pick score request timeout (ms). */
  requestTimeoutMs: number
  /** Also tail the legacy UTC_Log directory for match tracking. */
  watchLegacyLogs: boolean
}

const CONFIG_DIR = join(homedir(), '.mtga-tracker')
const CONFIG_FILE = join(CONFIG_DIR, 'config.json')

const DEFAULTS: TrackerConfig = {
  serverUrls: ['http://n41.local:8100', 'http://192.168.4.25:8100'],
  requestTimeoutMs: 800,
  watchLegacyLogs: true
}

let cached: TrackerConfig | null = null

export function loadConfig(): TrackerConfig {
  if (cached) return cached

  let fileConfig: Partial<TrackerConfig> = {}
  let needsWrite = false

  if (existsSync(CONFIG_FILE)) {
    try {
      fileConfig = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8')) as Partial<TrackerConfig>
    } catch (error) {
      console.error('[Config] Failed to parse config.json, using defaults:', error)
    }
  } else {
    needsWrite = true
  }

  cached = {
    serverUrls: Array.isArray(fileConfig.serverUrls) && fileConfig.serverUrls.length > 0
      ? fileConfig.serverUrls
      : DEFAULTS.serverUrls,
    model: fileConfig.model,
    requestTimeoutMs: typeof fileConfig.requestTimeoutMs === 'number'
      ? fileConfig.requestTimeoutMs
      : DEFAULTS.requestTimeoutMs,
    watchLegacyLogs: typeof fileConfig.watchLegacyLogs === 'boolean'
      ? fileConfig.watchLegacyLogs
      : DEFAULTS.watchLegacyLogs
  }

  if (needsWrite) {
    try {
      if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true })
      writeFileSync(CONFIG_FILE, JSON.stringify(cached, null, 2))
      console.log('[Config] Created default config at', CONFIG_FILE)
    } catch (error) {
      console.error('[Config] Failed to write default config:', error)
    }
  }

  return cached
}

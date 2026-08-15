/**
 * User preferences — one small JSON file at ~/.mtga-tracker/prefs.json.
 * (Replaces overlay-position.json's grab-bag; badge calibrations live here.)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { normalizeCalibration, type CalibrationConfig } from '../shared/layout'
import type { HudCorner, Prefs } from '../shared/state'
export type { HudCorner, Prefs }

export const DEFAULT_PREFS: Prefs = {
  badges: true,
  hud: true,
  hudCorner: 'tr',
  layerDetection: true,
  calibrations: {}
}

const CONFIG_DIR = join(homedir(), '.mtga-tracker')
const PREFS_FILE = join(CONFIG_DIR, 'prefs.json')
const LEGACY_POSITIONS = join(CONFIG_DIR, 'overlay-position.json')

let cached: Prefs | null = null

export function loadPrefs(): Prefs {
  if (cached) return cached
  let raw: Record<string, unknown> = {}
  try { if (existsSync(PREFS_FILE)) raw = JSON.parse(readFileSync(PREFS_FILE, 'utf8')) } catch { raw = {} }
  // One-time migration of badge calibrations from the legacy positions file.
  if (!raw.calibrations) {
    try {
      if (existsSync(LEGACY_POSITIONS)) {
        const legacy = JSON.parse(readFileSync(LEGACY_POSITIONS, 'utf8')) as { badgeCalibrations?: Record<string, unknown> }
        if (legacy.badgeCalibrations) raw.calibrations = legacy.badgeCalibrations
      }
    } catch { /* ignore */ }
  }
  const calibrations: Record<string, CalibrationConfig> = {}
  for (const [k, v] of Object.entries((raw.calibrations as Record<string, unknown>) ?? {})) calibrations[k] = normalizeCalibration(v)
  cached = {
    badges: raw.badges !== false,
    hud: raw.hud !== false,
    hudCorner: (['tl', 'tr', 'bl', 'br'] as const).includes(raw.hudCorner as HudCorner) ? (raw.hudCorner as HudCorner) : 'tr',
    layerDetection: raw.layerDetection !== false,
    calibrations
  }
  return cached
}

export function savePrefs(patch: Partial<Prefs>): Prefs {
  const next = { ...loadPrefs(), ...patch }
  cached = next
  try {
    mkdirSync(CONFIG_DIR, { recursive: true })
    writeFileSync(PREFS_FILE, JSON.stringify(next, null, 2))
  } catch (err) {
    console.error('[Prefs] save failed:', err)
  }
  return next
}

/** Test seam. */
export function _resetPrefsCache(): void { cached = null }

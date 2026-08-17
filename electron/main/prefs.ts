/**
 * User preferences — one small JSON file at ~/.mtga-tracker/prefs.json.
 * (Replaces overlay-position.json's grab-bag; badge calibrations live here.)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { normalizeCalibration, type CalibrationConfig } from '../shared/layout'
import type { HudCorner, Prefs } from '../shared/state'

const DEFAULT_PREFS: Prefs = {
  badges: true,
  hud: true,
  hudCorner: 'tr',
  // Opt-in: uses one-shot window captures (macOS Screen Recording). Off by
  // default so the app needs no permission at all out of the box.
  layerDetection: false,
  // On by default: a menu-bar app that is not running when Arena opens is an
  // overlay the drafter never sees.
  openAtLogin: true,
  calibrations: {}
}

const CONFIG_DIR = join(homedir(), '.mtga-tracker')
const PREFS_FILE = join(CONFIG_DIR, 'prefs.json')
const LEGACY_POSITIONS = join(CONFIG_DIR, 'overlay-position.json')

let cached: Prefs | null = null

/** Load normalized preferences, using the in-process cache after first read. */
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
    badges: raw.badges === false ? false : DEFAULT_PREFS.badges,
    hud: raw.hud === false ? false : DEFAULT_PREFS.hud,
    hudCorner: (['tl', 'tr', 'bl', 'br'] as const).includes(raw.hudCorner as HudCorner)
      ? (raw.hudCorner as HudCorner)
      : DEFAULT_PREFS.hudCorner,
    layerDetection: raw.layerDetection === true ? true : DEFAULT_PREFS.layerDetection,
    openAtLogin: raw.openAtLogin === false ? false : DEFAULT_PREFS.openAtLogin,
    calibrations
  }
  return cached
}

/** Merge, persist, and return a preference patch. */
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

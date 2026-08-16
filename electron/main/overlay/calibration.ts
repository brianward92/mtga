/**
 * Grid calibration: the pack-cell geometry per Arena aspect bucket. Built-in
 * defaults fit Arena's default window; the user can tune once via ghosts.
 */
import { EventEmitter } from 'events'
import {
  applyCalibrationOp, aspectBucketOf, nearestCalibrationBucket, normalizeCalibration,
  type CalibrationConfig, type CalibrationOp
} from '../../shared/layout'
import { loadPrefs, savePrefs } from '../prefs'
import type { ArenaRect } from '../arena-geometry'

import type { CalibrateState } from '../../shared/state'

/** Owns editable and persisted pack-grid calibration state. */
export class Calibration extends EventEmitter {
  active = false
  count = 14
  private working: CalibrationConfig | null = null

  /** Config for the current Arena size: working (while calibrating) → persisted bucket → nearest → default. */
  configFor(rect: ArenaRect | null): CalibrationConfig {
    if (this.active && this.working) return this.working
    const configs = loadPrefs().calibrations
    if (!rect) return normalizeCalibration(configs['default'] ?? {})
    const bucket = nearestCalibrationBucket(Object.keys(configs), rect.width, rect.height) ?? aspectBucketOf(rect.width, rect.height)
    return normalizeCalibration(configs[bucket] ?? configs['default'] ?? {})
  }

  /** Start editing a copy of the best calibration for the current bounds. */
  start(rect: ArenaRect | null): void {
    if (this.active) { this.emit('change'); return }
    this.active = true
    this.working = this.configFor(rect)
    this.emit('change')
  }

  /** Apply one calibration adjustment while editing is active. */
  adjust(op: CalibrationOp, rect: ArenaRect | null): void {
    if (!this.active) return
    this.working = applyCalibrationOp(this.working ?? this.configFor(rect), op)
    this.emit('change')
  }

  /** Select the supported pack size shown by calibration ghosts. */
  setCount(count: number): void {
    if (!this.active) return
    this.count = count === 13 || count === 15 ? count : 14
    this.emit('change')
  }

  /** Finish editing and optionally persist the current aspect-bucket config. */
  finish(save: boolean, rect: ArenaRect | null): void {
    if (!this.active) return
    if (save && this.working) {
      const bucket = rect ? aspectBucketOf(rect.width, rect.height) : 'default'
      savePrefs({ calibrations: { ...loadPrefs().calibrations, [bucket]: this.working } })
    }
    this.active = false
    this.working = null
    this.emit('change')
  }

  /** Build the renderer-facing calibration snapshot. */
  state(rect: ArenaRect | null, arenaFound: boolean): CalibrateState {
    return { active: this.active, count: this.count, config: this.configFor(rect), arenaFound }
  }
}

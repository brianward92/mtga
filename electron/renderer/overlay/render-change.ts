import type { CalibrateState, LayerState } from '../../shared/state'
import type { ViewPrefs } from './types'

function sameNumbers(a: ReadonlyArray<number>, b: ReadonlyArray<number>): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i])
}

/** DraftState.seq is monotonic, so equal seq values are duplicate pushes. */
export function draftStateAdvanced(currentSeq: number, nextSeq: number): boolean {
  return nextSeq > currentSeq
}

/** Compare normalized renderer preferences field-for-field. */
export function sameViewPrefs(a: ViewPrefs, b: ViewPrefs): boolean {
  return a.badges === b.badges && a.hud === b.hud &&
    a.hudCorner === b.hudCorner && a.layerDetection === b.layerDetection
}

/** Compare layer-awareness payloads without relying on object identity. */
export function sameLayerState(a: LayerState, b: LayerState): boolean {
  return a.covered === b.covered && a.hudCovered === b.hudCovered &&
    sameNumbers(a.cells, b.cells) && a.regions.length === b.regions.length &&
    a.regions.every((rect, i) => {
      const other = b.regions[i]
      return rect.x === other.x && rect.y === other.y &&
        rect.width === other.width && rect.height === other.height
    })
}

/** Compare calibration payloads, including every grid geometry field. */
export function sameCalibrateState(a: CalibrateState, b: CalibrateState): boolean {
  const ac = a.config
  const bc = b.config
  return a.active === b.active && a.count === b.count && a.arenaFound === b.arenaFound &&
    ac.packLeft === bc.packLeft && ac.packTop === bc.packTop &&
    ac.packWidth === bc.packWidth && ac.packHeight === bc.packHeight &&
    ac.maxCols === bc.maxCols && ac.lastRowAlign === bc.lastRowAlign &&
    ac.rowGap === bc.rowGap && ac.colGap === bc.colGap &&
    ac.cardAspect === bc.cardAspect && ac.badgeOffsetY === bc.badgeOffsetY &&
    ac.badgeWidth === bc.badgeWidth && ac.badgeHeight === bc.badgeHeight &&
    ac.refCount === bc.refCount
}

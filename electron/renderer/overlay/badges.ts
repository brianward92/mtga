/**
 * Badge layer: a thin tier-tinted frame around every pack card plus a chip
 * (grade · flames · head-to-head %) at the top of the art, #1–#3 rank tags
 * and the top pick's conviction label. Purely visual, never interactive.
 *
 * Keyed DOM: one cell (frame + chip) per display cell, created once and
 * updated in place (text/classes/geometry) — no innerHTML churn on state
 * pushes. Cells not in use are detached, so `[data-testid="badge-cell"]`
 * counts exactly the pack on screen. Layer awareness: cells main reports as
 * covered get `behind`; main applies the preview's calibrated overlap
 * threshold before reporting those cell indices. `covered` lifts the whole
 * layer.
 */
import type { PackLayout, Rect } from '../../shared/layout'
import { arenaDisplayOrder } from '../../shared/display-order'
import { buildChips, type ChipModel } from './chips'
import type { Store } from './types'

interface CellNodes {
  /** The frame — also the cell wrapper (its rect IS the card rect). */
  cell: HTMLDivElement
  rank: HTMLSpanElement
  label: HTMLSpanElement
  chip: HTMLDivElement
  grade: HTMLSpanElement
  flames: HTMLSpanElement[]
  flamesWrap: HTMLSpanElement
  pct: HTMLSpanElement
  attached: boolean
  geomKey: string
  chipKey: string
  cellClass: string
  chipClass: string
  scored: boolean | null
}

const FRAME_BORDER = 2

export class BadgeLayer {
  private cells: CellNodes[] = []
  private visible = true
  private covered = false

  constructor(private root: HTMLElement) {}

  update(store: Store, layout: PackLayout | null): void {
    const { state, prefs, layer, calibrate } = store
    const show = state.phase === 'active' && state.cards.length > 0 && prefs.badges && !calibrate.active && layout !== null
    this.setVisible(show)
    if (!show || !layout) { this.detachFrom(0); return }
    this.setCovered(layer.covered)

    const cards = state.cards
    const chips = buildChips(cards, state.scoring)
    const order = arenaDisplayOrder(cards)
    const coveredCells = new Set(layer.cells)

    let used = 0
    for (let cell = 0; cell < order.length; cell++) {
      const slot = layout.cards[cell]
      const cardIndex = order[cell]
      const chip = chips[cardIndex]
      if (!slot || !chip) continue
      const nodes = this.cellAt(used++)
      this.attach(nodes)
      const behind = coveredCells.has(cell)
      const scored = cards[cardIndex].ev !== null
      this.paintCell(nodes, chip, slot.card, slot.badge, behind, scored)
    }
    this.detachFrom(used)
  }

  private setVisible(on: boolean): void {
    if (on === this.visible) return
    this.visible = on
    this.root.classList.toggle('hidden', !on)
  }

  private setCovered(on: boolean): void {
    if (on === this.covered) return
    this.covered = on
    this.root.classList.toggle('covered', on)
  }

  private cellAt(i: number): CellNodes {
    while (this.cells.length <= i) this.cells.push(this.createCell())
    return this.cells[i]
  }

  private attach(n: CellNodes): void {
    if (n.attached) return
    n.attached = true
    this.root.appendChild(n.cell)
  }

  private detachFrom(index: number): void {
    for (let i = index; i < this.cells.length; i++) {
      const n = this.cells[i]
      if (!n.attached) continue
      n.attached = false
      n.cell.remove()
    }
  }

  private createCell(): CellNodes {
    const cell = document.createElement('div')
    cell.className = 'card-frame'
    cell.dataset.testid = 'badge-cell'
    const rank = document.createElement('span')
    rank.className = 'b-rank'
    const label = document.createElement('span')
    label.className = 'b-label'

    const chip = document.createElement('div')
    chip.className = 'badge-chip'
    const grade = document.createElement('span')
    grade.className = 'b-grade'
    const flamesWrap = document.createElement('span')
    flamesWrap.className = 'b-flames'
    const flames: HTMLSpanElement[] = []
    for (let f = 0; f < 5; f++) {
      const s = document.createElement('span')
      s.className = 'b-flame'
      s.textContent = '🔥'
      flamesWrap.appendChild(s)
      flames.push(s)
    }
    const pct = document.createElement('span')
    pct.className = 'b-pct'
    chip.append(grade, flamesWrap, pct)
    cell.append(rank, label, chip)

    return {
      cell, rank, label, chip, grade, flames, flamesWrap, pct,
      attached: false, geomKey: '', chipKey: '', cellClass: '', chipClass: '', scored: null
    }
  }

  private paintCell(n: CellNodes, chip: ChipModel, card: Rect, badge: Rect, behind: boolean, scored: boolean): void {
    // Geometry (only when it moved). The chip is positioned inside the cell.
    const geomKey = `${card.x.toFixed(1)},${card.y.toFixed(1)},${card.width.toFixed(1)},${card.height.toFixed(1)},${badge.y.toFixed(1)},${badge.height.toFixed(1)}`
    if (geomKey !== n.geomKey) {
      n.geomKey = geomKey
      const cs = n.cell.style
      cs.left = `${card.x.toFixed(1)}px`
      cs.top = `${card.y.toFixed(1)}px`
      cs.width = `${card.width.toFixed(1)}px`
      cs.height = `${card.height.toFixed(1)}px`
      cs.borderRadius = `${Math.max(4, card.width * 0.045).toFixed(1)}px`
      // Rank/label tags scale with the card, not the window font.
      cs.fontSize = `${Math.max(9, Math.min(14, card.width * 0.085)).toFixed(1)}px`
      const h = Math.max(16, Math.min(badge.height, card.width * 0.22))
      const ch = n.chip.style
      ch.top = `${(badge.y - card.y - FRAME_BORDER).toFixed(1)}px`
      ch.height = `${h.toFixed(1)}px`
      ch.fontSize = `${(h * 0.44).toFixed(1)}px`
    }

    // Cell classes + scored marker.
    const tier = chip.tier ? `tier-${chip.tier}` : 'tier-none'
    const cellClass = `card-frame ${tier}${chip.top ? ' top' : ''}${behind ? ' behind' : ''}`
    if (cellClass !== n.cellClass) { n.cellClass = cellClass; n.cell.className = cellClass }
    if (scored !== n.scored) { n.scored = scored; n.cell.dataset.scored = scored ? 'true' : 'false' }

    // Rank tag / conviction label.
    const rankText = chip.rank !== null && chip.rank <= 3 ? `#${chip.rank}` : ''
    if (n.rank.textContent !== rankText) n.rank.textContent = rankText
    n.rank.hidden = rankText === ''
    const labelText = chip.label ?? ''
    if (n.label.textContent !== labelText) n.label.textContent = labelText
    n.label.hidden = labelText === ''

    // Chip.
    if (!chip.chip) { n.chip.hidden = true; return }
    n.chip.hidden = false
    const chipClass = `badge-chip ${tier}${chip.top ? ' top' : ' dim'}${chip.shimmer ? ' shimmer' : ''}`
    if (chipClass !== n.chipClass) { n.chipClass = chipClass; n.chip.className = chipClass }
    const chipKey = `${chip.grade ?? ''}|${chip.flames ?? ''}|${chip.pct ?? ''}`
    if (chipKey !== n.chipKey) {
      n.chipKey = chipKey
      n.grade.textContent = chip.grade ?? ''
      n.grade.hidden = chip.grade === null
      n.flamesWrap.hidden = chip.flames === null
      for (let f = 0; f < 5; f++) n.flames[f].classList.toggle('lit', chip.flames !== null && f < chip.flames)
      n.pct.textContent = chip.pct ?? ''
      n.pct.hidden = chip.pct === null
    }
  }
}

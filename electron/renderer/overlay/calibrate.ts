/**
 * Grid calibration: dashed ghost cells numbered 1..count for the current
 * config over the pack area (visual, click-through) plus the interactive
 * helper panel (on Arena's right rail, clear of the ghosts). Every button
 * sends an action; main merges the op into the working config and pushes
 * the updated calibrate state back, so the ghosts move live.
 *
 * The overlay window is never focusable, so keyboard nudging is impossible
 * by design — the arrow BUTTONS are the nudge surface.
 */
import { packLayout, type Rect } from '../../shared/layout'
import type { Store } from './types'

type Action = (name: string, data?: unknown) => void

interface GhostNodes { card: HTMLDivElement; num: HTMLSpanElement; badge: HTMLDivElement; key: string }

function place(el: HTMLElement, r: Rect): void {
  el.style.left = `${r.x.toFixed(1)}px`
  el.style.top = `${r.y.toFixed(1)}px`
  el.style.width = `${r.width.toFixed(1)}px`
  el.style.height = `${r.height.toFixed(1)}px`
}

export class CalibrateLayer {
  private readonly frame: HTMLDivElement
  private readonly ghosts: GhostNodes[] = []
  private readonly status: HTMLElement
  private readonly countBtns: HTMLElement[]
  private active = false
  private frameKey = ''

  constructor(private ghostRoot: HTMLElement, private panel: HTMLElement, action: Action) {
    this.frame = document.createElement('div')
    this.frame.className = 'ghost-frame'
    ghostRoot.appendChild(this.frame)
    this.status = panel.querySelector('#calStatus')!
    this.countBtns = Array.from(panel.querySelectorAll<HTMLElement>('[data-count]'))

    panel.querySelectorAll<HTMLElement>('[data-op]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!this.active || !btn.dataset.op) return
        try { action('calibrate-op', JSON.parse(btn.dataset.op)) } catch { /* malformed markup */ }
      })
    })
    for (const btn of this.countBtns) {
      btn.addEventListener('click', () => {
        if (!this.active) return
        action('calibrate-count', { count: parseInt(btn.dataset.count ?? '14', 10) })
      })
    }
    panel.querySelector('#calSave')!.addEventListener('click', () => action('calibrate-finish', { save: true }))
    panel.querySelector('#calCancel')!.addEventListener('click', () => action('calibrate-finish', { save: false }))
  }

  update(store: Store): void {
    const { calibrate, view } = store
    if (calibrate.active !== this.active) {
      this.active = calibrate.active
      this.panel.hidden = !this.active
      this.ghostRoot.classList.toggle('active', this.active)
      // Test hook: present only while calibrating.
      if (this.active) this.panel.dataset.testid = 'calibrate-panel'
      else delete this.panel.dataset.testid
    }
    if (!this.active) return

    this.status.textContent = calibrate.arenaFound
      ? `Arena window locked · adjusting ${calibrate.count} ghost cards`
      : 'Arena window not found — is MTGA running?'
    this.status.classList.toggle('cal-error', !calibrate.arenaFound)
    for (const btn of this.countBtns) {
      btn.classList.toggle('active', parseInt(btn.dataset.count ?? '', 10) === calibrate.count)
    }

    const layout = packLayout(view, calibrate.count, calibrate.config)
    const frameKey = JSON.stringify(layout.pack)
    if (frameKey !== this.frameKey) { this.frameKey = frameKey; place(this.frame, layout.pack) }

    layout.cards.forEach((slot, i) => {
      const g = this.ghostAt(i)
      const key = `${slot.card.x},${slot.card.y},${slot.card.width},${slot.card.height},${slot.badge.y},${slot.badge.width}`
      if (key !== g.key) {
        g.key = key
        place(g.card, slot.card)
        place(g.badge, slot.badge)
        g.num.textContent = String(i + 1)
      }
      g.card.hidden = false
      g.badge.hidden = false
    })
    for (let i = layout.cards.length; i < this.ghosts.length; i++) {
      this.ghosts[i].card.hidden = true
      this.ghosts[i].badge.hidden = true
    }
  }

  private ghostAt(i: number): GhostNodes {
    while (this.ghosts.length <= i) {
      const card = document.createElement('div')
      card.className = 'ghost-card'
      const num = document.createElement('span')
      num.className = 'ghost-num'
      card.appendChild(num)
      const badge = document.createElement('div')
      badge.className = 'ghost-badge'
      this.ghostRoot.append(card, badge)
      this.ghosts.push({ card, num, badge, key: '' })
    }
    return this.ghosts[i]
  }
}

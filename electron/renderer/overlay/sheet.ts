/**
 * Pool / pick-history sheet: slides in from the HUD's side. Lists the pool
 * grouped by colour (mana cost · name · grade) and every pick (P1p1 …:
 * taken card, the model's pick when different, ✓ / rank tag) with the
 * agreement rate. Toggled by main's 'toggle-sheet' command (global
 * shortcut, menu, HUD button); the close button routes through the same
 * action so main's notion of open/closed stays in step.
 *
 * Content re-renders only when the state seq or open flag changes.
 */
import type { CardRow, PickRecord } from '../../shared/state'
import { gradeTier } from '../../shared/grades'
import { agreement, groupPool, POOL_GROUP_NAMES, sheetSide } from './hud-logic'
import { escapeHtml, renderManaCost } from './shared'
import type { Rect, Store } from './types'

type Action = (name: string, data?: unknown) => void

function gradeHtml(card: Pick<CardRow, 'grade'>): string {
  return card.grade
    ? `<span class="s-grade grade-${gradeTier(card.grade)}">${card.grade}</span>`
    : '<span class="s-grade grade-none">—</span>'
}

export function poolHtml(pool: ReadonlyArray<CardRow>): string {
  if (pool.length === 0) return '<div class="s-empty">No cards yet</div>'
  return groupPool(pool).map(({ group, cards }) => `
    <div class="s-group">
      <h3 class="sheet-h"><span>${POOL_GROUP_NAMES[group]}</span><span class="s-count">${cards.length}</span></h3>
      ${cards.map(c => `
        <div class="s-card">
          <span class="s-mana">${renderManaCost(c.manaCost)}</span>
          <span class="s-name">${escapeHtml(c.name)}</span>
          ${gradeHtml(c)}
        </div>`).join('')}
    </div>`).join('')
}

export function picksHtml(picks: ReadonlyArray<PickRecord>): string {
  if (picks.length === 0) return '<li class="s-empty">No picks yet</li>'
  return [...picks].reverse().map(p => {
    const agreed = p.takenRank === 1
    const differs = p.recommendedGrpId !== null && p.recommendedGrpId !== p.grpId
    const tag = p.takenRank === null
      ? '<span class="s-tag none">·</span>'
      : agreed
        ? '<span class="s-tag ok">✓</span>'
        : `<span class="s-tag off">#${p.takenRank}</span>`
    const model = differs && p.recommendedName
      ? `<span class="s-model" title="Model's pick">→ ${escapeHtml(p.recommendedName)}</span>`
      : ''
    return `
      <li class="s-pick${agreed ? ' agreed' : ''}">
        <span class="s-pos">P${p.pack}p${p.pick}</span>
        <span class="s-taken">${escapeHtml(p.name)}</span>
        ${model}
        ${tag}
      </li>`
  }).join('')
}

export class Sheet {
  private readonly pool: HTMLElement
  private readonly picks: HTMLElement
  private readonly agree: HTMLElement
  private readonly title: HTMLElement
  private renderedKey = ''
  private open = false
  private side = ''
  private anchorKey = ''

  constructor(private root: HTMLElement, action: Action) {
    this.pool = root.querySelector('#sheetPool')!
    this.picks = root.querySelector('#sheetPicks')!
    this.agree = root.querySelector('#sheetAgree')!
    this.title = root.querySelector('#sheetTitle')!
    root.querySelector('#btnSheetClose')!.addEventListener('click', () => action('toggle-sheet'))
  }

  update(store: Store, hudRect: Rect | null): void {
    const side = `side-${sheetSide(store.prefs.hudCorner)}`
    if (side !== this.side) {
      this.side = side
      this.root.classList.remove('side-left', 'side-right')
      this.root.classList.add(side)
    }
    this.anchor(store, hudRect)
    if (store.sheetOpen !== this.open) {
      this.open = store.sheetOpen
      this.root.classList.toggle('open', this.open)
      this.root.setAttribute('aria-hidden', this.open ? 'false' : 'true')
      // Test hook: present only while open.
      if (this.open) this.root.dataset.testid = 'sheet'
      else delete this.root.dataset.testid
    }
    if (!this.open) return

    const { state } = store
    const key = `${state.seq}:${state.phase}`
    if (key === this.renderedKey) return
    this.renderedKey = key

    this.title.textContent = `Pool · ${state.pool.length}`
    const a = agreement(state.picks)
    this.agree.textContent = a.scored > 0 ? `${a.agreed}/${a.scored} with model${a.rate !== null ? ` · ${Math.round(a.rate * 100)}%` : ''}` : ''
    this.pool.innerHTML = poolHtml(state.pool)
    this.picks.innerHTML = picksHtml(state.picks)
  }

  /**
   * Stack against the HUD on its rail: below it for the top corners, above
   * it for the bottom corners (the HUD keeps priority; the sheet gets the
   * rest of the rail). Without a HUD the sheet spans the rail.
   */
  private anchor(store: Store, hudRect: Rect | null): void {
    const { view } = store
    const corner = store.prefs.hudCorner
    const gap = Math.round(view.height * 0.012)
    const topEdge = Math.round(view.height * 0.13)
    const bottomEdge = Math.round(view.height * 0.02)
    let top = topEdge
    let bottom = bottomEdge
    if (hudRect) {
      if (corner === 'tl' || corner === 'tr') top = Math.round(hudRect.y + hudRect.height + gap)
      else bottom = Math.round(view.height - hudRect.y + gap)
    }
    // Never collapse below a usable height: fall back to the full rail.
    if (view.height - top - bottom < view.height * 0.25) { top = topEdge; bottom = bottomEdge }
    const key = `${top}:${bottom}`
    if (key === this.anchorKey) return
    this.anchorKey = key
    this.root.style.top = `${top}px`
    this.root.style.bottom = `${bottom}px`
  }
}

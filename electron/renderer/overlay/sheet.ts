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
import { gradeTier, gradeOrdinal, poolRating } from '../../shared/grades'
import { agreement, COLOR_NAMES, POOL_COLORS, poolSummary, sheetSide } from './hud-logic'
import { escapeHtml, renderManaCost } from './shared'
import type { HudCorner, Rect, Store } from './types'
import { sheetShouldRender } from './visibility'

type Action = (name: string, data?: unknown) => void

const SHEET_TOP_FRACTION = 0.22
const SHEET_BOTTOM_FRACTION = 0.09

export interface SheetAnchor {
  readonly top: number
  readonly bottom: number
  readonly height: number
}

/**
 * Keep the sheet inside the Arena view. The bottom safe area is a hard floor;
 * long pool/pick content scrolls inside this geometry instead of extending it.
 */
export function sheetAnchor(viewHeight: number, corner: HudCorner, hudRect: Rect | null): SheetAnchor {
  const height = Number.isFinite(viewHeight) ? Math.max(0, viewHeight) : 0
  if (height === 0) return { top: 0, bottom: 0, height: 0 }

  const topEdge = Math.round(height * SHEET_TOP_FRACTION)
  // ceil, rather than round, guarantees at least 9% remains clear.
  const bottomEdge = Math.ceil(height * SHEET_BOTTOM_FRACTION)
  let top = topEdge
  let bottom = bottomEdge
  if (hudRect) {
    if (corner === 'tl' || corner === 'tr') {
      top = Math.min(Math.max(0, Math.round(hudRect.y + hudRect.height)), height - bottom)
    } else {
      bottom = Math.min(Math.max(bottomEdge, Math.round(height - hudRect.y)), height - top)
    }
  }
  return { top, bottom, height: Math.max(0, height - top - bottom) }
}

/** Set-review grade for pool display: the raw set rating (falls back to the pool grade). */
function reviewGrade(card: Pick<CardRow, 'grade' | 'setGrade'>) {
  return card.setGrade ?? card.grade
}

function gradeHtml(card: Pick<CardRow, 'grade' | 'setGrade'>): string {
  const g = reviewGrade(card)
  return g
    ? `<span class="s-grade grade-${gradeTier(g)}">${g}</span>`
    : '<span class="s-grade grade-none">—</span>'
}

/** Basic lands form the final, separately labelled section of the pool. */
function isBasicLand(card: Pick<CardRow, 'type' | 'rarity'>): boolean {
  return /\bbasic land\b/i.test(card.type) || card.rarity.toLowerCase() === 'land'
}

/** Pool sorted best → worst on the set-review ladder (A+ … F), basic lands last, ties by name. */
export function sortPoolByGrade(pool: ReadonlyArray<CardRow>): CardRow[] {
  return [...pool].sort((a, b) => {
    const la = isBasicLand(a) ? 1 : 0, lb = isBasicLand(b) ? 1 : 0
    if (la !== lb) return la - lb
    const ga = reviewGrade(a), gb = reviewGrade(b)
    const oa = ga ? gradeOrdinal(ga) : -1, ob = gb ? gradeOrdinal(gb) : -1
    if (oa !== ob) return ob - oa
    return a.name.localeCompare(b.name)
  })
}

export interface PoolDisplayRow {
  /** Representative copy; identical names share intrinsic display metadata. */
  card: CardRow
  count: number
  pickLabels: string[]
  basicLand: boolean
}

/**
 * Collapse identical names after best→worst sorting, then associate every
 * chronological pick label with the grouped row. grpId is authoritative; the
 * name fallback covers equivalent Arena printings that resolve to one card.
 */
export function poolDisplayRows(
  pool: ReadonlyArray<CardRow>,
  picks: ReadonlyArray<PickRecord> = []
): PoolDisplayRow[] {
  const byName = new Map<string, PoolDisplayRow>()
  const byGrpId = new Map<number, PoolDisplayRow>()
  const rows: PoolDisplayRow[] = []

  for (const card of sortPoolByGrade(pool)) {
    let row = byName.get(card.name)
    if (!row) {
      row = { card, count: 0, pickLabels: [], basicLand: isBasicLand(card) }
      byName.set(card.name, row)
      rows.push(row)
    }
    row.count += 1
    byGrpId.set(card.grpId, row)
  }

  for (const pick of [...picks].sort((a, b) => a.pack - b.pack || a.pick - b.pick)) {
    const row = byGrpId.get(pick.grpId) ?? byName.get(pick.name)
    if (row) row.pickLabels.push(`P${pick.pack}p${pick.pick}`)
  }
  return rows
}

export function poolRatingLabel(pool: ReadonlyArray<CardRow>): { text: string; grade: string | null } {
  const r = poolRating(pool.map(c => ({ grade: reviewGrade(c), rarity: c.rarity, type: c.type })))
  return { text: r.grade ? `${r.grade}` : '—', grade: r.grade }
}

/** Compact W/U/B/R/G card counts for the pool header (lands excluded). */
export function poolColourCountsHtml(pool: ReadonlyArray<Pick<CardRow, 'colors' | 'type'>>): string {
  const counts = poolSummary(pool).counts
  return POOL_COLORS.map(colour => {
    const count = counts[colour]
    return `<span class="sheet-colour-chip ${colour}" data-colour="${colour}" aria-label="${COLOR_NAMES[colour]}: ${count}" title="${COLOR_NAMES[colour]} cards"><i>${colour}</i><b>${count}</b></span>`
  }).join('')
}

export function poolHtml(pool: ReadonlyArray<CardRow>, picks: ReadonlyArray<PickRecord> = []): string {
  if (pool.length === 0) return '<div class="s-empty">No cards yet</div>'
  const rows = poolDisplayRows(pool, picks)
  let landsStarted = false
  return `
    <div class="s-group">
      <h3 class="sheet-h">Cards, best → worst</h3>
      ${rows.map(row => {
        const divider = row.basicLand && !landsStarted
          ? '<h3 class="sheet-h s-land-divider" data-pool-section="lands">Lands</h3>'
          : ''
        landsStarted ||= row.basicLand
        const copies = row.count > 1
          ? `<span class="s-copy-count" aria-label="${row.count} copies">×${row.count}</span>`
          : ''
        const picksText = row.pickLabels.join(' · ')
        const pickLabels = picksText
          ? `<span class="s-pick-labels" aria-label="Picked ${row.pickLabels.join(', ')}">${picksText}</span>`
          : ''
        return `${divider}
        <div class="s-card${row.basicLand ? ' basic-land' : ''}">
          ${gradeHtml(row.card)}
          <span class="s-mana">${renderManaCost(row.card.manaCost)}</span>
          <span class="s-name">${escapeHtml(row.card.name)}</span>
          ${copies}
          ${pickLabels}
        </div>`
      }).join('')}
    </div>`
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
  private readonly rating: HTMLElement
  private readonly colours: HTMLElement
  private renderedKey = ''
  private open = false
  private side = ''
  private stack = ''
  private anchorKey = ''

  constructor(private root: HTMLElement, action: Action) {
    this.pool = root.querySelector('#sheetPool')!
    this.picks = root.querySelector('#sheetPicks')!
    this.agree = root.querySelector('#sheetAgree')!
    this.title = root.querySelector('#sheetTitle')!
    this.rating = root.querySelector('#sheetRating')!
    this.colours = root.querySelector('#sheetColours')!
    root.querySelector('#btnSheetClose')!.addEventListener('click', () => action('toggle-sheet'))
  }

  update(store: Store, hudRect: Rect | null): void {
    const side = `side-${sheetSide(store.prefs.hudCorner)}`
    if (side !== this.side) {
      this.side = side
      this.root.classList.remove('side-left', 'side-right')
      this.root.classList.add(side)
    }
    const stack = store.prefs.hudCorner === 'tl' || store.prefs.hudCorner === 'tr' ? 'stack-below' : 'stack-above'
    if (stack !== this.stack) {
      this.stack = stack
      this.root.classList.remove('stack-below', 'stack-above')
      this.root.classList.add(stack)
    }
    this.anchor(store, hudRect)
    const shouldOpen = sheetShouldRender(store.state.phase, store.sheetOpen)
    if (shouldOpen !== this.open) {
      this.open = shouldOpen
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
    const rating = poolRatingLabel(state.pool)
    this.rating.textContent = `Pool rating ${rating.text}`
    this.rating.className = `sheet-rating ${rating.grade ? `grade-${gradeTier(rating.grade as never)}` : 'grade-none'}`
    this.colours.innerHTML = poolColourCountsHtml(state.pool)
    const a = agreement(state.picks)
    this.agree.textContent = a.scored > 0 ? `${a.agreed}/${a.scored} with model${a.rate !== null ? ` · ${Math.round(a.rate * 100)}%` : ''}` : ''
    this.pool.innerHTML = poolHtml(state.pool, state.picks)
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
    const { top, bottom } = sheetAnchor(view.height, corner, hudRect)
    const key = `${top}:${bottom}`
    if (key === this.anchorKey) return
    this.anchorKey = key
    this.root.style.top = `${top}px`
    this.root.style.bottom = `${bottom}px`
  }
}

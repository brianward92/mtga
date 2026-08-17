/**
 * The sidebar's internally scrolling pool list. Identical cards collapse to
 * one best-to-worst row with every pick label; basic lands stay last.
 *
 * Active and complete drafts pin this content open. The legacy sheet toggle
 * may still change main-process preference state, but never exposes Arena's
 * owned right column or removes the pool from the sidebar.
 */
import type { CardRow, PickRecord } from '../../shared/state'
import { gradeTier, gradeOrdinal, poolRating } from '../../shared/grades'
import { COLOR_NAMES, POOL_COLORS, poolSummary } from './hud-logic'
import { escapeHtml, renderManaCost } from './shared'
import type { Store } from './types'
import { sheetShouldRender } from './visibility'
import {
  BASIC_LAND_NAMES, buildDeck, type CardStatus, type DeckEntry, type DeckPlan
} from './deckbuild'

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
function isBasicLandCard(card: Pick<CardRow, 'type' | 'rarity'>): boolean {
  return /\bbasic land\b/i.test(card.type) || card.rarity.toLowerCase() === 'land'
}

/** Pool sorted best → worst on the set-review ladder (A+ … F), basic lands last, ties by name. */
function sortPoolByGrade(pool: ReadonlyArray<CardRow>): CardRow[] {
  return [...pool].sort((a, b) => {
    const la = isBasicLandCard(a) ? 1 : 0, lb = isBasicLandCard(b) ? 1 : 0
    if (la !== lb) return la - lb
    const ga = reviewGrade(a), gb = reviewGrade(b)
    const oa = ga ? gradeOrdinal(ga) : -1, ob = gb ? gradeOrdinal(gb) : -1
    if (oa !== ob) return ob - oa
    return a.name.localeCompare(b.name)
  })
}

interface PoolDisplayRow {
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
      row = { card, count: 0, pickLabels: [], basicLand: isBasicLandCard(card) }
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

function poolRatingLabel(pool: ReadonlyArray<CardRow>): { text: string; grade: string | null } {
  const r = poolRating(pool.map(c => ({ grade: reviewGrade(c), rarity: c.rarity, type: c.type })))
  return { text: r.grade ? `${r.grade}` : '—', grade: r.grade }
}

/** Compact W/U/B/R/G card counts for the pool header (lands excluded). */
export function poolColorCountsHtml(pool: ReadonlyArray<Pick<CardRow, 'colors' | 'type'>>): string {
  const counts = poolSummary(pool).counts
  return POOL_COLORS.map(color => {
    const count = counts[color]
    return `<span class="sheet-colour-chip ${color}" data-colour="${color}" aria-label="${COLOR_NAMES[color]}: ${count}" title="${COLOR_NAMES[color]} cards"><i>${color}</i><b>${count}</b></span>`
  }).join('')
}

/**
 * Where a pool row landed in the proposed deck. Shown only after the draft,
 * when a plan exists — during the draft the pool list stays as it was.
 */
function statusHtml(status: CardStatus | undefined): string {
  if (!status) return ''
  if (status.included >= status.total) return '<span class="s-in" title="In the proposed deck">in</span>'
  if (status.included > 0) {
    return `<span class="s-in partial" title="${status.included} of ${status.total} copies in the deck">${status.included}/${status.total}</span>`
  }
  if (status.close) return '<span class="s-close" title="Just missed the last slot">close</span>'
  return '<span class="s-out" title="Not in the proposed deck">cut</span>'
}

/** Render the grouped best-to-worst pool rows and optional lands section. */
export function poolHtml(
  pool: ReadonlyArray<CardRow>,
  picks: ReadonlyArray<PickRecord> = [],
  statusByName: Record<string, CardStatus> | null = null
): string {
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
        const status = row.basicLand ? '' : statusHtml(statusByName?.[row.card.name])
        return `${divider}
        <div class="s-card${row.basicLand ? ' basic-land' : ''}">
          ${gradeHtml(row.card)}
          <span class="s-mana">${renderManaCost(row.card.manaCost)}</span>
          <span class="s-name">${escapeHtml(row.card.name)}</span>
          ${copies}
          ${status}
          ${pickLabels}
        </div>`
      }).join('')}
    </div>`
}

function deckLine(entry: DeckEntry): string {
  const grade = entry.grade
    ? `<span class="s-grade grade-${gradeTier(entry.grade)}">${entry.grade}</span>`
    : '<span class="s-grade grade-none">—</span>'
  // Deliberately not .s-card: that class means "a row of the drafted pool",
  // and counting deck lines as pool rows would misreport the pool's size.
  return `
    <div class="d-line">
      ${grade}
      <span class="d-count">${entry.count}×</span>
      <span class="s-mana">${renderManaCost(entry.manaCost)}</span>
      <span class="s-name">${escapeHtml(entry.name)}</span>
    </div>`
}

/**
 * The deckbuild panel shown once the draft is over: the verdict first (lane and
 * dead colours, readable at a glance), then the proposed 40.
 */
export function deckHtml(plan: DeckPlan): string {
  if (plan.lane.length === 0) return ''
  const cut = plan.cut.length
    ? `cut ${plan.cut.map(c => `${c.color} ${c.count}`).join(' · ')}`
    : 'nothing off-colour'
  const lands = [
    ...plan.basics.map(b => `${b.count} ${BASIC_LAND_NAMES[b.color]}`),
    ...plan.nonbasicLands.map(l => `${l.count} ${l.name}`)
  ].join(' · ')
  const close = plan.close.length
    ? `<div class="deck-close">Closest cuts: ${plan.close.map(c => escapeHtml(c.name)).join(' · ')}</div>`
    : ''
  const short = plan.short
    ? `<div class="deck-short">Only ${plan.playable} playables on colour — the deck is ${plan.spellCount} spells, not 23.</div>`
    : ''
  return `
    <div class="s-group deck-plan" data-testid="deck-plan">
      <h3 class="sheet-h">Proposed deck</h3>
      <div class="deck-verdict">
        <span class="deck-lane lane-${plan.lane.join('')}">${plan.laneLabel}</span>
        <span class="deck-cut">${cut}</span>
      </div>
      <div class="deck-meta">${plan.spellCount} spells · ${plan.landCount} lands · ${plan.total} cards · ${plan.playable} playable</div>
      ${short}
      ${plan.spells.map(deckLine).join('')}
      <div class="deck-lands">${escapeHtml(lands)}</div>
      ${close}
      <div class="deck-note">Order is the model's. Deck size, land split and the splash rule are ours.</div>
    </div>`
}

/** Render pick history newest-first with agreement and recommendation tags. */
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

/** Updates the pinned, internally scrolling pool content in the sidebar. */
export class Sheet {
  private readonly pool: HTMLElement
  private renderedKey = ''
  private open = false

  constructor(private root: HTMLElement, private readonly rating: HTMLElement) {
    this.pool = root.querySelector('#sheetPool')!
  }

  update(store: Store): void {
    const shouldOpen = store.prefs.hud && !store.calibrate.active && sheetShouldRender(store.state.phase, store.sheetOpen)
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

    const rating = poolRatingLabel(state.pool)
    this.rating.textContent = state.pool.length === 0 ? '' : `Pool rating ${rating.text}`
    this.rating.className = `sheet-rating ${rating.grade ? `grade-${gradeTier(rating.grade as never)}` : 'grade-none'}`
    // The draft is over: lead with the deckbuild plan, and tag the pool rows
    // with where each card landed in it.
    const plan = state.phase === 'complete' && state.pool.length > 0 ? buildDeck(state.pool) : null
    this.pool.innerHTML = (plan ? deckHtml(plan) : '') + poolHtml(state.pool, state.picks, plan?.statusByName ?? null)
  }
}

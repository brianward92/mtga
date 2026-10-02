/**
 * The sidebar's internally scrolling pool list. Identical cards collapse to
 * one best-to-worst row with every pick label; basic lands stay last.
 *
 * Active and complete drafts pin this content open. The legacy sheet toggle
 * may still change main-process preference state, but never exposes Arena's
 * owned right column or removes the pool from the sidebar.
 */
import type { CardRow, PickRecord, DeckEditingState } from '../../shared/state'
import { gradeTier, gradeOrdinal, poolRating } from '../../shared/grades'
import { isBasicLand as isBasicLandCard } from '../../shared/cards'
import { COLOR_NAMES, POOL_COLORS, poolSummary } from './hud-logic'
import { escapeHtml, renderManaCost } from './shared'
import type { Store } from './types'
import { recommendDraftBuilds } from '../../shared/draft-builds'
import { arenaDeckText, isSealed, recommendSealed, type SealedRecommendation } from '../../shared/sealed'
import { deckGuide, guideOrder, type DeckCounts, type GuideRow } from '../../shared/deck-guide'
import { sheetShouldRender } from './visibility'
import { bundleProvenance } from './model-tag'
import {
  BASIC_LAND_NAMES, type CardStatus, type DeckEntry, type DeckPlan
} from '../../shared/deck-plan'

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
export type DeckObservation = DeckEditingState
export type GuideTab = 'add' | 'cut'

function guideGroup(row: GuideRow): string {
  if (row.land) return 'Lands'
  const colors = POOL_COLORS.filter(c => row.colors.includes(c))
  return colors.length > 1 ? 'Multicolor' : colors.length === 1 ? COLOR_NAMES[colors[0]] : 'Colorless'
}

function guideRowHtml(row: GuideRow, action: 'add' | 'cut' | 'done'): string {
  const name = escapeHtml(row.name)
  const delta = action === 'done' ? '✓' : `${action === 'add' ? '+' : '−'}${row.remaining}`
  const current = action === 'done' ? Math.min(row.current, row.target) : row.current
  return `<div class="guide-row ${action}" data-guide-card="${name}" title="${name}: ${row.current} in Arena, ${row.target} suggested">
    <span class="guide-delta" aria-label="${action === 'done' ? 'In place' : `${action} ${row.remaining}`}">${delta}</span>
    <span class="guide-name">${name}</span>
    <span class="guide-count" aria-label="${current} of ${row.target} copies in deck">${current}<span>/</span>${row.target}</span>
    <span class="guide-mana">${renderManaCost(row.manaCost)}</span>
  </div>`
}

function guideGroupsHtml(rows: GuideRow[], action: 'add' | 'cut' | 'done'): string {
  let previous = ''
  return rows.map(row => {
    const label = guideGroup(row)
    const group = label !== previous ? `<h4 class="guide-group" data-guide-group="${label}"><span class="guide-color ${row.land ? 'land' : row.colors}"></span>${label}</h4>` : ''
    previous = label
    return group + guideRowHtml(row, action)
  }).join('')
}

/** A live diff against the selected build. Counts only come from observed Arena state. */
export function guideHtml(plan: DeckPlan, pool: readonly CardRow[], counts: DeckCounts, observation?: DeckObservation, selectedTab?: GuideTab): string {
  const guide = deckGuide(plan, pool, counts)
  const adds = guide.add.reduce((n, r) => n + r.remaining, 0)
  const cuts = guide.cut.reduce((n, r) => n + r.remaining, 0)
  const matched = [...guide.add, ...guide.cut, ...guide.done].reduce((n, r) => n + Math.min(r.current, r.target), 0)
  const verified = observation?.status === 'live' || observation?.status === 'saved'
  const complete = verified && !adds && !cuts && observation?.total === plan.total
  const status = observation?.status ?? 'scanning'
  const actual = observation?.total ?? null
  const tab = selectedTab ?? (adds ? 'add' : cuts ? 'cut' : 'add')
  const syncLabel = status === 'live' ? 'Following Arena' : status === 'saved' ? 'Saved deck' : status === 'permission' ? 'Screen access needed' : status === 'uncertain' ? 'Sync needed' : 'Reading Arena…'
  const fallback = status === 'live' ? 'Click cards in Arena. This list updates automatically.' : status === 'saved' ? 'Open the deck to follow your next edits.' : status === 'permission' ? 'Allow Screen Recording for MTGA Draft Assistant in System Settings.' : 'Switch Arena to list view and scroll through the deck to sync.'
  const instruction = observation?.message || fallback
  const matchedLabel = verified ? `${matched}/${plan.total} matched` : observation?.observedAt ? `${matched}/${plan.total} last read` : 'Waiting for deck'
  const inPlace = [...guide.add, ...guide.cut, ...guide.done].filter(r => r.current > 0 && r.target > 0).sort(guideOrder)
  return `<section class="deck-guide" data-testid="deck-guide" data-sync-status="${status}">
    <div class="guide-overview"><div class="guide-heading"><div class="guide-build"><span class="deck-lane">${escapeHtml(plan.laneLabel)}</span><span class="guide-build-label">Suggested deck</span></div><span class="guide-arena-count">${actual === null ? '—' : actual}<small> in Arena</small></span></div>
    <div class="guide-progress-label"><strong>${complete ? 'Deck matches ✓' : matchedLabel}</strong><span>${plan.spellCount} spells · ${plan.landCount} lands</span></div>
    <div class="guide-progress${complete ? ' complete' : ''}" role="progressbar" aria-label="Suggested cards in place" aria-valuemin="0" aria-valuemax="${plan.total}" aria-valuenow="${matched}"><span style="width:${plan.total ? Math.min(100, 100 * matched / plan.total) : 0}%"></span></div>
    <div class="guide-sync ${verified ? 'verified' : 'pending'}" title="${escapeHtml(instruction)}"><span class="guide-sync-dot" aria-hidden="true"></span><strong>${syncLabel}</strong><span class="guide-sync-instruction">${escapeHtml(instruction)}</span></div>
    <div class="guide-tabs" role="tablist" aria-label="Changes to make in Arena">
      <button type="button" role="tab" id="guide-tab-add" data-guide-tab="add" aria-controls="guide-panel-add" aria-selected="${tab === 'add'}">Add <b>${adds}</b></button>
      <button type="button" role="tab" id="guide-tab-cut" data-guide-tab="cut" aria-controls="guide-panel-cut" aria-selected="${tab === 'cut'}">Cut <b>${cuts}</b></button>
    </div>
    </div><div class="guide-actions" role="tabpanel" id="guide-panel-add" aria-labelledby="guide-tab-add"${tab !== 'add' ? ' hidden' : ''}>${guideGroupsHtml(guide.add, 'add') || `<div class="guide-empty"><span>✓</span><strong>Nothing to add</strong><p>${cuts ? `Open Cut to remove ${cuts} extra ${cuts === 1 ? 'card' : 'cards'}.` : complete ? 'Your deck matches the suggestion.' : 'Waiting to verify the deck in Arena.'}</p></div>`}</div>
    <div class="guide-actions" role="tabpanel" id="guide-panel-cut" aria-labelledby="guide-tab-cut"${tab !== 'cut' ? ' hidden' : ''}>${guideGroupsHtml(guide.cut, 'cut') || `<div class="guide-empty"><span>✓</span><strong>Nothing to cut</strong><p>${adds ? `Open Add for ${adds} missing ${adds === 1 ? 'card' : 'cards'}.` : complete ? 'Your deck matches the suggestion.' : 'Waiting to verify the deck in Arena.'}</p></div>`}</div>
    <details class="guide-in-place" data-detail-key="in-place"><summary>In place <span>${matched}</span></summary>${guideGroupsHtml(inPlace, 'done') || '<p class="deck-meta">Matching copies appear here as you add them.</p>'}</details>
  </section>`
}

export function deckHtml(plan: DeckPlan, sealed = false, guide = ''): string {
  if (plan.lane.length === 0) return ''
  if (guide) return `<div class="deck-plan guided-plan" data-testid="deck-plan">${guide}${plan.short ? '<p class="deck-short">This pool does not have enough rated playables for a full suggested deck.</p>' : ''}</div>`
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
      ${guide || plan.spells.map(deckLine).join('')}
      <div class="deck-lands">${escapeHtml(lands)}</div>
      ${close}
      <div class="deck-note">${sealed ? 'Model-assisted suggestion, not a win-rate prediction. Uses draft card ratings and creature/curve balance. 17 basic lands; splashes and nonbasic fixing are left for your review.' : "Order is the model's; deck size, land split and splash rules are ours."}</div>
    </div>`
}

export function sealedHtml(result: SealedRecommendation, selected = 0, guide = '', draft = false): string {
  const build = result.builds[selected]
  const omitted = result.unscored || result.unsupportedMana
    ? `<p class="deck-short">Excluded: ${result.unscored} cards without ratings or complete metadata; ${result.unsupportedMana} cards requiring unsupported mana. Review these in your pool.</p>` : ''
  if (!build) return `<div class="s-group"><h3 class="sheet-h">${draft ? 'Draft' : 'Sealed'} deck suggestions</h3><p>No scored build available for this pool.</p>${omitted}</div>`
  const comparison = `<details class="sealed-options guide-detail" data-detail-key="builds" data-testid="sealed-options"><summary>Compare builds <span>${result.builds.length} options</span></summary>
    <div class="sealed-choices">${result.builds.map((b, i) => `<button type="button" data-sealed-build="${i}" aria-pressed="${i === selected}">${i === 0 ? 'Recommended' : draft ? `${b.plan.lane.length} colors` : `Alternative ${i}`} · ${b.plan.laneLabel}</button>`).join('')}</div>
    <p class="deck-meta">${build.creatures} creatures · ${build.early} spells costing 3 or less · ${build.expensive} costing 5+</p>
    <p class="deck-meta">${draft ? 'Compares one through five colors using card ratings, creature count, curve and land-source shortfalls.' : 'Compares all ten color pairs by card ratings, creature count and curve.'}</p>
    ${omitted}
    <button type="button" data-sealed-copy ${build.plan.short ? 'disabled' : ''}>Copy Arena deck</button>
    <span class="deck-meta" data-copy-status role="status"></span>
    <p class="deck-note">${draft ? 'Mana estimates count basic lands and printed land sources. Review conditional lands and fixing spells before committing to extra colors.' : 'Ratings, creature count and curve guide the suggestion. Review splashes and nonbasic fixing.'}</p>
  </details>`
  return `${deckHtml(build.plan, !draft, guide)}${comparison}`
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
  private selected = 0
  private sealedKey = ''
  private sealedResult: SealedRecommendation | null = null
  private lastStore: Store | null = null
  private sessionKey = ''
  private tab: GuideTab | undefined

  constructor(private root: HTMLElement, private readonly rating: HTMLElement) {
    this.pool = root.querySelector('#sheetPool')!
    this.pool.addEventListener('click', async event => {
      const button = (event.target as HTMLElement).closest('button')
      if (!button) return
      if (button.dataset.guideTab === 'add' || button.dataset.guideTab === 'cut') {
        this.tab = button.dataset.guideTab
        window.overlay?.action('set-deckbuilding-side', { side: this.tab === 'add' ? 'right' : 'left' })
        this.renderedKey = ''
        if (this.lastStore) this.update(this.lastStore)
        this.pool.querySelector<HTMLButtonElement>(`[data-guide-tab="${this.tab}"]`)?.focus({ preventScroll: true })
        return
      }
      if (!this.sealedResult) return
      if (button.dataset.sealedBuild !== undefined) {
        const selected = Number(button.dataset.sealedBuild)
        if (!this.sealedResult.builds[selected]) return
        this.selected = selected
        this.renderedKey = ''
        if (this.lastStore) this.update(this.lastStore)
      } else if (button.hasAttribute('data-sealed-copy')) {
        const plan = this.sealedResult.builds[this.selected]?.plan
        if (!plan) return
        const status = this.pool.querySelector('[data-copy-status]')
        try {
          const ok = await window.overlay.copyDeck(arenaDeckText(plan))
          if (status) status.textContent = ok ? 'Copied — import in Arena’s Decks screen.' : 'Unable to copy deck.'
        } catch { if (status) status.textContent = 'Unable to copy deck.' }
      }
    })
  }

  /** Keep your reading position and open details when an Arena click changes counts. */
  private paint(html: string): void {
    const scroller = this.root.querySelector<HTMLElement>('.sheet-body')
    const scrollTop = scroller?.scrollTop ?? 0
    const openDetails = new Set(Array.from(this.pool.querySelectorAll?.<HTMLDetailsElement>('details[open][data-detail-key]') ?? []).map(el => el.dataset.detailKey))
    const oldRows = Array.from(this.pool.querySelectorAll?.<HTMLElement>('.guide-actions:not([hidden]) [data-guide-card]') ?? [])
    const scrollEdge = this.pool.querySelector<HTMLElement>('.guide-overview')?.getBoundingClientRect().bottom ?? scroller?.getBoundingClientRect().top ?? 0
    const anchors = oldRows.filter(el => el.getBoundingClientRect().bottom > scrollEdge).map(el => ({ name: el.dataset.guideCard, top: el.getBoundingClientRect().top }))
    this.pool.innerHTML = html
    this.pool.querySelectorAll?.<HTMLDetailsElement>('details[data-detail-key]').forEach(el => { el.open = openDetails.has(el.dataset.detailKey) })
    if (scroller) {
      scroller.scrollTop = scrollTop
      // A removed first row yields to the next visible card, without jumping to the top.
      if (scrollTop > 0) {
        const rows = Array.from(this.pool.querySelectorAll<HTMLElement>('.guide-actions:not([hidden]) [data-guide-card]'))
        for (const anchor of anchors) {
          const row = rows.find(el => el.dataset.guideCard === anchor.name)
          if (row) { scroller.scrollTop += row.getBoundingClientRect().top - anchor.top; break }
        }
      }
    }
  }

  update(store: Store): void {
    this.lastStore = store
    const shouldOpen = store.prefs.hud && !store.calibrate.active && sheetShouldRender(store.state.phase, store.sheetOpen)
    if (shouldOpen !== this.open) {
      this.open = shouldOpen
      this.root.classList.toggle('open', this.open)
      this.root.setAttribute('aria-hidden', this.open ? 'false' : 'true')
      if (this.open) this.root.dataset.testid = 'sheet'
      else delete this.root.dataset.testid
    }
    if (!this.open) return

    const { state } = store
    const observation = state.deckEditing
    // OCR timestamps advance even when nothing visible changed. Keep the same
    // nodes in that case so a click, hover or keyboard focus is not interrupted.
    const key = state.phase === 'complete'
      ? JSON.stringify([state.phase, state.eventName, state.model.state, state.pool.map(c => [c.grpId, c.setPercentile, c.percentile]), this.selected, this.tab,
          observation?.counts, observation?.total, observation?.status, observation?.message, !!observation?.observedAt])
      : `${state.seq}:${state.phase}`
    if (key === this.renderedKey) return
    this.renderedKey = key
    const session = `${state.eventName}:${state.pool.map(c => c.grpId).sort((a, b) => a - b).join('.')}`
    if (session !== this.sessionKey) {
      this.sessionKey = session
      this.tab = undefined
    }
    const counts = observation?.counts ?? {}
    const rating = poolRatingLabel(state.pool)
    this.rating.textContent = state.pool.length === 0 ? '' : `Pool rating ${rating.text}`
    this.rating.className = `sheet-rating ${rating.grade ? `grade-${gradeTier(rating.grade as never)}` : 'grade-none'}`
    if (state.phase === 'complete') {
      const draft = !isSealed(state.format, state.eventName)
      const sealedKey = JSON.stringify([state.eventName, state.pool.map(c => [c.grpId, c.setPercentile, c.percentile])])
      if (sealedKey !== this.sealedKey) {
        this.sealedKey = sealedKey
        this.selected = 0
        this.sealedResult = draft ? recommendDraftBuilds(state.pool) : recommendSealed(state.pool)
      }
      const ready = state.model.state === 'ready'
      const plan = ready ? this.sealedResult?.builds[this.selected]?.plan : null
      if (plan && !this.tab) this.tab = deckGuide(plan, state.pool, counts).add.length ? 'add' : 'cut'
      this.paint((ready && this.sealedResult ? sealedHtml(this.sealedResult, this.selected, plan ? guideHtml(plan, state.pool, counts, observation, this.tab) : '', draft)
        : '<div class="s-group"><h3 class="sheet-h">Preparing suggested deck</h3><p class="deck-meta">Waiting for card ratings…</p></div>')
        + `<details class="guide-pool guide-detail" data-detail-key="pool"><summary>Full pool <span>${state.pool.length} cards</span></summary>${poolHtml(state.pool, draft ? state.picks : [], plan?.statusByName ?? null)}</details>`
        + this.provenance(store))
    } else {
      this.sealedKey = ''; this.sealedResult = null
      this.paint(poolHtml(state.pool, state.picks))
    }
  }

  private provenance(store: Store): string {
    const { state } = store
    return `<details class="guide-detail" data-detail-key="about"><summary>About this suggestion</summary><p class="deck-meta">${escapeHtml(bundleProvenance(state.snapshot) || 'DraftFM card ratings')}</p><p class="deck-meta">${state.pool.length} pool cards · ${escapeHtml(this.rating.textContent ?? '')}</p><p class="deck-note">Browse W → U → B → R → G, then multicolor, colorless and lands. Within each color, cards follow mana value and title. Counts update from Arena; the suggestion stays fixed while you build.</p></details>`
  }
}

/**
 * Context HUD: a compact glass card in a corner. Draft: header (set·format,
 * P#P#, progress dots, model chip), the recommendation (or the hovered
 * card's detail), the ranked table (#1–#5), pool colour bar + lane lean, footer buttons.
 * Idle: a tiny, fixed top-right glyph. Complete: agreement summary + Dismiss.
 * Skeleton lives in index.html; this updates it in place.
 */
import type { CardRow, Grade, HudCorner } from '../../shared/state'
import type { Rect } from '../../shared/layout'
import { arenaDisplayOrder } from '../../shared/display-order'
import { gradeTier } from '../../shared/grades'
import { flamesFromPercentile } from './flames'
import { scryfallImageUrl } from './card-art'
import { bundleProvenance, modelDisplayName } from './model-tag'
import { shortBandLabel } from './chips'
import { buildWhy } from './why'
import { renderManaCost, escapeHtml } from './shared'
import { hudCornerForPhase, sheetShouldRender } from './visibility'
import {
  agreement, bestPick, detailLine, eventTitle, laneLean, packConviction,
  pickPosition, POOL_COLORS, poolSummary, progressDots, rankedCards, rankedRows
} from './hud-logic'
import type { OverlayAction, Store } from './types'

function $(root: HTMLElement, id: string): HTMLElement {
  const el = root.querySelector<HTMLElement>(`#${id}`)
  if (!el) throw new Error(`HUD: missing #${id}`)
  return el
}

function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text
}

function gradeClass(grade: Grade | null): string {
  return grade ? `grade-${gradeTier(grade)}` : 'grade-none'
}

/** Updates the persistent HUD skeleton without replacing its DOM nodes. */
export class Hud {
  private readonly idle: HTMLElement
  private readonly main: HTMLElement
  private readonly warning: HTMLElement
  private readonly title: HTMLElement
  private readonly pos: HTMLElement
  private readonly dots: HTMLElement
  private readonly dotNodes: HTMLSpanElement[] = []
  private readonly model: HTMLElement
  private readonly modelMsg: HTMLElement
  private readonly rec: HTMLElement
  private readonly recImage: HTMLImageElement
  private readonly recGrade: HTMLElement
  private readonly recSetGrade: HTMLElement
  private readonly recMeta: HTMLElement
  private recMetaKey = ''
  private readonly recName: HTMLElement
  private readonly recHovering: HTMLElement
  private readonly recFlames: HTMLElement
  private readonly flameNodes: HTMLSpanElement[] = []
  private readonly recBand: HTMLElement
  private readonly recRank: HTMLElement
  private readonly recWhy: HTMLElement
  private readonly runners: HTMLElement
  private readonly runnerNodes: Array<{ row: HTMLElement; name: HTMLElement; grade: HTMLElement; setGrade: HTMLElement; pct: HTMLElement }> = []
  private readonly pool: HTMLElement
  private readonly poolSegs: Record<string, HTMLElement> = {}
  private readonly poolCounts: Record<string, HTMLElement> = {}
  private readonly poolTotal: HTMLElement
  private readonly lane: HTMLElement
  private readonly done: HTMLElement
  private readonly doneAgree: HTMLElement
  private readonly doneBest: HTMLElement
  private readonly btnBadges: HTMLElement
  private readonly attrib: HTMLElement
  private artUrl: string | null = null
  private readonly failedArt = new Set<string>()

  private corner: HudCorner = 'tr'
  private lastRect: Rect | null = null
  private lastRectKey = 'init'
  private rootClass = ''

  constructor(private root: HTMLElement, private action: OverlayAction) {
    const rail = root.closest<HTMLElement>('.draft-rail') ?? root
    this.idle = $(root, 'hudIdle')
    this.main = $(root, 'hudMain')
    this.warning = $(root, 'hudWarning')
    this.title = $(root, 'hudTitle')
    this.pos = $(root, 'hudPos')
    this.dots = $(root, 'hudDots')
    this.model = $(root, 'hudModel')
    this.modelMsg = $(root, 'hudModelMsg')
    this.rec = $(root, 'hudRec')
    this.recImage = $(root, 'recImage') as HTMLImageElement
    this.recGrade = $(root, 'recGrade')
    this.recSetGrade = $(root, 'recSetGrade')
    this.recMeta = $(root, 'recMeta')
    this.recName = $(root, 'recName')
    this.recHovering = $(root, 'recHovering')
    this.recFlames = $(root, 'recFlames')
    this.recBand = $(root, 'recBand')
    this.recRank = $(root, 'recRank')
    this.recWhy = $(root, 'recWhy')
    this.runners = $(root, 'hudRunners')
    this.pool = $(root, 'hudPool')
    this.poolTotal = $(root, 'poolTotal')
    this.lane = $(root, 'hudLane')
    this.done = $(root, 'hudDone')
    this.doneAgree = $(root, 'doneAgree')
    this.doneBest = $(root, 'doneBest')
    this.btnBadges = $(rail, 'btnBadges')
    this.attrib = $(rail, 'hudAttrib')

    this.recImage.addEventListener('load', () => {
      if (this.recImage.src !== this.artUrl) return
      this.recImage.classList.add('loaded')
    })
    this.recImage.addEventListener('error', () => {
      if (!this.artUrl) return
      this.failedArt.add(this.artUrl)
      this.recImage.classList.remove('loaded')
    })

    for (let i = 0; i < 5; i++) {
      const s = document.createElement('span')
      s.className = 'hud-flame'
      s.textContent = '🔥'
      this.recFlames.appendChild(s)
      this.flameNodes.push(s)
    }
    this.runners.querySelectorAll<HTMLElement>('.hud-runner').forEach(row => {
      this.runnerNodes.push({
        row,
        name: row.querySelector('.hud-runner-name')!,
        grade: row.querySelector('.hud-runner-grade')!,
        setGrade: row.querySelector('.hud-runner-setgrade')!,
        pct: row.querySelector('.hud-runner-pct')!
      })
    })
    for (const c of [...POOL_COLORS, 'C']) {
      this.poolSegs[c] = $(root, 'poolBar').querySelector<HTMLElement>(`.seg.${c}`)!
      this.poolCounts[c] = $(root, 'poolCounts').querySelector<HTMLElement>(`.pc.${c}`)!
    }

    this.btnBadges.addEventListener('click', () => this.action('toggle-badges'))
    $(rail, 'btnCalibrate').addEventListener('click', () => this.action('calibrate-start'))
    $(root, 'btnDismiss').addEventListener('click', () => this.action('dismiss'))
  }

  update(store: Store): void {
    const { state, prefs } = store
    const idle = state.phase === 'idle'
    this.corner = hudCornerForPhase(state.phase, prefs.hudCorner)

    // The idle pill has nothing to click: stay click-through so Arena's own
    // UI underneath keeps working.
    const classes = ['hud', `hud-${this.corner}`]
    if (!idle) classes.push('interactive')
    if (!prefs.hud) classes.push('hidden')
    if (idle) classes.push('idle', 'idle-min')
    if (state.phase === 'complete') classes.push('complete')
    if (state.scoring) classes.push('scoring')
    // Active/complete content belongs to the fixed sidebar, independent of
    // the legacy sheet-open preference.
    if (sheetShouldRender(state.phase, store.sheetOpen)) {
      classes.push('with-sheet', 'sheet-below')
    }
    const rootClass = classes.join(' ')
    if (rootClass !== this.rootClass) { this.rootClass = rootClass; this.root.className = rootClass }

    // Idle stays glyph-only; surface setup warnings once a draft view is live.
    this.warning.hidden = idle || !state.warning
    setText(this.warning, state.warning ?? '')

    this.idle.hidden = !idle
    this.main.hidden = idle
    if (idle) return

    // Header
    setText(this.title, eventTitle(state))
    setText(this.pos, pickPosition(state))
    this.updateDots(store)
    setText(this.model, modelDisplayName(state.model.modelId))
    this.model.title = state.model.modelId ?? ''
    this.model.classList.toggle('off', state.model.state !== 'ready')
    const modelMsg = state.model.state !== 'ready' ? (state.model.message ?? `model ${state.model.state}`) : ''
    this.modelMsg.hidden = false
    this.modelMsg.classList.toggle('empty', modelMsg === '')
    this.modelMsg.title = modelMsg
    setText(this.modelMsg, modelMsg)

    // Body
    const active = state.phase === 'active'
    const complete = state.phase === 'complete'
    this.rec.hidden = !active
    this.runners.hidden = !active
    this.done.hidden = !complete
    if (active) this.updateRecommendation(store)
    if (complete) this.updateComplete(store)
    this.updatePool(store)

    // Footer
    this.btnBadges.classList.toggle('off', !prefs.badges)
    // Bundle provenance: model tag · Scryfall snapshot.
    const prov = bundleProvenance(state.snapshot)
    if (this.attrib.textContent !== prov) this.attrib.textContent = prov
    this.attrib.hidden = !prov
  }

  /** After a render: tell main where the HUD is (layer awareness lifts it). Reads layout once. */
  reportRect(send: (rect: Rect | null) => void): Rect | null {
    // display:none (hidden pref, calibrating) measures 0×0 → null.
    const r = this.root.getBoundingClientRect()
    const rect: Rect | null = r.width > 0 && r.height > 0 ? { x: r.left, y: r.top, width: r.width, height: r.height } : null
    const key = rect ? `${Math.round(rect.x)},${Math.round(rect.y)},${Math.round(rect.width)},${Math.round(rect.height)}` : 'null'
    if (key !== this.lastRectKey) {
      this.lastRectKey = key
      this.lastRect = rect
      send(rect)
    }
    return this.lastRect
  }

  // ---- pieces --------------------------------------------------------------

  private updateDots(store: Store): void {
    const dots = progressDots(store.state)
    while (this.dotNodes.length < dots.length) {
      const s = document.createElement('span')
      s.className = 'dot'
      this.dots.appendChild(s)
      this.dotNodes.push(s)
    }
    this.dotNodes.forEach((s, i) => {
      const st = dots[i]
      s.hidden = st === undefined
      if (st) { const cls = `dot ${st}`; if (s.className !== cls) s.className = cls }
    })
  }

  private hoveredCard(store: Store): CardRow | null {
    if (store.hoverCell < 0) return null
    const order = arenaDisplayOrder(store.state.cards)
    const idx = order[store.hoverCell]
    return idx === undefined ? null : store.state.cards[idx] ?? null
  }

  private updateRecommendation(store: Store): void {
    const { state } = store
    const ranked = rankedCards(state.cards)
    const hovered = this.hoveredCard(store)
    const card = hovered ?? ranked[0] ?? null
    this.rec.classList.toggle('hover', hovered !== null)
    this.recHovering.hidden = hovered === null

    if (!card) {
      this.paintArt(null)
      this.paintGrade(null)
      setText(this.recName, 'Waiting for pack…')
      this.paintFlames(null)
      setText(this.recBand, '')
      setText(this.recRank, '')
      setText(this.recWhy, '')
      if (this.recMetaKey !== '') { this.recMetaKey = ''; this.recMeta.innerHTML = '' }
      this.paintRanked(store)
      return
    }

    const conviction = state.scoring ? null : packConviction(state.cards)
    this.paintArt(card)
    this.paintGrade(card.grade, card.setGrade)
    setText(this.recName, card.name)
    this.paintMeta(card)

    if (hovered) {
      const rating = card.percentile !== null ? flamesFromPercentile(card.percentile * 100) : null
      this.paintFlames(rating?.flames ?? null)
      setText(this.recBand, '')
      setText(this.recRank, '') // rank leads the detail line instead
      setText(this.recWhy, state.scoring ? 'scoring…' : detailLine(card))
    } else {
      const top = card
      const rating = top.percentile !== null ? flamesFromPercentile(top.percentile * 100) : null
      this.paintFlames(state.scoring ? null : conviction ? conviction.flames : rating?.flames ?? null)
      setText(this.recBand, state.scoring ? '' : conviction ? shortBandLabel(conviction.label) : rating?.label ?? '')
      setText(this.recRank, state.scoring || top.rank === null ? '' : '#1')
      setText(this.recWhy, state.scoring ? 'scoring…' : buildWhy(top, ranked[1] ?? null, state.pool))
    }

    this.paintRanked(store)
  }

  /**
   * Ranked table (#1–#5) — always the model's ranking, even while hovering.
   * All five rows stay in the DOM (blank rows keep their height) so the top
   * block never reflows on hover swaps or score arrival.
   */
  private paintRanked(store: Store): void {
    const rows = rankedRows(store.state.cards, store.state.scoring)
    this.runnerNodes.forEach((r, i) => {
      const row = rows[i]
      const blank = row.name === ''
      r.row.classList.toggle('blank', blank)
      setText(r.name, row.name)
      setText(r.grade, blank ? '' : row.grade ?? '—')
      const cls = `hud-runner-grade ${gradeClass(row.grade)}`
      if (r.grade.className !== cls) r.grade.className = cls
      setText(r.setGrade, row.setGrade ?? '')
      r.setGrade.title = row.setGrade ? `set ${row.setGrade}` : ''
      setText(r.pct, blank ? '' : row.pct !== null ? `${row.pct}%` : '—')
    })
  }

  /** Mana cost · type · rarity for the card in the top block. */
  private paintMeta(card: CardRow): void {
    const key = `${card.grpId}`
    if (key === this.recMetaKey) return
    this.recMetaKey = key
    const rarity = card.rarity ? card.rarity[0].toUpperCase() + card.rarity.slice(1) : ''
    const type = card.type.replace(/\s*—\s*/g, ' — ')
    this.recMeta.innerHTML = `${renderManaCost(card.manaCost)}<span class="hud-meta-text">${escapeHtml(type)}${rarity ? ` · ${rarity}` : ''}</span>`
  }

  /** Swaps the lazy recommendation art without allowing failed loads to reflow the hero. */
  private paintArt(card: CardRow | null): void {
    const url = scryfallImageUrl(card?.scryfallId)
    if (url === this.artUrl) return
    this.artUrl = url
    this.recImage.classList.remove('loaded')
    if (!url || this.failedArt.has(url)) {
      this.recImage.removeAttribute('src')
      this.recImage.alt = ''
      return
    }
    this.recImage.alt = `${card?.name ?? 'Recommended card'} card art`
    this.recImage.src = url
  }

  private paintGrade(grade: Grade | null, setGrade: Grade | null = null): void {
    setText(this.recGrade, grade ?? '—')
    const cls = `hud-rec-grade ${gradeClass(grade)}`
    if (this.recGrade.className !== cls) this.recGrade.className = cls
    // Raw set rating alongside, only when it differs from the pool grade.
    const showSet = !!setGrade && !!grade && setGrade !== grade
    this.recSetGrade.hidden = !showSet
    if (showSet) {
      setText(this.recSetGrade, `set ${setGrade}`)
      const scls = `hud-rec-setgrade ${gradeClass(setGrade)}`
      if (this.recSetGrade.className !== scls) this.recSetGrade.className = scls
    }
  }

  private paintFlames(flames: number | null): void {
    this.recFlames.hidden = flames === null
    this.flameNodes.forEach((s, i) => s.classList.toggle('lit', flames !== null && i < flames))
  }

  private updatePool(store: Store): void {
    const { state } = store
    const summary = poolSummary(state.pool)
    const total = POOL_COLORS.reduce((s, c) => s + summary.counts[c], 0) + summary.colorless
    for (const c of POOL_COLORS) {
      const n = summary.counts[c]
      this.poolSegs[c].style.flexGrow = String(n)
      setText(this.poolCounts[c].querySelector('b')!, String(n))
    }
    this.poolSegs.C.style.flexGrow = String(summary.colorless)
    setText(this.poolCounts.C.querySelector('b')!, String(summary.colorless))
    this.pool.classList.toggle('empty', total === 0)
    setText(this.poolTotal, `${state.picks.length}/${state.totalPicks}`)
    const lean = laneLean(summary)
    this.lane.hidden = !lean
    setText(this.lane, lean ? `Leaning ${lean.label}` : '')
    const cls = lean ? `hud-lane lane-${lean.colors.join('')}` : 'hud-lane'
    if (this.lane.className !== cls) this.lane.className = cls
  }

  private updateComplete(store: Store): void {
    const { state } = store
    const a = agreement(state.picks)
    const pct = a.rate !== null ? ` (${Math.round(a.rate * 100)}%)` : ''
    setText(this.doneAgree, a.scored > 0 ? `Agreed with the model on ${a.agreed}/${a.scored} picks${pct}` : `${state.picks.length} picks`)
    const best = bestPick(state.pool)
    setText(this.doneBest, best ? `Best pick: ${best.name}${best.grade ? ` (${best.grade})` : ''}` : '')
    this.doneBest.hidden = !best
  }
}

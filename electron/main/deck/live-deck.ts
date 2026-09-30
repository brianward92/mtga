import type { CardRow, DeckEditingState } from '../../shared/state'
import { BASIC_LAND_NAMES, crossSourceTitleKey, namesMatch, isBasicLandName } from '../../shared/cards'

/** Native Vision observations use fractions of the entire Arena window. */
export interface DeckTextLine { text: string; confidence: number; x: number; y: number; width: number; height: number }
export interface DeckScreen {
  at: number; width: number; height: number
  status: 'ok' | 'unavailable'; reason?: string; lines: DeckTextLine[]
}
interface Row { name: string; count: number; x: number; y: number; height: number }
export interface ParsedDeckScreen { total: number | null; counts: Record<string, number>; rows: Row[]; titles: Array<{ name: string; line: DeckTextLine }> }
const sum = (counts: Record<string, number>): number => Object.values(counts).reduce((a, b) => a + b, 0)
const centerY = (line: DeckTextLine): number => line.y + line.height / 2
const countPrefix = (s: string): number | null => {
  const m = /^\s*(\d{1,3}|[Il])\s*[x×](?:\b|\s|\(|$)/i.exec(s)
  return m ? (/^[Il]$/.test(m[1]) ? 1 : Number(m[1])) : null
}
/** Vision may split a quantity into "1" and "x"; bare digits are safe only in its narrow column. */
const quantityCount = (line: DeckTextLine): number | null => {
  const prefix = countPrefix(line.text)
  if (prefix !== null) return prefix
  if (line.x < 0.782 || line.x + line.width > 0.816 || line.width > 0.034) return null
  const bare = /^\s*(\d{1,3})\s*$/.exec(line.text)
  return bare ? Number(bare[1]) : null
}

/** One dropped, inserted or substituted glyph; deliberately no broad fuzzy matching. */
function oneGlyphAway(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false
  let i = 0, j = 0, edits = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue }
    if (++edits > 1) return false
    if (a.length >= b.length) i++
    if (b.length >= a.length) j++
  }
  return edits + a.length - i + b.length - j <= 1
}

/** Match OCR against this pool only. Ambiguous truncated names are never guessed. */
export function identifyDeckCard(text: string, names: readonly string[]): string | null {
  const stripped = (countPrefix(text) === null ? text : text.replace(/^\s*(?:\d{1,3}|[Il])\s*[x×]\s*/i, '')).trim()
  const key = crossSourceTitleKey(stripped)
  if (!key) return null
  const exact = names.filter(name => crossSourceTitleKey(name) === key || crossSourceTitleKey(name.split(' // ')[0]) === key)
  if (exact.length === 1) return exact[0]
  const matches = names.filter(name => namesMatch(stripped, name) || namesMatch(stripped, name.split(' // ')[0]))
  if (matches.length) return matches.length === 1 ? matches[0] : null
  // Short basic names fall below the normal card-name fuzzy threshold. Vision
  // consistently reads "Islana" or a clipped "Fores" in some deck rails. Only
  // accept a five-plus-glyph read one edit from a unique pool identity, and only
  // when that identity is a basic; an equally plausible spell blocks the match.
  if (key.length < 5) return null
  const near = names.filter(name => oneGlyphAway(key, crossSourceTitleKey(name)) ||
    oneGlyphAway(key, crossSourceTitleKey(name.split(' // ')[0])))
  return near.length === 1 && isBasicLandName(near[0]) ? near[0] : null
}

/** Read the deck rail, keeping pool titles separately for click attribution. */
export function parseDeckScreen(screen: DeckScreen, names: readonly string[]): ParsedDeckScreen {
  const lines = screen.lines.filter(l => l.confidence >= 0.35)
  const header = lines.find(l => l.x > 0.6 && l.y < 0.25 && /\b\d+\s*\/\s*40\b/.test(l.text))
  // Some Arena versions display "40 Cards" instead of "40/40 Cards".
  const countHeader = header ?? lines.find(l => l.x > 0.6 && l.y < 0.25 && /^\s*\d+\s+Cards\s*$/i.test(l.text))
  const total = countHeader ? Number(/\d+/.exec(countHeader.text)![0]) : null
  const titles: ParsedDeckScreen['titles'] = []
  const rows: Row[] = []
  const counts: Record<string, number> = {}
  const rowTop = countHeader ? countHeader.y + countHeader.height + 0.008 : 0.20
  for (const line of lines) {
    if (line.y < rowTop || line.y > 0.91) continue
    const name = identifyDeckCard(line.text, names)
    if (!name) continue
    if (line.x < 0.76) { titles.push({ name, line }); continue }
    let count = countPrefix(line.text)
    if (count === null) {
      const quantity = lines.filter(l => l.x > 0.73 && l.x < line.x &&
        Math.abs(centerY(l) - centerY(line)) < Math.max(line.height, l.height) * 0.6 && quantityCount(l) !== null)
        .sort((a, b) => b.x - a.x)[0]
      if (quantity) count = quantityCount(quantity)
    }
    // Never assume a missing quantity means one: it may be a clipped 17x land row.
    if (count === null || count < 1 || count > 250) continue
    if (counts[name] !== undefined && counts[name] !== count) continue
    counts[name] = count
    rows.push({ name, count, x: line.x, y: centerY(line), height: line.height })
  }
  return { total, counts, rows, titles }
}

interface ClickChange { name: string; delta: number; at: number }

/**
 * Observation-first deck tracker. Full lists reconcile directly; partial lists
 * update known rows. A clicked card can supply the one missing delta only when
 * Arena's total and the visible rows confirm it. Unreadable/ambiguous screens
 * never silently mark cards complete. No mouse input is posted by this class.
 */
export class LiveDeckTracker {
  private key = ''
  private names: string[] = []
  private poolCopies: Record<string, number> = {}
  private value: DeckEditingState = { counts: {}, total: null, status: 'scanning', message: 'Reading Arena’s deck…', observedAt: null }
  private latest: { screen: DeckScreen; parsed: ParsedDeckScreen } | null = null
  private pending: ClickChange[] = []
  private stableTotal: number | null = null
  private totalReads = 0
  private rowEvidence = new Map<string, { count: number; reads: number }>()
  private accumulated: Record<string, number> = {}
  private accumulatedTotal: number | null = null
  private unknownClick = false
  private seen: Record<string, number> = {}
  private seenTotal: number | null = null
  /** Hidden rows can be inferred only while the same observed deck remains open. */
  private baselineTrusted = false

  get current(): DeckEditingState { return this.value }

  setPool(key: string, pool: readonly CardRow[]): void {
    this.names = [...new Set([...pool.map(c => c.name), ...Object.values(BASIC_LAND_NAMES), 'Wastes'])]
    this.poolCopies = {}
    for (const card of pool) this.poolCopies[card.name] = (this.poolCopies[card.name] ?? 0) + 1
    if (key === this.key) return
    this.key = key
    this.value = { counts: {}, total: null, status: 'scanning', message: 'Reading Arena’s deck…', observedAt: null }
    this.clearEvidence()
  }

  saved(counts: Record<string, number>, at = Date.now()): DeckEditingState {
    this.clearEvidence()
    this.value = { counts: { ...counts }, total: sum(counts), status: 'saved', message: 'Verified against Arena’s saved deck', observedAt: at }
    this.accumulated = { ...counts }; this.accumulatedTotal = sum(counts); this.baselineTrusted = true
    return this.value
  }

  private clearEvidence(): void {
    this.latest = null; this.pending = []; this.stableTotal = null; this.totalReads = 0; this.rowEvidence.clear()
    this.accumulated = {}; this.accumulatedTotal = null; this.unknownClick = false
    this.seen = {}; this.seenTotal = null; this.baselineTrusted = false
  }

  /** Call when leaving the deckbuilder even if its OCR feed stops immediately. */
  invalidate(): DeckEditingState {
    this.clearEvidence()
    return this.value = { ...this.value, status: 'uncertain', message: 'Show Arena’s deck list to sync additions and cuts' }
  }

  /** Window-relative click fractions. Ignore menus, search/filter chrome, and overlay-owned clicks. */
  noteClick(x: number, y: number, at = Date.now()): void {
    const last = this.latest
    if (!last || at - last.screen.at > 2500 || x < 0 || x > 1 || y < 0.20 || y > 0.91) return
    // Arena's next-page arrow sits around x=.767, between the pool and the
    // deck rail. Paging is not a card edit and must preserve scrolling evidence.
    const inRail = x > 0.79
    const inPool = x > 0.03 && x < 0.76
    if (!inRail && !inPool) return
    this.seen = {}; this.stableTotal = null; this.totalReads = 0; this.rowEvidence.clear()
    if (inRail) {
      const row = last.parsed.rows.find(r => Math.abs(r.y - y) < Math.max(0.019, r.height))
      if (row) this.pending.push({ name: row.name, delta: -1, at })
      else this.unknownClick = true
    } else if (inPool) {
      // Card title is near the top of its card. Restrict to its column and one
      // card's height; uncertain layouts fall back to observing the rail.
      const candidates = last.parsed.titles.filter(t => y >= t.line.y - 0.02 && y <= t.line.y + 0.30 &&
        x >= t.line.x - 0.015 && x <= t.line.x + Math.max(t.line.width, 0.115))
        .sort((a, b) => b.line.y - a.line.y)
      if (candidates.length && (!candidates[1] || candidates[0].line.y > candidates[1].line.y + 0.04)) {
        this.pending.push({ name: candidates[0].name, delta: 1, at })
      } else this.unknownClick = true
    }
  }

  observe(screen: DeckScreen): DeckEditingState {
    if (screen.status !== 'ok') {
      this.clearEvidence()
      const permission = screen.reason === 'permission'
      return this.value = { ...this.value, status: permission ? 'permission' : 'uncertain',
        message: permission ? 'Enable Screen Recording for live deck tracking' : 'Waiting for Arena’s deck to be visible' }
    }
    const raw = parseDeckScreen(screen, this.names)
    if (raw.total === null) {
      return this.invalidate()
    }
    // Keep raw positions for actual clicks, but confirm each quantity on its
    // own. Vision often omits a different tiny quantity in each frame; that
    // must not restart confirmation of every readable row in the deck.
    this.latest = { screen, parsed: raw }
    if (this.stableTotal !== raw.total) {
      this.stableTotal = raw.total; this.totalReads = 1; this.rowEvidence.clear()
      this.seen = {}; this.seenTotal = raw.total
    } else this.totalReads++
    const confirmed: Record<string, number> = {}
    for (const [name, count] of Object.entries(raw.counts)) {
      const previous = this.rowEvidence.get(name)
      const evidence = { count, reads: previous?.count === count ? previous.reads + 1 : 1 }
      this.rowEvidence.set(name, evidence)
      if (previous && previous.count !== count) delete this.seen[name]
      if (evidence.reads >= 2) confirmed[name] = count
    }
    if (this.totalReads < 2) return { ...this.value, status: 'scanning', message: 'Checking the deck change…' }
    const parsed = { ...raw, total: raw.total, counts: confirmed }
    const unconfirmedChange = [...this.rowEvidence].some(([name, evidence]) =>
      evidence.reads < 2 && this.value.counts[name] !== evidence.count)

    if (this.seenTotal !== parsed.total) { this.seen = {}; this.seenTotal = parsed.total }
    this.seen = { ...this.seen, ...parsed.counts }
    const full = sum(parsed.counts) === parsed.total
    const scanned = sum(this.seen) === parsed.total
    let candidate: Record<string, number>
    if (full) candidate = { ...parsed.counts }
    else if (scanned) candidate = { ...this.seen }
    else {
      if (this.accumulatedTotal !== parsed.total) {
        this.accumulated = this.baselineTrusted ? { ...this.value.counts } : {}
        this.accumulatedTotal = parsed.total
      }
      candidate = { ...this.accumulated, ...parsed.counts }
      const clicks = this.pending.filter(c => c.at < screen.at - 150 && screen.at - c.at < 10_000)
      const inferred = { ...candidate }
      let hasInference = false
      for (const c of clicks) {
        // A visible quantity already includes the click. Infer only hidden rows.
        if (raw.counts[c.name] === undefined) {
          inferred[c.name] = Math.max(0, (inferred[c.name] ?? 0) + c.delta)
          hasInference = true
        }
      }
      const possible = Object.entries(inferred).every(([name, count]) =>
        isBasicLandName(name) || count <= (this.poolCopies[name] ?? 0))
      if (hasInference && this.baselineTrusted && !this.unknownClick && !unconfirmedChange && possible && sum(inferred) === parsed.total) {
        candidate = inferred
      } else if (hasInference) {
        // A title image can lag behind rapid clicks. Never publish or persist
        // guesses unless the resulting deck is both possible and confirmed by
        // Arena's total. Keep readable rows; fresh rail coverage can resync.
        this.unknownClick = true
      }
      for (const [name, count] of Object.entries(candidate)) if (!count) delete candidate[name]
      this.accumulated = candidate
    }
    // Arena may rebalance Plains/Island/etc. after a spell edit while retaining
    // the same total number of lands. The header cannot verify that hidden
    // distribution. Every retained basic must have fresh evidence from this
    // edit (seen resets on clicks and total changes), or a full scan must agree.
    const freshBasics = Object.entries(candidate).filter(([name]) => isBasicLandName(name))
      .every(([name, count]) => this.seen[name] === count)
    const matched = !unconfirmedChange && (full || scanned ||
      (this.baselineTrusted && freshBasics && sum(candidate) === parsed.total && !this.unknownClick))
    if (matched) {
      this.pending = []; this.unknownClick = false
      this.accumulated = { ...candidate }; this.accumulatedTotal = parsed.total
      this.baselineTrusted = true
      return this.value = { counts: candidate, total: parsed.total, status: 'live', message: 'Following your Arena deck', observedAt: screen.at }
    }
    // Preserve all known rows while the player scrolls to expose the remainder.
    this.pending = []
    // Retain the previous display during a fresh scan, but never use those
    // hidden rows as proof that the reopened deck is unchanged.
    const displayCounts = this.baselineTrusted ? candidate : { ...this.value.counts, ...candidate }
    return this.value = { counts: displayCounts, total: parsed.total, status: 'uncertain',
      message: freshBasics ? 'Scroll Arena’s deck list to sync the remaining cards' : 'Scroll to Arena’s lands to check the mana base', observedAt: screen.at }
  }
}

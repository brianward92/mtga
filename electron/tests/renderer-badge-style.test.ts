/**
 * Badge-layer style contract.
 *
 * The badge layer is drawn ON TOP of Arena's own card art, so a handful of
 * its visual rules are correctness, not taste: never tint the art, never let
 * a chip grow past the card it annotates, never shout on a card the model
 * does not rate, and get out of the way the instant Arena raises a preview.
 * Those rules live in CSS, where nothing else can test them — so they are
 * pinned here against renderer/overlay/overlay.css.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const CSS = readFileSync(join(__dirname, '..', 'renderer', 'overlay', 'overlay.css'), 'utf8')

interface Rule {
  selectors: string[]
  body: string
}

/**
 * Top-level style rules, in source order. At-rule blocks (@media, @keyframes)
 * are skipped whole — the assertions below only care about the base layer.
 */
function parseRules(css: string): Rule[] {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const rules: Rule[] = []
  let i = 0
  while (i < src.length) {
    const open = src.indexOf('{', i)
    if (open === -1) break
    const prelude = src.slice(i, open).trim()
    let depth = 1
    let j = open + 1
    while (j < src.length && depth > 0) {
      if (src[j] === '{') depth++
      else if (src[j] === '}') depth--
      j++
    }
    if (!prelude.startsWith('@')) {
      rules.push({
        selectors: prelude.split(',').map(s => s.trim().replace(/\s+/g, ' ')).filter(Boolean),
        body: src.slice(open + 1, j - 1)
      })
    }
    i = j
  }
  return rules
}

const RULES = parseRules(CSS)

/** Every rule whose selector list contains `selector` exactly. */
function rulesFor(selector: string): Rule[] {
  return RULES.filter(r => r.selectors.includes(selector))
}

/** Declared value of `prop` for `selector` (last wins), or null. */
function decl(selector: string, prop: string): string | null {
  let found: string | null = null
  for (const rule of rulesFor(selector)) {
    const re = new RegExp(`(?:^|;)\\s*${prop}\\s*:([^;]*)`, 'g')
    let m: RegExpExecArray | null
    while ((m = re.exec(rule.body)) !== null) found = m[1].trim()
  }
  return found
}

/** Rules targeting the frame element itself (not a descendant of it). */
const FRAME_RULES = RULES.filter(r =>
  r.selectors.some(s => /^\.card-frame[\w.-]*$/.test(s))
)

describe('badge layer style contract', () => {
  it('never fills or dims the card art behind a frame', () => {
    expect(FRAME_RULES.length).toBeGreaterThan(0)
    for (const rule of FRAME_RULES) {
      expect(rule.body, `frame rule "${rule.selectors.join(', ')}" paints a fill`)
        .not.toMatch(/(^|;)\s*background(-color|-image)?\s*:/)
      // `inset` box-shadows would dim the art the same way a fill does.
      const shadow = rule.body.match(/(?:^|;)\s*box-shadow\s*:([^;]*)/)
      if (shadow) expect(shadow[1]).not.toContain('inset')
    }
    // The only opacity a frame may carry is the preview lift.
    const dimming = FRAME_RULES.filter(r => /(^|;)\s*opacity\s*:/.test(r.body))
    expect(dimming.map(r => r.selectors.join(','))).toEqual(['.card-frame.behind'])
  })

  it('lifts under an Arena preview in 60ms and settles back in 120ms', () => {
    expect(decl(':root', '--t-fast')).toBe('60ms ease-out')
    expect(decl(':root', '--t-settle')).toBe('120ms ease-out')
    // Adding .behind transitions with the .behind rule; removing it falls
    // back to the base rule — hence out fast, back slow.
    expect(decl('.card-frame.behind', 'transition')).toBe('opacity var(--t-fast)')
    expect(decl('.card-frame', 'transition')).toMatch(/^opacity var\(--t-settle\)/)
    expect(decl('.card-frame.behind', 'opacity')).toBe('0 !important')
    expect(decl('.badges.covered', 'transition')).toBe('opacity var(--t-fast)')
    expect(decl('.badges', 'transition')).toBe('opacity var(--t-settle)')
  })

  it('glows only for the tiers worth shouting about', () => {
    for (const tier of ['top', 'a']) {
      expect(rulesFor(`.card-frame.tier-${tier}::before`), `tier-${tier} needs a glow layer`)
        .not.toHaveLength(0)
    }
    for (const tier of ['b', 'c', 'd', 'none']) {
      expect(rulesFor(`.card-frame.tier-${tier}::before`), `tier-${tier} must not glow`)
        .toHaveLength(0)
      // ...and must not smuggle one in through a coloured drop shadow either.
      expect(decl(`.card-frame.tier-${tier}`, 'box-shadow')).toBeNull()
    }
    // The glow sits behind the frame's own content so it can never haze the chip.
    expect(decl('.card-frame.tier-top::before', 'z-index')).toBe('-1')
  })

  it('pulses the top pick over a value that survives reduced motion', () => {
    expect(decl('.card-frame.tier-top::before', 'animation')).toBe('frame-pulse 2s ease-in-out infinite')
    expect(CSS).toMatch(/@keyframes\s+frame-pulse\b/)
    // The global reduced-motion guard kills the animation, so the held
    // opacity must already look finished on its own.
    const held = Number(decl('.card-frame.tier-top::before', 'opacity'))
    expect(held).toBeGreaterThan(0.5)
    expect(held).toBeLessThanOrEqual(1)
    expect(CSS).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none !important/)
  })

  it('keeps the chip inside the card and 11-13% of its height at any size', () => {
    expect(decl('.badge-chip', 'max-width')).toBe('100%')
    const min = Number(decl('.badge-chip', 'min-height')!.replace('%', ''))
    const max = Number(decl('.badge-chip', 'max-height')!.replace('%', ''))
    expect(min).toBeGreaterThanOrEqual(11)
    expect(max).toBeLessThanOrEqual(13)
    expect(min).toBeLessThan(max)
    // The bracket only resolves because the frame is a size container.
    expect(decl('.card-frame', 'container-type')).toBe('size')
  })

  it('scales badge type off the card, not the rem clamp', () => {
    // 1rem tops out at 14px (clamp in the `html` rule), so anything sized in
    // rem would stop growing on a 4K Arena window. Card-relative units don't.
    for (const selector of ['.b-grade', '.b-flames', '.b-pct', '.b-rank', '.b-label']) {
      const size = decl(selector, 'font-size')
      expect(size, `${selector} needs a font-size`).not.toBeNull()
      expect(size, `${selector} must scale with the card`).toMatch(/^clamp\(.*cqh.*\)$/)
    }
    // Grade letter is the anchor: the largest thing in the chip.
    const scale = (selector: string): number =>
      Number(decl(selector, 'font-size')!.match(/([\d.]+)cqh/)![1])
    expect(scale('.b-grade')).toBeGreaterThan(scale('.b-pct'))
    expect(scale('.b-pct')).toBeGreaterThan(scale('.b-flames'))
  })

  it('colours the grade letter by tier', () => {
    expect(decl('.badge-chip.tier-top .b-grade', 'color')).toBe('var(--tier-top)')
    expect(decl('.badge-chip.tier-a .b-grade', 'color')).toBe('var(--tier-a)')
    expect(decl('.badge-chip.tier-b .b-grade', 'color')).toBe('var(--tier-b)')
    expect(decl('.badge-chip.tier-c .b-grade', 'color')).toBe('var(--tier-c)')
    expect(decl('.badge-chip.tier-d .b-grade', 'color')).toBe('var(--tier-d)')
  })

  it('speaks one pill language across chip, rank tag and band label', () => {
    for (const selector of ['.badge-chip', '.b-rank', '.b-label']) {
      expect(decl(selector, 'border-radius'), `${selector} radius`).toBe('var(--pill)')
      expect(decl(selector, 'background'), `${selector} surface`).toBe('var(--badge-glass)')
      expect(decl(selector, 'backdrop-filter'), `${selector} blur`).toBe('var(--badge-blur)')
    }
    // The band label reads as a badge, not a sticker.
    expect(decl('.b-label', 'text-transform')).toBe('uppercase')
    expect(decl('.b-label', 'letter-spacing')).toMatch(/^0\.1\d*em$/)
  })
})

#!/usr/bin/env node
/**
 * E2E visual harness: drives a complete synthetic Quick Draft through the REAL
 * app — no Arena, no human — and screenshots the overlay at each state.
 *
 *   1. Sandbox HOME (fresh prefs / history), an empty fake Player.log, a fake
 *      Arena rect (MTGA_FAKE_ARENA_FILE) and the repo's model bundle.
 *   2. Launch the built app (dist/) with electron + --remote-debugging-port,
 *      connect puppeteer-core over CDP, find the overlay page.
 *   3. Stream tests/e2e/gen-draft-log.mjs output into the fake log with
 *      pacing, waiting for DOM signals at each checkpoint, screenshotting to
 *      tests/e2e/shots/<step>.png. Also drives hover-to-detail (CDP mouse),
 *      the sheet, and calibration through the HUD's interactive controls.
 *   4. Fails on missing steps or renderer console errors.
 *
 * Usage: npm run e2e [-- --keep-tmp --port 9333 --speed 8]
 */
import { spawn, spawnSync } from 'child_process'
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import puppeteer from 'puppeteer-core'

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = join(here, '..', '..')
const args = process.argv.slice(2)
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d }
const PORT = Number(opt('--port', '9333'))
const SPEED = Number(opt('--speed', '10'))
const KEEP = args.includes('--keep-tmp')
const OUT = opt('--out', join(here, 'shots'))
mkdirSync(OUT, { recursive: true })

// Selectors the renderer exposes for tests (data-testid attributes).
const SEL = {
  root: '[data-testid="overlay-root"]',
  badges: '#badges',
  cell: '[data-testid="badge-cell"]',
  chipScored: '[data-testid="badge-cell"][data-scored="true"]',
  rail: '[data-testid="draft-rail"]',
  railPanel: '.draft-rail-panel',
  hud: '[data-testid="hud"]',
  hudPool: '#hudPool',
  hudIdle: '#hudIdle',
  hudIdleText: '.hud-idle-text',
  hudMain: '#hudMain',
  hudWarning: '#hudWarning',
  hudPick: '[data-testid="hud-pick"]',
  hudPickImage: '#recImage',
  hudRank: '#recRank',
  hudRankedTable: '#hudRunners',
  hudRunners: '#hudRunners .hud-runner',
  hudProvenance: '[data-testid="hud-provenance"]',
  hudCalBtn: '[data-testid="hud-btn-calibrate"]',
  hudDismiss: '#btnDismiss',
  hudFooter: '.hud-foot',
  sheetRoot: '#sheet',
  sheetBody: '.sheet-body',
  sheetPool: '#sheetPool',
  sheetRating: '#sheetRating',
  sheet: '[data-testid="sheet"]',
  calPanel: '[data-testid="calibrate-panel"]',
  calCancel: '[data-testid="calibrate-cancel"]'
}

const tmp = mkdtempSync(join(tmpdir(), 'mtga-e2e-'))
const home = join(tmp, 'home'); mkdirSync(home, { recursive: true })
const logPath = join(tmp, 'Player.log'); writeFileSync(logPath, '')
const arenaRect = { x: 0, y: 33, width: 1512, height: 949 }
const arenaFile = join(tmp, 'arena.json'); writeFileSync(arenaFile, JSON.stringify(arenaRect))
const fixture = spawnSync('node', [join(here, 'gen-draft-log.mjs'), '--picks', '42', '--seed', '11'], { encoding: 'utf8' }).stdout.split('\n')

const electronBin = join(ROOT, 'node_modules', '.bin', 'electron')
if (!existsSync(join(ROOT, 'dist', 'main', 'index.js'))) { console.error('build first: npm run build'); process.exit(2) }
const app = spawn(electronBin, [ROOT, `--remote-debugging-port=${PORT}`], {
  env: { ...process.env, HOME: home, MTGA_USER_DATA: join(home, 'userData'), MTGA_LOG_PATH: logPath, MTGA_FAKE_ARENA_FILE: arenaFile, MTGA_BUNDLE_DIR: join(ROOT, 'resources', 'draftfm'), MTGA_E2E: '1', ELECTRON_ENABLE_LOGGING: '1' },
  stdio: ['ignore', 'pipe', 'pipe']
})
let mainLog = ''
app.stdout.on('data', d => { mainLog += d })
app.stderr.on('data', d => { mainLog += d })

const sleep = ms => new Promise(r => setTimeout(r, ms))
const failures = []
const consoleErrors = []

async function connect() {
  for (let i = 0; i < 60; i++) {
    try {
      const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${PORT}`, defaultViewport: null })
      const pages = await browser.pages()
      const page = pages.find(p => p.url().includes('overlay')) ?? pages[0]
      if (page) return { browser, page }
    } catch { /* not up yet */ }
    await sleep(500)
  }
  throw new Error('could not connect to the app over CDP')
}

async function shot(page, name) {
  await page.screenshot({ path: join(OUT, `${name}.png`), omitBackground: false })
  console.log('  shot', name)
}

async function waitFor(page, fn, label, timeout = 8000) {
  const t = Date.now()
  while (Date.now() - t < timeout) {
    if (await page.evaluate(fn, SEL)) return true
    await sleep(100)
  }
  failures.push(`timeout waiting for ${label}`)
  console.error('  FAIL', label)
  return false
}

async function expectPage(page, fn, label) {
  if (await page.evaluate(fn, SEL)) return true
  failures.push(label)
  console.error('  FAIL', label)
  return false
}

async function expectSheetContained(page, label, requireScroll = false) {
  const result = await page.evaluate((S, shouldScroll) => {
    const railRoot = document.querySelector(S.rail)
    const panel = document.querySelector(S.railPanel)
    const sheet = document.querySelector(S.sheetRoot)
    const body = document.querySelector(S.sheetBody)
    const footer = document.querySelector(S.hudFooter)
    if (!railRoot || !panel || !sheet || !body || !footer) return { ok: false, reason: 'missing rail/panel/sheet/body/footer' }
    const rail = railRoot.getBoundingClientRect()
    const panelRect = panel.getBoundingClientRect()
    const sheetRect = sheet.getBoundingClientRect()
    const content = body.getBoundingClientRect()
    const footerRect = footer.getBoundingClientRect()
    const overflowY = getComputedStyle(body).overflowY
    if (shouldScroll) body.scrollTop = body.scrollHeight
    const scrollTop = body.scrollTop
    const rootContained = rail.left >= window.innerWidth * 0.76 - 1 && rail.right <= window.innerWidth + 1 &&
      rail.top >= window.innerHeight * 0.125 - 1 && rail.bottom <= window.innerHeight + 1 && rail.height > 0
    const bodyContained = sheetRect.top >= panelRect.top - 1 && sheetRect.bottom <= footerRect.top + 1 &&
      content.top >= sheetRect.top - 1 && content.bottom <= sheetRect.bottom + 1 &&
      sheet.scrollHeight <= sheet.clientHeight + 1
    const scrollReady = overflowY === 'auto' || overflowY === 'scroll'
    const scrolls = body.scrollHeight > body.clientHeight && scrollTop > 0
    return {
      ok: rootContained && bodyContained && scrollReady && (!shouldScroll || scrolls),
      view: { width: window.innerWidth, height: window.innerHeight },
      rail: { left: rail.left, right: rail.right, top: rail.top, bottom: rail.bottom, height: rail.height },
      panel: { top: panelRect.top, bottom: panelRect.bottom },
      sheet: { top: sheetRect.top, bottom: sheetRect.bottom, clientHeight: sheet.clientHeight, scrollHeight: sheet.scrollHeight },
      footer: { top: footerRect.top, bottom: footerRect.bottom },
      body: { top: content.top, bottom: content.bottom, clientHeight: body.clientHeight, scrollHeight: body.scrollHeight, scrollTop, overflowY },
      requireScroll: shouldScroll
    }
  }, SEL, requireScroll)
  if (result.ok) return true
  failures.push(`${label}: ${JSON.stringify(result)}`)
  console.error('  FAIL', label, result)
  return false
}

async function expectLongPoolScroll(page, label) {
  const result = await page.evaluate(S => {
    const rail = document.querySelector(S.rail)
    const panel = document.querySelector(S.railPanel)
    const sheet = document.querySelector(S.sheetRoot)
    const body = document.querySelector(S.sheetBody)
    const footer = document.querySelector(S.hudFooter)
    if (!rail || !panel || !sheet || !body || !footer) return { ok: false, reason: 'missing rail/panel/sheet/body/footer' }
    const railRect = rail.getBoundingClientRect()
    const panelRect = panel.getBoundingClientRect()
    const sheetRect = sheet.getBoundingClientRect()
    const bodyRect = body.getBoundingClientRect()
    const footerBefore = footer.getBoundingClientRect()
    // The deterministic fixture deliberately repeats one 14-card reference
    // pack three times, so grouping can make all 42 copies fit. Add a
    // reversible long-pool probe to exercise the same real overflow surface.
    const probe = document.createElement('div')
    probe.setAttribute('aria-hidden', 'true')
    probe.style.flex = `0 0 ${body.clientHeight + 100}px`
    body.appendChild(probe)
    body.scrollTop = body.scrollHeight
    const scrollTop = body.scrollTop
    const footerAfter = footer.getBoundingClientRect()
    const contained = railRect.left >= window.innerWidth * 0.76 - 1 && railRect.right <= window.innerWidth + 1 &&
      railRect.top >= window.innerHeight * 0.125 - 1 && railRect.bottom <= window.innerHeight + 1 &&
      sheetRect.top >= panelRect.top - 1 && bodyRect.top >= sheetRect.top - 1 &&
      bodyRect.bottom <= sheetRect.bottom + 1 && sheetRect.bottom <= footerBefore.top + 1
    const ok = body.scrollHeight > body.clientHeight && scrollTop > 0 &&
      contained &&
      Math.abs(footerBefore.top - footerAfter.top) <= 1 && Math.abs(footerBefore.bottom - footerAfter.bottom) <= 1
    const details = {
      ok,
      contained,
      rail: { left: railRect.left, right: railRect.right, top: railRect.top, bottom: railRect.bottom },
      sheet: { top: sheetRect.top, bottom: sheetRect.bottom },
      body: { clientHeight: body.clientHeight, scrollHeight: body.scrollHeight, scrollTop },
      footerBefore: { top: footerBefore.top, bottom: footerBefore.bottom },
      footerAfter: { top: footerAfter.top, bottom: footerAfter.bottom }
    }
    probe.remove()
    body.scrollTop = 0
    return details
  }, SEL)
  if (result.ok) return true
  failures.push(`${label}: ${JSON.stringify(result)}`)
  console.error('  FAIL', label, result)
  return false
}

async function expectDraftSidebarGeometry(page, label) {
  const result = await page.evaluate(S => {
    const rail = document.querySelector(S.rail)
    const panel = document.querySelector(S.railPanel)
    const hud = document.querySelector(S.hud)
    const sheet = document.querySelector(S.sheetRoot)
    const header = hud?.querySelector('.hud-head')
    const rating = document.querySelector(S.sheetRating)
    const rec = document.querySelector(S.hudPick)
    const ranked = document.querySelector(S.hudRankedTable)
    const pool = document.querySelector(S.hudPool)
    const body = document.querySelector(S.sheetBody)
    const footer = document.querySelector(S.hudFooter)
    if (!rail || !panel || !hud || !sheet || !header || !rating || !rec || !ranked || !pool || !body || !footer) {
      return { ok: false, reason: 'missing sidebar hierarchy node' }
    }

    const r = rail.getBoundingClientRect()
    const p = panel.getBoundingClientRect()
    const h = hud.getBoundingClientRect()
    const s = sheet.getBoundingClientRect()
    const head = header.getBoundingClientRect()
    const rate = rating.getBoundingClientRect()
    const recommendation = rec.getBoundingClientRect()
    const table = ranked.getBoundingClientRect()
    const summary = pool.getBoundingClientRect()
    const content = body.getBoundingClientRect()
    const f = footer.getBoundingClientRect()
    const view = { width: window.innerWidth, height: window.innerHeight }
    const expected = {
      left: view.width * 0.76,
      right: view.width,
      top: view.height * 0.125,
      bottom: view.height,
      panelLeft: view.width * 0.76 + 6,
      panelRight: view.width - 6,
      panelTop: view.height * 0.125 + 6,
      panelBottom: view.height - 6
    }
    const alpha = color => {
      const match = color.match(/^rgba?\(([^)]+)\)$/)
      if (!match) return Number.NaN
      const parts = match[1].split(',').map(part => Number.parseFloat(part.trim()))
      return parts.length === 4 ? parts[3] : 1
    }
    const railStyle = getComputedStyle(rail)
    const panelStyle = getComputedStyle(panel)
    const hudStyle = getComputedStyle(hud)
    const sheetStyle = getComputedStyle(sheet)
    const railAlpha = alpha(railStyle.backgroundColor)
    const panelAlpha = alpha(panelStyle.backgroundColor)
    const hudAlpha = alpha(hudStyle.backgroundColor)
    const sheetAlpha = alpha(sheetStyle.backgroundColor)
    const close = (actual, wanted, tolerance = 1) => Math.abs(actual - wanted) <= tolerance
    const opened = rail.classList.contains('open') && rail.classList.contains('interactive') &&
      !rail.classList.contains('preview-covered') && sheet.classList.contains('open')
    const fixedBounds = close(r.left, expected.left) && close(r.right, expected.right) &&
      close(r.top, expected.top) && close(r.bottom, expected.bottom) &&
      close(p.left, expected.panelLeft) && close(p.right, expected.panelRight) &&
      close(p.top, expected.panelTop) && close(p.bottom, expected.panelBottom)
    const activeBlocks = recommendation.height > 0 && table.height > 0
    const upperHierarchy = activeBlocks
      ? head.bottom <= recommendation.top + 1 && recommendation.bottom <= table.top + 1 && table.bottom <= summary.top + 1
      : recommendation.height === 0 && table.height === 0 && head.bottom <= summary.top + 1
    const hierarchy = head.top >= p.top - 1 && rate.top >= head.top - 1 && rate.bottom <= head.bottom + 1 &&
      upperHierarchy && summary.bottom <= s.top + 1 &&
      s.bottom <= f.top + 1 && close(f.bottom, p.bottom) &&
      content.top >= s.top - 1 && content.bottom <= s.bottom + 1
    const oneSurface = close(railAlpha, 1, 0.005) && close(Number.parseFloat(railStyle.opacity), 1, 0.005) &&
      close(panelAlpha, 0, 0.005) && close(hudAlpha, 0, 0.005) && close(sheetAlpha, 0, 0.005) &&
      panelStyle.borderTopWidth === '1px' && panelStyle.borderTopLeftRadius !== '0px' &&
      hudStyle.borderTopWidth === '0px' && sheetStyle.borderTopWidth === '0px' &&
      hudStyle.boxShadow === 'none' && sheetStyle.boxShadow === 'none'
    const edgePoints = [
      [expected.left + 1, expected.top + 1],
      [expected.right - 1, expected.top + 1],
      [expected.left + 1, expected.bottom - 1],
      [expected.right - 1, expected.bottom - 1]
    ]
    const edgeOwnership = railStyle.pointerEvents === 'auto' && edgePoints.every(([x, y]) =>
      document.elementFromPoint(x, y)?.closest(S.rail) === rail)
    return {
      ok: opened && fixedBounds && hierarchy && oneSurface && edgeOwnership,
      view,
      expected,
      rail: { left: r.left, right: r.right, top: r.top, bottom: r.bottom, alpha: railAlpha, opacity: railStyle.opacity, classes: rail.className },
      panel: { left: p.left, right: p.right, top: p.top, bottom: p.bottom, alpha: panelAlpha, radius: panelStyle.borderTopLeftRadius },
      hud: { left: h.left, right: h.right, top: h.top, bottom: h.bottom, alpha: hudAlpha, border: hudStyle.borderTopWidth, classes: hud.className },
      order: { header: [head.top, head.bottom], rating: [rate.top, rate.bottom], rec: [recommendation.top, recommendation.bottom], table: [table.top, table.bottom], pool: [summary.top, summary.bottom], sheet: [s.top, s.bottom], body: [content.top, content.bottom], footer: [f.top, f.bottom] },
      sheet: { left: s.left, right: s.right, top: s.top, bottom: s.bottom, alpha: sheetAlpha, border: sheetStyle.borderTopWidth, classes: sheet.className },
      checks: { opened, fixedBounds, hierarchy, activeBlocks, oneSurface, edgeOwnership }
    }
  }, SEL)
  if (result.ok) return true
  failures.push(`${label}: ${JSON.stringify(result)}`)
  console.error('  FAIL', label, result)
  return false
}

let fed = 0
async function feedUntil(pred) {
  while (fed < fixture.length) {
    const line = fixture[fed++]
    appendFileSync(logPath, line + '\n')
    if (pred(line)) break
    if (SPEED > 0 && fed % SPEED === 0) await sleep(15)
  }
  await sleep(250)
}

const nthPickNext = (n) => { let seen = 0; return l => (l.includes('"DraftStatus\\":\\"PickNext') && ++seen === n) }

try {
  const { browser, page } = await connect()
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()) })
  page.on('pageerror', e => consoleErrors.push(String(e)))
  await waitFor(page, S => !!document.querySelector(S.root), 'overlay root')
  // Park the (real) cursor: the layer detector predicts hover previews from it.
  await page.mouse.move(2, 2)
  await sleep(1500)
  await expectPage(page, S => {
    const visible = selector => {
      const el = document.querySelector(selector)
      if (!el || el.hidden) return false
      const style = getComputedStyle(el)
      const rect = el.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
    }
    const rail = document.querySelector(S.rail)
    const hud = document.querySelector(S.hud)
    const sheet = document.querySelector(S.sheetRoot)
    const badges = document.querySelector(S.badges)
    return !!rail && !rail.classList.contains('open') && rail.getAttribute('aria-hidden') === 'false' &&
      !!hud && hud.classList.contains('idle') && hud.classList.contains('idle-min') &&
      hud.classList.contains('hud-tr') && !hud.classList.contains('interactive') &&
      visible(S.hudIdle) && !visible(S.hudIdleText) && !visible(S.hudMain) &&
      !visible(S.hudWarning) && document.querySelectorAll(S.cell).length === 0 &&
      !!badges && !visible(S.badges) && !!sheet && !sheet.classList.contains('open') &&
      !visible(S.sheetRoot) && !document.querySelector(S.sheet)
  }, 'idle renders only the click-through top-right glyph')
  await shot(page, '00-idle')

  await feedUntil(nthPickNext(1))
  await waitFor(page, S => document.querySelectorAll(S.cell).length === 14, '14 badge cells')
  await waitFor(page, S => !!document.querySelector(S.sheet), 'pool list pinned in the draft sidebar')
  await waitFor(page, S => {
    const provenance = document.querySelector(S.hudProvenance)
    const text = provenance?.textContent?.trim() ?? ''
    return !!provenance && !provenance.hidden && /^DraftFM \S+ · Scryfall \d{4}-\d{2}-\d{2}/.test(text)
  }, 'model and Scryfall snapshot provenance')
  await expectPage(page, S => {
    const chips = [...document.querySelectorAll(`${S.hudPool} .hud-pool-counts .pc`)]
    return chips.map(chip => [...chip.classList].find(name => /^[WUBRGC]$/.test(name))).join('') === 'WUBRGC' &&
      chips.every(chip => /^\d+$/.test(chip.querySelector('b')?.textContent ?? ''))
  }, 'single WUBRGC pool summary in the sidebar')
  await expectDraftSidebarGeometry(page, 'P1P1 full right-column sidebar geometry, hierarchy, and ownership')
  await expectPage(page, S => {
    const footer = document.querySelector(S.hudFooter)
    const buttonIds = footer ? [...footer.querySelectorAll('button')].map(button => button.id) : []
    return buttonIds.join(',') === 'btnBadges,btnCalibrate' &&
      !document.querySelector('#btnCorner, #btnSheet, [title*="Precise layering"], [aria-label*="Precise layering"]')
  }, 'sidebar footer has badges and calibrate only; corner and precise-layering controls stay out')
  await expectPage(page, () => {
    const text = document.body.textContent?.toLowerCase() ?? ''
    return !text.includes('data from 17lands') && !text.includes('gih wr') && !text.includes('alsa')
  }, 'no legacy card-stat attribution')
  await shot(page, '01-p1p1-pack')
  await waitFor(page, S => document.querySelectorAll(S.chipScored).length >= 10, 'scored chips')
  await expectPage(page, S => {
    const rank = document.querySelector(S.hudRank)?.textContent?.trim()
    const runners = [...document.querySelectorAll(S.hudRunners)].filter(row => !row.hidden)
    const meta = document.querySelector(`${S.hudPick} .hud-rec-meta`)
    const why = document.querySelector(`${S.hudPick} .hud-rec-why`)
    const hero = document.querySelector(S.hudPick)
    const art = document.querySelector(S.hudPickImage)
    const pool = document.querySelector(`${S.hudPool} .hud-pool-bar`)
    const heroRect = hero?.getBoundingClientRect()
    const artRect = art?.getBoundingClientRect()
    const csp = document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content ?? ''
    return rank === '#1' && runners.length === 5 &&
      runners.map(row => row.querySelector('.hud-runner-rank')?.textContent?.trim()).join('') === '#1#2#3#4#5' &&
      runners.every(row => !!row.querySelector('.hud-runner-name')?.textContent?.trim() &&
        !!row.querySelector('.hud-runner-grade')?.textContent?.trim() &&
        /^\d+%$/.test(row.querySelector('.hud-runner-pct')?.textContent?.trim() ?? '')) &&
      !!meta?.textContent?.trim() && !!why?.textContent?.includes('#1') && !!why?.textContent?.includes('#2') &&
      art instanceof HTMLImageElement && art.loading === 'lazy' &&
      /^https:\/\/cards\.scryfall\.io\/normal\/front\/[0-9a-f]\/[0-9a-f]\/[0-9a-f-]+\.jpg$/.test(art.src) &&
      !!heroRect && !!artRect && heroRect.height > 150 && artRect.width / heroRect.width > 0.28 && artRect.width / heroRect.width < 0.38 &&
      csp.includes('img-src') && csp.includes('https://cards.scryfall.io') && !!pool
  }, 'ranked top five, card art, honest why, metadata, grades, and pool bar')
  await shot(page, '02-p1p1-scored')

  const railBeforeHover = await page.evaluate(S => {
    const rec = document.querySelector(S.hudPick).getBoundingClientRect()
    const pool = document.querySelector(S.hudPool).getBoundingClientRect()
    const sheet = document.querySelector(S.sheetRoot).getBoundingClientRect()
    const art = document.querySelector(S.hudPickImage)
    return { recHeight: rec.height, poolTop: pool.top, sheetTop: sheet.top, artSrc: art?.getAttribute('src') ?? '' }
  }, SEL)

  // Hover-to-detail: move the mouse over the 3rd cell.
  const rect = await page.evaluate(S => { const c = document.querySelectorAll(S.cell)[2]; const r = c.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } }, SEL)
  await page.mouse.move(rect.x, rect.y)
  await sleep(300)
  const railWhileHovering = await page.evaluate(S => {
    const rec = document.querySelector(S.hudPick).getBoundingClientRect()
    const pool = document.querySelector(S.hudPool).getBoundingClientRect()
    const sheet = document.querySelector(S.sheetRoot).getBoundingClientRect()
    const art = document.querySelector(S.hudPickImage)
    return { recHeight: rec.height, poolTop: pool.top, sheetTop: sheet.top, artSrc: art?.getAttribute('src') ?? '' }
  }, SEL)
  if (['recHeight', 'poolTop', 'sheetTop'].some(key => Math.abs(railBeforeHover[key] - railWhileHovering[key]) > 1)) {
    failures.push(`hover reflowed rail: ${JSON.stringify({ before: railBeforeHover, hovering: railWhileHovering })}`)
  }
  if (!railWhileHovering.artSrc || railWhileHovering.artSrc === railBeforeHover.artSrc) {
    failures.push(`hover did not swap recommendation art: ${JSON.stringify({ before: railBeforeHover.artSrc, hovering: railWhileHovering.artSrc })}`)
  }
  await shot(page, '03-hover-detail')
  await page.mouse.move(5, 5)
  await sleep(100)

  // The sidebar owns the whole column: body dwell must never yield it or make
  // Arena behind it interactive.
  const sheetBodyPoint = await page.evaluate(S => {
    const r = document.querySelector(S.sheetBody).getBoundingClientRect()
    return { x: r.x + r.width / 2, y: r.y + Math.min(40, r.height / 2) }
  }, SEL)
  await page.mouse.move(sheetBodyPoint.x, sheetBodyPoint.y)
  await sleep(400)
  await expectPage(page, S => {
    const rail = document.querySelector(S.rail)
    const hud = document.querySelector(S.hud)
    const sheet = document.querySelector(S.sheetRoot)
    if (!rail || !hud || !sheet) return false
    const style = getComputedStyle(rail)
    return rail.classList.contains('open') && rail.classList.contains('interactive') &&
      !rail.classList.contains('preview-covered') && !hud.classList.contains('yield') &&
      !sheet.classList.contains('yield') && Math.abs(Number.parseFloat(style.opacity) - 1) < 0.005 &&
      style.pointerEvents === 'auto'
  }, '400ms sidebar dwell never fades, yields, or releases pointer ownership')

  // Clean test-only injection proves the production predicted-region path.
  // `hudCovered` alone is explicitly insufficient: only region intersection
  // may fade the common owner, while badge preview lifting remains intact.
  await page.evaluate(layer => {
    document.dispatchEvent(new CustomEvent('mtga:e2e-layer', { detail: layer }))
  }, { cells: [1], regions: [{ x: 1120, y: 200, width: 160, height: 300 }], covered: false, hudCovered: true })
  await waitFor(page, S => {
    const rail = document.querySelector(S.rail)
    const cells = [...document.querySelectorAll(S.cell)]
    if (!rail || cells.length < 2) return false
    const style = getComputedStyle(rail)
    return rail.classList.contains('preview-covered') &&
      Math.abs(Number.parseFloat(style.opacity) - 0.08) < 0.005 && style.pointerEvents === 'auto' &&
      cells[1].classList.contains('behind')
  }, 'intersecting predicted preview fades interactive sidebar and lifts covered badge')
  await page.evaluate(layer => {
    document.dispatchEvent(new CustomEvent('mtga:e2e-layer', { detail: layer }))
  }, { cells: [], regions: [{ x: 100, y: 100, width: 200, height: 200 }], covered: false, hudCovered: true })
  await waitFor(page, S => {
    const rail = document.querySelector(S.rail)
    const hud = document.querySelector(S.hud)
    if (!rail || !hud) return false
    const style = getComputedStyle(rail)
    const colorParts = style.backgroundColor.match(/^rgba?\(([^)]+)\)$/)?.[1]
      .split(',').map(part => Number.parseFloat(part.trim())) ?? []
    const alpha = colorParts.length === 4 ? colorParts[3] : 1
    return !rail.classList.contains('preview-covered') && !hud.classList.contains('covered') &&
      Math.abs(Number.parseFloat(style.opacity) - 1) < 0.005 && Math.abs(alpha - 1) < 0.005
  }, 'nonintersecting region restores the opaque sidebar despite hudCovered')
  await page.evaluate(() => {
    document.dispatchEvent(new CustomEvent('mtga:e2e-layer', {
      detail: { cells: [], regions: [], covered: false, hudCovered: false }
    }))
  })

  await expectDraftSidebarGeometry(page, '04-sheet full sidebar remains restored and pointer-owning')
  await shot(page, '04-sheet')

  await feedUntil(nthPickNext(6)) // 6 more PickNext after P1P1 → P1P7 (8 cards)
  await waitFor(page, S => document.querySelectorAll(S.cell).length === 8, '8 cells at p1p7')
  await sleep(600)
  await expectSheetContained(page, 'P1P7 sheet stays inside the Arena rail')
  await shot(page, '05-p1p7')

  await feedUntil(nthPickNext(13)) // → P2P6
  await sleep(700)
  await expectSheetContained(page, 'P2P6 grouped pool stays in its internal-scroll viewport')
  await expectDraftSidebarGeometry(page, 'P2P6 sidebar pins the live 1512×949 right-column bounds')
  await shot(page, '06-p2p6')

  // Calibration mode through the HUD.
  await page.click(SEL.hudCalBtn).catch(e => failures.push(`calibrate button: ${e.message}`))
  await waitFor(page, S => {
    const rail = document.querySelector(S.rail)
    const panel = document.querySelector(S.calPanel)
    return !!rail && !rail.classList.contains('open') && rail.getAttribute('aria-hidden') === 'true' &&
      getComputedStyle(rail).pointerEvents === 'none' && !!panel && getComputedStyle(panel).pointerEvents === 'auto'
  }, 'calibration panel replaces the closed/noninteractive sidebar owner', 3000)
  await shot(page, '07-calibrate')
  await page.click(SEL.calCancel).catch(() => {})
  await waitFor(page, S => {
    const rail = document.querySelector(S.rail)
    return !document.querySelector(S.calPanel) && !!rail && rail.classList.contains('open') && !!document.querySelector(S.sheet)
  }, 'calibration closes back to the pinned sidebar', 3000)

  await feedUntil(() => false) // rest of the draft incl. Completed
  await waitFor(page, S => {
    const rail = document.querySelector(S.rail)
    const hud = document.querySelector(S.hud)
    const main = document.querySelector(S.hudMain)
    const sheet = document.querySelector(S.sheetRoot)
    const sheetBody = document.querySelector(S.sheetBody)
    const poolCards = [...document.querySelectorAll(`${S.sheetPool} .s-card`)]
    const poolCopies = poolCards.reduce((total, card) => {
      const copies = card.querySelector('.s-copy-count')?.textContent?.match(/\d+/)?.[0]
      return total + (copies ? Number(copies) : 1)
    }, 0)
    const visiblePoolCards = poolCards.filter(card => {
      const cardRect = card.getBoundingClientRect()
      const bodyRect = sheetBody?.getBoundingClientRect()
      return !!bodyRect && cardRect.bottom > bodyRect.top && cardRect.top < bodyRect.bottom
    })
    const gradeOrder = ['F', 'D-', 'D', 'D+', 'C-', 'C', 'C+', 'B-', 'B', 'B+', 'A-', 'A', 'A+']
    const nonLandGrades = poolCards.filter(card => !card.classList.contains('basic-land'))
      .map(card => gradeOrder.indexOf(card.querySelector('.s-grade')?.textContent?.trim() ?? ''))
    const bestToWorst = nonLandGrades.every((grade, index) => index === 0 || nonLandGrades[index - 1] >= grade)
    const pickLabels = [...document.querySelectorAll(`${S.sheetPool} .s-pick-labels`)]
      .flatMap(label => label.textContent?.match(/P\d+p\d+/g) ?? [])
    const lands = document.querySelector(`${S.sheetPool} [data-pool-section="lands"]`)
    const firstLand = document.querySelector(`${S.sheetPool} .s-card.basic-land`)
    const landsOrdered = (!lands && !firstLand) || (!!lands && !!firstLand && !!(lands.compareDocumentPosition(firstLand) & Node.DOCUMENT_POSITION_FOLLOWING))
    return !!rail && rail.classList.contains('open') && rail.classList.contains('interactive') &&
      !!hud && hud.classList.contains('complete') && hud.classList.contains('interactive') &&
      !hud.classList.contains('idle') && !!main && !main.hidden &&
      (hud.textContent ?? '').toLowerCase().includes('draft complete') &&
      !!sheet && sheet.classList.contains('open') && !!document.querySelector(S.sheet) &&
      document.querySelector(S.sheetRating)?.textContent?.startsWith('Pool rating ') &&
      poolCopies === 42 && pickLabels.length === 42 && bestToWorst && landsOrdered &&
      !document.querySelector('.sheet-picks') && visiblePoolCards.length > 0 && sheetBody?.scrollTop === 0 &&
      document.querySelectorAll(S.cell).length === 0
  }, 'completion sidebar keeps grouped ordered pool, pick labels, lands divider, and no badge leak', 6000)
  await sleep(500)
  await expectDraftSidebarGeometry(page, 'completion keeps the full opaque sidebar and bottom footer')
  await expectLongPoolScroll(page, 'long grouped pool scrolls internally without moving the pinned footer')
  await shot(page, '08-complete')

  // The explicit Dismiss control ends the linger immediately and leaves only
  // the fixed click-through idle glyph.
  await page.click(SEL.hudDismiss).catch(e => failures.push(`completion dismiss: ${e.message}`))
  await waitFor(page, S => {
    const visible = selector => {
      const el = document.querySelector(selector)
      if (!el || el.hidden) return false
      const style = getComputedStyle(el)
      const rect = el.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
    }
    const rail = document.querySelector(S.rail)
    const hud = document.querySelector(S.hud)
    const sheet = document.querySelector(S.sheetRoot)
    return !!rail && !rail.classList.contains('open') && rail.getAttribute('aria-hidden') === 'false' &&
      !!hud && hud.classList.contains('idle') && hud.classList.contains('idle-min') &&
      hud.classList.contains('hud-tr') && !hud.classList.contains('interactive') &&
      visible(S.hudIdle) && !visible(S.hudMain) && !!sheet && !sheet.classList.contains('open') &&
      !visible(S.sheetRoot) && document.querySelectorAll(S.cell).length === 0
  }, 'dismiss returns completion rail to the idle glyph', 3000)

  await browser.disconnect()
} catch (err) {
  failures.push(String(err))
} finally {
  app.kill('SIGTERM')
  await sleep(500)
  writeFileSync(join(OUT, 'console_main.log'), mainLog)
  writeFileSync(join(OUT, 'console_renderer.log'), consoleErrors.join('\n'))
  if (!KEEP) rmSync(tmp, { recursive: true, force: true })
}
if (consoleErrors.length) { console.error('renderer console errors:\n' + consoleErrors.join('\n')); failures.push('renderer console errors') }
if (failures.length) { console.error('E2E FAILED:\n - ' + failures.join('\n - ')); process.exit(1) }
console.log('E2E OK — shots in', OUT)

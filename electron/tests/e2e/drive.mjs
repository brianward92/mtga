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
  hud: '[data-testid="hud"]',
  hudPool: '#hudPool',
  hudIdle: '#hudIdle',
  hudIdleText: '.hud-idle-text',
  hudMain: '#hudMain',
  hudWarning: '#hudWarning',
  hudPick: '[data-testid="hud-pick"]',
  hudRank: '#recRank',
  hudRunners: '#hudRunners .hud-runner',
  hudProvenance: '[data-testid="hud-provenance"]',
  hudSheetBtn: '[data-testid="hud-btn-sheet"]',
  hudCalBtn: '[data-testid="hud-btn-calibrate"]',
  sheetRoot: '#sheet',
  sheetColours: '#sheetColours',
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
    const hud = document.querySelector(S.hud)
    const sheet = document.querySelector(S.sheetRoot)
    const badges = document.querySelector(S.badges)
    return !!hud && hud.classList.contains('idle') && hud.classList.contains('idle-min') &&
      hud.classList.contains('hud-tr') && !hud.classList.contains('interactive') &&
      visible(S.hudIdle) && !visible(S.hudIdleText) && !visible(S.hudMain) &&
      !visible(S.hudWarning) && document.querySelectorAll(S.cell).length === 0 &&
      !!badges && !visible(S.badges) && !!sheet && !sheet.classList.contains('open') &&
      !visible(S.sheetRoot) && !document.querySelector(S.sheet)
  }, 'idle renders only the click-through top-right glyph')
  await shot(page, '00-idle')

  await feedUntil(nthPickNext(1))
  await waitFor(page, S => document.querySelectorAll(S.cell).length === 14, '14 badge cells')
  await waitFor(page, S => !!document.querySelector(S.sheet), 'sheet open by default')
  await waitFor(page, S => {
    const provenance = document.querySelector(S.hudProvenance)
    const text = provenance?.textContent?.trim() ?? ''
    return !!provenance && !provenance.hidden && /^DraftFM \S+ · Scryfall \d{4}-\d{2}-\d{2}/.test(text)
  }, 'model and Scryfall snapshot provenance')
  await expectPage(page, S => {
    const chips = [...document.querySelectorAll(`${S.sheetColours} [data-colour]`)]
    return chips.map(chip => chip.getAttribute('data-colour')).join('') === 'WUBRG' &&
      chips.every(chip => /^\d+$/.test(chip.querySelector('b')?.textContent ?? ''))
  }, 'WUBRG pool counts in the sheet header')
  await expectPage(page, S => {
    const hud = document.querySelector(S.hud)
    const sheet = document.querySelector(S.sheetRoot)
    if (!hud || !sheet) return false
    const h = hud.getBoundingClientRect()
    const s = sheet.getBoundingClientRect()
    const hs = getComputedStyle(hud)
    const ss = getComputedStyle(sheet)
    return hud.classList.contains('with-sheet') && hud.classList.contains('sheet-below') &&
      sheet.classList.contains('stack-below') && Math.abs(h.bottom - s.top) <= 1 &&
      hs.borderBottomColor === 'rgba(0, 0, 0, 0)' && ss.borderTopColor === 'rgba(0, 0, 0, 0)' &&
      hs.borderBottomLeftRadius === '0px' && ss.borderTopLeftRadius === '0px' &&
      hs.boxShadow === 'none' && ss.boxShadow === 'none'
  }, 'HUD and pool sheet form one seamless rail')
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
    const pool = document.querySelector(`${S.hudPool} .hud-pool-bar`)
    return rank === '#1' && runners.length === 4 &&
      runners.map(row => row.querySelector('.hud-runner-rank')?.textContent?.trim()).join('') === '#2#3#4#5' &&
      runners.every(row => !!row.querySelector('.hud-runner-name')?.textContent?.trim() && !!row.querySelector('.hud-runner-grade')?.textContent?.trim()) &&
      !!meta?.textContent?.trim() && !!pool
  }, 'ranked top five, card metadata, grades, and pool bar')
  await shot(page, '02-p1p1-scored')

  const railBeforeHover = await page.evaluate(S => {
    const rec = document.querySelector(S.hudPick).getBoundingClientRect()
    const pool = document.querySelector(S.hudPool).getBoundingClientRect()
    const sheet = document.querySelector(S.sheetRoot).getBoundingClientRect()
    return { recHeight: rec.height, poolTop: pool.top, sheetTop: sheet.top }
  }, SEL)

  // Hover-to-detail: move the mouse over the 3rd cell.
  const rect = await page.evaluate(S => { const c = document.querySelectorAll(S.cell)[2]; const r = c.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } }, SEL)
  await page.mouse.move(rect.x, rect.y)
  await sleep(300)
  const railWhileHovering = await page.evaluate(S => {
    const rec = document.querySelector(S.hudPick).getBoundingClientRect()
    const pool = document.querySelector(S.hudPool).getBoundingClientRect()
    const sheet = document.querySelector(S.sheetRoot).getBoundingClientRect()
    return { recHeight: rec.height, poolTop: pool.top, sheetTop: sheet.top }
  }, SEL)
  if (Object.keys(railBeforeHover).some(key => Math.abs(railBeforeHover[key] - railWhileHovering[key]) > 1)) {
    failures.push(`hover reflowed rail: ${JSON.stringify({ before: railBeforeHover, hovering: railWhileHovering })}`)
  }
  await shot(page, '03-hover-detail')
  await page.mouse.move(5, 5)
  await sleep(100)

  // The pool sheet opens with the draft. Capture it, then close it via the HUD.
  await shot(page, '04-sheet')
  await page.click(SEL.hudSheetBtn).catch(e => failures.push(`sheet button: ${e.message}`))
  await waitFor(page, S => !document.querySelector(S.sheet), 'sheet closed', 3000)

  await feedUntil(nthPickNext(6)) // 6 more PickNext after P1P1 → P1P7 (8 cards)
  await waitFor(page, S => document.querySelectorAll(S.cell).length === 8, '8 cells at p1p7')
  await sleep(600)
  await shot(page, '05-p1p7')

  await feedUntil(nthPickNext(13)) // → P2P6
  await sleep(700)
  await shot(page, '06-p2p6')

  // Calibration mode through the HUD.
  await page.click(SEL.hudCalBtn).catch(e => failures.push(`calibrate button: ${e.message}`))
  await waitFor(page, S => !!document.querySelector(S.calPanel), 'calibration panel', 3000)
  await shot(page, '07-calibrate')
  await page.click(SEL.calCancel).catch(() => {})

  await feedUntil(() => false) // rest of the draft incl. Completed
  await waitFor(page, S => {
    const hud = document.querySelector(S.hud)
    const main = document.querySelector(S.hudMain)
    return !!hud && hud.classList.contains('complete') && hud.classList.contains('interactive') &&
      !hud.classList.contains('idle') && !!main && !main.hidden &&
      (hud.textContent ?? '').toLowerCase().includes('draft complete') &&
      document.querySelectorAll(S.cell).length === 0
  }, 'completion HUD with no badge leak', 6000)
  await sleep(500)
  await shot(page, '08-complete')

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

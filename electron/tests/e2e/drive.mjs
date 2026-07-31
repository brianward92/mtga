#!/usr/bin/env node
/**
 * Interactive E2E visual test harness: drives a complete fake Quick draft
 * through the REAL built app — no MTGA, no human — and captures screenshots
 * of every UI state.
 *
 * How it works:
 *   1. Builds a sandbox HOME (fresh config/prefs/DB; Arena's card DB
 *      symlinked in read-only so real card names resolve) and an empty fake
 *      Player.log, then launches the packaged app binary with
 *      MTGA_LOG_PATH=<tmp>/Player.log and --remote-debugging-port.
 *   2. Connects puppeteer-core over CDP and finds the two renderer pages
 *      (overlay / badges), asserting that no dashboard is created.
 *   3. Streams tests/e2e/fixtures/quickdraft_sos.log into the fake log
 *      line-by-line with pacing (the JS port of scripts/replay_player_log.py),
 *      pausing at checkpoints to wait for the overlay DOM to settle and
 *      screenshot every page into tests/e2e/shots/<step>_<page>.png.
 *   4. Dumps each page's console output to shots/console_<page>.log (plus the
 *      main process's stdout/stderr to console_main.log) and exits non-zero
 *      on missing steps or renderer console errors.
 *
 * Steps captured:
 *   boot, draft-start, pack1-verdict, pack1-scores, density-full,
 *   density-mini, mid-draft-p2p5, draft-end, post-draft
 *
 * Usage:
 *   npm run e2e                                  # live scores (real server)
 *   npm run e2e -- --scores-mode offline         # dead server: amber/red UI
 *   node tests/e2e/drive.mjs \
 *     [--app "/Applications/MTGA Draft Assistant.app/Contents/MacOS/MTGA Draft Assistant"] \
 *     [--scores-mode live|offline] [--server http://192.168.4.25:8100] \
 *     [--port 9222] [--speed 12] [--out tests/e2e/shots] [--keep-tmp]
 *
 * Scores modes:
 *   live    — the app talks to the real draft server; the fixture uses real
 *             SOS grp_ids so /score returns real EVs (green dot, flames).
 *   offline — serverUrls point at a dead port. The harness pre-seeds the
 *             ratings disk cache from --server when reachable, so the run
 *             shows red at boot and amber (stale cache) during the draft;
 *             if the seed fetch fails the whole run degrades to red.
 */

import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, createWriteStream } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const HERE = dirname(fileURLToPath(import.meta.url))

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    app: '/Applications/MTGA Draft Assistant.app/Contents/MacOS/MTGA Draft Assistant',
    fixture: join(HERE, 'fixtures/quickdraft_sos.log'),
    scoresMode: 'live',
    server: 'http://192.168.4.25:8100',
    port: 9222,
    speed: 12, // lines per second
    out: join(HERE, 'shots'),
    keepTmp: false
  }
  for (let i = 2; i < argv.length; i++) {
    const next = () => argv[++i]
    switch (argv[i]) {
      case '--app': args.app = next(); break
      case '--fixture': args.fixture = next(); break
      case '--scores-mode': args.scoresMode = next(); break
      case '--server': args.server = next(); break
      case '--port': args.port = Number(next()); break
      case '--speed': args.speed = Number(next()); break
      case '--out': args.out = next(); break
      case '--keep-tmp': args.keepTmp = true; break
      default: throw new Error(`unknown arg: ${argv[i]}`)
    }
  }
  if (!['live', 'offline'].includes(args.scoresMode)) {
    throw new Error(`--scores-mode must be live|offline, got ${args.scoresMode}`)
  }
  return args
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// ---------------------------------------------------------------------------
// Sandbox HOME + fake Player.log
// ---------------------------------------------------------------------------

/** Fresh HOME so config, prefs, DB, and caches never touch the real ones. */
function buildSandbox(args) {
  const root = mkdtempSync(join(tmpdir(), 'mtga-e2e-'))
  const home = join(root, 'home')
  const logDir = join(root, 'mtga-logs')
  const logPath = join(logDir, 'Player.log')
  mkdirSync(logDir, { recursive: true })
  writeFileSync(logPath, '')

  // Tracker config: server URLs per scores mode (port 9 is never listening)
  const trackerDir = join(home, '.mtga-tracker')
  mkdirSync(trackerDir, { recursive: true })
  const serverUrls = args.scoresMode === 'live' ? [args.server] : ['http://127.0.0.1:9']
  writeFileSync(join(trackerDir, 'config.json'), JSON.stringify({
    serverUrls,
    requestTimeoutMs: 3000,
    watchLegacyLogs: false
  }, null, 2))

  // UI prefs: start at verdict density, badges off.
  writeFileSync(join(trackerDir, 'overlay-position.json'), JSON.stringify({
    ui: { draftDensity: 'verdict', autoHideDashboard: false, badgesEnabled: false }
  }, null, 2))

  // Arena's own card DB (read-only SQLite) supplies real card names — link
  // the real one into the sandbox when this machine has Arena installed.
  const realArena = join(homedir(), 'Library/Application Support/com.wizards.mtga')
  const appSupport = join(home, 'Library/Application Support')
  mkdirSync(appSupport, { recursive: true })
  if (existsSync(realArena)) {
    symlinkSync(realArena, join(appSupport, 'com.wizards.mtga'))
  } else {
    console.warn('! Arena data dir not found — cards will render as "Unknown card"')
  }

  return { root, home, logPath, appSupport }
}

/**
 * Offline mode: seed the ratings disk cache so amber (stale) shows.
 *
 * Deliberately runs BEFORE the app boots: the ratings cache lives in
 * userData/ratings-cache/, which Chromium must never touch — surviving app
 * startup doubles as the regression test for the old userData/cache
 * location, where Chromium's disk cache (userData/Cache on case-insensitive
 * APFS) deleted foreign files during boot.
 */
async function seedRatingsCache(args, sandbox) {
  const url = `${args.server}/api/v1/ratings?set=SOS&format=QuickDraft`
  let data
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    data = await response.json()
  } catch (error) {
    console.warn(`! cache seed fetch failed (${error.message}) — offline run will be red-only`)
    return false
  }
  const staleFetchedAt = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString()
  const payload = JSON.stringify({ ...data, fetched_at: staleFetchedAt })
  // userData dir name = productName; cover the plain package name too
  for (const appName of ['MTGA Draft Assistant', 'MTGA Tracker', 'mtga-tracker']) {
    const cacheDir = join(sandbox.appSupport, appName, 'ratings-cache')
    mkdirSync(cacheDir, { recursive: true })
    writeFileSync(join(cacheDir, 'ratings-SOS-QuickDraft.json'), payload)
  }
  console.log('* seeded stale ratings cache (offline run will show amber)')
  return true
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

class Harness {
  constructor(args) {
    this.args = args
    this.notes = []
    this.captured = []
    this.failedSteps = []
    this.consoleLogs = { overlay: [], badges: [] }
    this.pages = {}
    this.lines = readFileSync(args.fixture, 'utf-8').split('\n').filter((l) => l.length > 0)
    this.lineIndex = 0
  }

  note(message) {
    this.notes.push(message)
    console.log(`  ! ${message}`)
  }

  // ---- app lifecycle ------------------------------------------------------

  async launch(sandbox) {
    // Refuse to run against someone else's debug port
    try {
      await fetch(`http://127.0.0.1:${this.args.port}/json/version`, { signal: AbortSignal.timeout(1000) })
      throw new Error(`something is already listening on CDP port ${this.args.port}`)
    } catch (error) {
      if (!/fetch failed|aborted|timeout/i.test(String(error.message))) throw error
    }

    mkdirSync(this.args.out, { recursive: true })
    const mainLog = createWriteStream(join(this.args.out, 'console_main.log'))
    this.child = spawn(this.args.app, [`--remote-debugging-port=${this.args.port}`], {
      env: {
        ...process.env,
        HOME: sandbox.home,
        MTGA_LOG_PATH: sandbox.logPath,
        // macOS ignores $HOME for appData — the app's MTGA_E2E hook moves
        // userData (DB, caches) into the sandbox explicitly.
        MTGA_E2E_USER_DATA: join(sandbox.appSupport, 'MTGA Draft Assistant')
      },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    this.child.stdout.pipe(mainLog, { end: false })
    this.child.stderr.pipe(mainLog, { end: false })
    this.exited = new Promise((resolve) => this.child.on('exit', resolve))

    // Wait for CDP
    const deadline = Date.now() + 30_000
    for (;;) {
      try {
        await fetch(`http://127.0.0.1:${this.args.port}/json/version`, { signal: AbortSignal.timeout(1000) })
        break
      } catch {
        if (Date.now() > deadline) throw new Error('CDP endpoint never came up')
        await sleep(300)
      }
    }
    this.browser = await puppeteer.connect({
      browserURL: `http://127.0.0.1:${this.args.port}`,
      defaultViewport: null
    })
    console.log('* connected over CDP')

    // The sandbox HOME must have taken: userData (DB, caches) lives there.
    const userDataDeadline = Date.now() + 15_000
    const candidates = ['MTGA Draft Assistant', 'MTGA Tracker', 'mtga-tracker']
      .map((n) => join(sandbox.appSupport, n, 'data'))
    while (!candidates.some((p) => existsSync(p))) {
      if (Date.now() > userDataDeadline) {
        throw new Error(
          'sandbox HOME was ignored (no userData under the temp dir) — refusing to pollute the real tracker DB'
        )
      }
      await sleep(300)
    }
    console.log('* sandbox userData confirmed')
  }

  async findPages() {
    const wanted = { overlay: '/overlay/', badges: '/badges/' }
    const deadline = Date.now() + 20_000
    while (Object.keys(this.pages).length < 2) {
      for (const page of await this.browser.pages()) {
        const url = page.url()
        for (const [name, marker] of Object.entries(wanted)) {
          if (!this.pages[name] && url.includes(marker)) {
            this.pages[name] = page
            const buf = this.consoleLogs[name]
            page.on('console', (msg) => buf.push(`[${msg.type()}] ${msg.text()}`))
            page.on('pageerror', (err) => buf.push(`[pageerror] ${err.message}`))
          }
        }
      }
      if (Object.keys(this.pages).length === 2) break
      if (Date.now() > deadline) {
        throw new Error(`only found pages: ${Object.keys(this.pages).join(', ') || 'none'}`)
      }
      await sleep(300)
    }
    await sleep(500)
    const dashboard = (await this.browser.pages()).find((page) => page.url().includes('/dashboard/'))
    if (dashboard) throw new Error('dashboard renderer should not exist in overlay-only mode')
    console.log('* found renderer pages: overlay, badges (no dashboard)')
  }

  async shutdown(sandbox) {
    try { if (this.browser) this.browser.disconnect() } catch {}
    if (this.child && this.child.exitCode === null) {
      this.child.kill('SIGTERM')
      const exited = await Promise.race([this.exited, sleep(5000).then(() => 'timeout')])
      if (exited === 'timeout') this.child.kill('SIGKILL')
    }
    if (sandbox && !this.args.keepTmp) rmSync(sandbox.root, { recursive: true, force: true })
    else if (sandbox) console.log(`* kept tmp dir: ${sandbox.root}`)
  }

  // ---- log feeding (JS port of scripts/replay_player_log.py) ---------------

  /** Append fixture lines (paced) until `predicate(line)` matches, inclusive. */
  async feedUntil(sandboxLogPath, predicate, label) {
    const delay = 1000 / this.args.speed
    while (this.lineIndex < this.lines.length) {
      const line = this.lines[this.lineIndex++]
      appendFileSync(sandboxLogPath, line + '\n')
      await sleep(delay)
      if (predicate(line)) return
    }
    throw new Error(`fixture exhausted before: ${label}`)
  }

  // ---- DOM waits + screenshots ---------------------------------------------

  async waitOverlay(description, fn, timeoutMs = 25_000) {
    const start = Date.now()
    for (;;) {
      try {
        if (await this.pages.overlay.evaluate(fn)) return
      } catch {}
      if (Date.now() - start > timeoutMs) throw new Error(`timeout waiting for ${description}`)
      await sleep(150)
    }
  }

  async shoot(step, { settleMs = 400 } = {}) {
    await sleep(settleMs)
    for (const [name, page] of Object.entries(this.pages)) {
      const file = `${step}_${name}.png`
      try {
        await Promise.race([
          page.screenshot({ path: join(this.args.out, file) }),
          sleep(5000).then(() => { throw new Error('timeout (window hidden?)') })
        ])
        this.captured.push(file)
      } catch (error) {
        this.note(`${file}: not captured — ${error.message}`)
      }
    }
    console.log(`* step captured: ${step}`)
  }

  async step(name, fn) {
    try {
      await fn()
    } catch (error) {
      this.failedSteps.push(name)
      this.note(`step ${name} FAILED: ${error.message}`)
    }
  }

  // ---- the scripted draft ---------------------------------------------------

  async run(sandbox) {
    const live = this.args.scoresMode === 'live'
    const feed = (predicate, label) => this.feedUntil(sandbox.logPath, predicate, label)
    const clickOverlay = (id) => this.pages.overlay.evaluate((elId) => {
      const el = document.getElementById(elId)
      if (!el) throw new Error(`#${elId} not found`)
      el.click()
    }, id)

    // -- boot: match-mode overlay only, no draft yet
    await this.step('boot', async () => {
      await this.waitOverlay('overlay DOM ready', () => !!document.getElementById('overlay'))
      await this.shoot('01_boot', { settleMs: 1200 })
    })

    // -- draft-start: EventJoin only — panel flips to draft mode, no pack yet
    await this.step('draft-start', async () => {
      await feed((l) => l.includes('==> EventJoin'), 'EventJoin')
      await this.waitOverlay('draft mode', () =>
        document.getElementById('overlay').classList.contains('draft-mode'))
      await this.shoot('02_draft-start')
    })

    // -- pack1-verdict: first pack rendered (scores may still be pending)
    await this.step('pack1-verdict', async () => {
      await feed((l) => l.includes('BotDraftDraftStatus'), 'first pack status')
      await this.waitOverlay('P1P1 pack rows', () =>
        document.getElementById('draftPickPos').textContent === 'P1P1' &&
        document.querySelectorAll('#packTable [data-grpid]').length > 0)
      await this.shoot('03_pack1-verdict', { settleMs: 150 })
    })

    // -- pack1-scores: model scores landed (live) / degradation state (offline)
    await this.step('pack1-scores', async () => {
      if (live) {
        await this.waitOverlay('flame row', () =>
          !!document.querySelector('#verdictView .flame.lit'))
      } else {
        await this.waitOverlay('degraded score placeholder', () =>
          !!document.querySelector('#verdictView .flame-pending'))
      }
      await this.shoot('04_pack1-scores', { settleMs: 1000 }) // let flames stagger in
    })

    // -- density cycle: verdict -> full -> mini -> verdict
    await this.step('density-full', async () => {
      await clickOverlay('densityBtn')
      await this.waitOverlay('full density', () =>
        document.getElementById('overlay').classList.contains('density-full'))
      await this.shoot('05_density-full', { settleMs: 700 }) // window resize animates
    })

    await this.step('density-mini', async () => {
      await clickOverlay('densityBtn')
      await this.waitOverlay('mini density', () =>
        document.getElementById('overlay').classList.contains('density-mini'))
      await this.shoot('06_density-mini', { settleMs: 700 })
    })

    await this.step('density-restore', async () => {
      await clickOverlay('densityBtn')
      await this.waitOverlay('verdict density', () =>
        document.getElementById('overlay').classList.contains('density-verdict'))
    })

    // -- mid-draft: P2P5 on screen with pool strip progress + pick history
    await this.step('mid-draft-p2p5', async () => {
      await feed(
        (l) => l.includes('PickNext') && l.includes('\\"PackNumber\\": 1, \\"PickNumber\\": 4'),
        'P2P5 status'
      )
      await this.waitOverlay('P2P5 rendered', () =>
        document.getElementById('draftPickPos').textContent === 'P2P5')
      if (live) {
        await this.waitOverlay('P2P5 flames', () =>
          !!document.querySelector('#verdictView .flame.lit'))
      }
      await this.shoot('07_mid-draft-p2p5', { settleMs: 900 })
    })

    // -- draft-end: Completed status -> "Draft complete" card
    await this.step('draft-end', async () => {
      await feed((l) => l.includes('\\"DraftStatus\\": \\"Completed\\"'), 'Completed status')
      await this.waitOverlay('draft complete card', () =>
        !!document.querySelector('#verdictView .draft-complete'))
      await this.shoot('08_draft-end')
    })

    // -- post-draft: dismiss -> panel hands back to the match view
    await this.step('post-draft', async () => {
      await clickOverlay('draftDismissBtn')
      await this.waitOverlay('match mode restored', () =>
        !document.getElementById('overlay').classList.contains('draft-mode'))
      await this.shoot('09_post-draft', { settleMs: 800 })
    })
  }

  // ---- reporting ------------------------------------------------------------

  writeConsoleLogs() {
    let errors = 0
    for (const [name, lines] of Object.entries(this.consoleLogs)) {
      writeFileSync(join(this.args.out, `console_${name}.log`), lines.join('\n') + '\n')
      errors += lines.filter((l) => l.startsWith('[error]') || l.startsWith('[pageerror]')).length
    }
    return errors
  }

  report(errors) {
    console.log('\n================ E2E SUMMARY ================')
    console.log(`mode: ${this.args.scoresMode}   shots dir: ${this.args.out}`)
    console.log(`captured (${this.captured.length}):`)
    for (const file of this.captured) console.log(`  ${file}`)
    if (this.failedSteps.length) console.log(`FAILED steps: ${this.failedSteps.join(', ')}`)
    if (this.notes.length) {
      console.log('notes:')
      for (const n of this.notes) console.log(`  - ${n}`)
    }
    console.log(`renderer console errors: ${errors}`)
    console.log('=============================================')
  }
}

// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv)
  console.log(`* scores mode: ${args.scoresMode}`)
  const sandbox = buildSandbox(args)
  if (args.scoresMode === 'offline') await seedRatingsCache(args, sandbox)

  const harness = new Harness(args)
  let errors = 0
  try {
    await harness.launch(sandbox)
    await harness.findPages()
    await harness.run(sandbox)
  } finally {
    errors = harness.writeConsoleLogs()
    await harness.shutdown(sandbox)
  }
  harness.report(errors)
  process.exit(harness.failedSteps.length > 0 || errors > 0 ? 1 : 0)
}

main().catch((error) => {
  console.error(`fatal: ${error.message}`)
  process.exit(2)
})

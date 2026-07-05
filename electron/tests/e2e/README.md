# E2E visual test harness

Drives a complete fake SOS Quick draft through the REAL packaged app — no
MTGA, no human — and screenshots every UI state. An AI agent (or you) can
inspect the shots for layout regressions after any overlay change.

## How it works

`drive.mjs` launches the built app binary with a sandboxed `HOME` (fresh
config/prefs/DB — the real tracker data is never touched; Arena's card DB is
symlinked in read-only for card names) and `MTGA_LOG_PATH` pointed at a fake
`Player.log` in a temp dir. It connects `puppeteer-core` over CDP
(`--remote-debugging-port`), then streams
`fixtures/quickdraft_sos.log` into the fake log line-by-line with pacing
(a JS port of `scripts/replay_player_log.py`), pausing at checkpoints to wait
on the overlay DOM and capture PNGs of all three renderer pages
(dashboard / overlay / badges).

## Running

```sh
cd electron
npm run e2e                              # live scores from the real server
npm run e2e -- --scores-mode offline     # dead server: amber/red degradation
npm run e2e -- --app "/path/to/MTGA Tracker.app/Contents/MacOS/MTGA Tracker"
```

Windows pop up on screen while it runs (the real app, real windows). Full
flag list is documented at the top of `drive.mjs`.

The target app must include the `MTGA_E2E_USER_DATA` hook in
`main/index.ts` (builds after 2026-07-04); against older builds the harness
aborts rather than write into the real tracker DB. If `/Applications` holds
an older build, package a fresh one (`npm run build && npx electron-builder
--dir`) and pass
`--app release/mac-arm64/MTGA Tracker.app/Contents/MacOS/MTGA Tracker`.

## Steps captured (`shots/<step>_<page>.png`)

| step | what it shows |
| --- | --- |
| `01_boot` | dashboard + match-mode overlay, no draft |
| `02_draft-start` | EventJoin only: draft panel up, "waiting for pack…" |
| `03_pack1-verdict` | P1P1 pack rendered (on a fast LAN the live scores usually beat this shot, making it identical to `04`) |
| `04_pack1-scores` | flames/conviction landed (live) or degradation state (offline) |
| `05_density-full` | full density: ranked table + pool + history |
| `06_density-mini` | mini density: one-line top pick |
| `07_mid-draft-p2p5` | P2P5: pool strip progress, pick history count |
| `08_draft-end` | "Draft complete" card |
| `09_post-draft` | dismissed: overlay back in match mode |

Between `01_boot` and `02_draft-start` the harness also runs a
**dashboard-alive** check (no screenshot): it clicks the "Draft Overlay"
toggle over CDP and asserts the pill text and the real overlay visibility
both flip — the regression test for the packaged-dashboard-loaded-source-HTML
bug, where the shipped dashboard had no working JS at all.

Also written: `console_<page>.log` per renderer plus `console_main.log`
(main-process stdout/stderr). The run exits non-zero on missing steps or any
renderer console error. The badge window stays hidden without a real Arena
window and deliberately renders NOTHING while hidden (idle-badges guard), so
its shots are expected to be blank — badge chip logic is covered by unit
tests and by the conviction modules it shares with the panel.

## Scores modes

- **live** — the app talks to the real draft server (default
  `http://192.168.4.25:8100`). The fixture uses real SOS grp_ids, so
  `/api/v1/score` returns real EVs: green dot, flames, conviction labels.
- **offline** — `serverUrls` points at a dead port. The harness seeds
  `userData/ratings-cache/` from `--server` before boot (when reachable), so
  the run shows red at boot and amber ("stats only (cached …)") during the
  draft. If the seed fetch fails, everything degrades to red (names only).
  Seeding pre-boot doubles as the regression test for the old
  `userData/cache` location, which Chromium wiped during startup.

## Fixture

`fixtures/quickdraft_sos.log` is generated (deterministically) by
`scripts/make_e2e_fixture.py`: a full 3×14-pick Quick draft in exact
`BotDraftDraftStatus`/`BotDraftDraftPick` log shapes, using real SOS grp_ids
mapped from the model's vocab via the 17Lands card store. Regenerate with:

```sh
python3 scripts/make_e2e_fixture.py
```

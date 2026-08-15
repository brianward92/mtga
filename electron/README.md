# MTGA Draft Assistant

A lightweight deck tracker and overlay for Magic: The Gathering Arena on macOS.

This is separate from MTG Registry, the live web card database and physical
inventory tracker served from `app/` on port `8000`. The Electron app is not the
prod web service.

## Features

- **Deck Tracker Overlay**: See remaining cards in your deck during matches
- **Arena Glue**: The panel snaps magnetically to screen and Arena edges,
  follows the Arena window when it moves, and rescales with it when it
  resizes (Untapped-style). Toggle via the menu-bar item ("Glue Overlay to
  Arena"); when Arena isn't running the panel free-floats where you left it.
- **Card Badges**: Per-card overlays drawn on Arena's pack grid — a frame
  around each card tinted by strength, a chip with the model grade, flame
  rating and head-to-head %, #1/#2/#3 rank tags and the LEAN/SLAM label on the
  top pick. Toggle via the menu-bar item ("Show Card Badges"); they only draw
  while Arena (or the assistant) is the front app. Cards are matched to screen
  cells using Arena's display order (rarity, then colour, then name), not the
  log order. If the grid doesn't line up for your window size, run "Calibrate
  Card Badges" once.
- **Arena Layer Detection**: Arena's hover preview and modals (Options…) are
  drawn inside Arena's own window, so no overlay can sit between them and the
  pack. Instead the app captures Arena's window (our overlays are excluded),
  keeps a "clear" baseline of the pack and per-cell diffs each frame: badges
  under a preview of any shape lift, the whole set lifts under a modal scrim
  or when the pack isn't on screen (Home, deck list), and the panel steps
  aside when covered. Needs macOS **Screen Recording** for the app (menu bar
  → "Arena Layer Detection: needs Screen Recording…" opens the pane; relaunch
  after granting). Without it, a geometric prediction of the hover preview is
  used instead.
- **Smooth Arena following**: a bundled native helper
  (`native/arena-window-watch.swift`, built by `npm run build`) streams the
  Arena window frame at ~30 Hz via CGWindowList, so the panel and badges ride
  along with a live drag/resize instead of snapping afterwards. AppleScript
  polling remains as the fallback (and needs Accessibility).
- **Win/Loss Tracking**: Automatic match history with statistics
- **Collection Tracking**: Syncs your MTGA collection from game logs
- **Inventory Tracking**: Gems, gold, wildcards, vault progress

## Requirements

- macOS (tested on 10.15+)
- MTG Arena installed
- "Detailed Logs (Plugin Support)" enabled in MTGA settings

## Setup

### 1. Enable Detailed Logs in MTGA

Open MTGA and go to: **Options > Account > Detailed Logs (Plugin Support)** and toggle it **ON**.

### 2. Install Dependencies

```bash
cd electron
npm install
```

### 3. Card Data

Card data is read directly from Arena's own card database
(`~/Library/Application Support/com.wizards.mtga/Downloads/Raw/Raw_CardDatabase_*.mtga`)
at startup and snapshotted to the app cache — no build step required.
`scripts/build_arena_mapping.py` remains available as an optional offline seed.

### 4. Run in Development Mode

```bash
cd electron
npm run dev
```

### 5. Build for Production

```bash
npm run build
npm run package
```

The packaged app will be in `electron/release/`.

## Usage

1. Start MTGA Draft Assistant before or during a MTGA session
2. The overlay opens as the app's only window
3. Drag its top grip to position it over Arena
4. Start a match in MTGA - the deck tracker will populate automatically
5. Cards drawn will be marked and counts updated in real-time

The menu-bar item shows the draft server, active model, and current draft
position. The Dock icon and menu-bar item reopen a hidden overlay; badge
calibration and Quit remain available from the menu bar.

### Overlay Controls

- **Cmd+W**: Hide the overlay while the tracker keeps running
- **Cmd+M**: Minimize the overlay normally
- **Cmd+Q**: Quit the app and stop the tracker cleanly
- **Cmd+Shift+D**: Cycle Verdict, Full, and Mini draft views
- **Three-line button**: Cycle the same draft views without a shortcut
- **Drag header**: Reposition the overlay — it snaps to screen edges, and to
  the Arena window's edges (inside corners or docked flush outside) while
  Arena is tracked. Wherever you drop it becomes its anchor: the panel then
  rides along with Arena moves/resizes until you toggle "Glue Overlay to
  Arena" off in the menu bar. Locating the Arena window needs the
  **Accessibility** permission (System Settings > Privacy & Security >
  Accessibility), same as badge calibration.

Automatic draft updates use `showInactive()` and do not take focus from Arena.
An intentional launch, Dock click, menu-bar click, or overlay click focuses the
assistant so its standard Mac shortcuts work.

### Deploy to the MacBook

Use the checked deployment path from `electron/`:

```bash
npm run deploy:mbp
```

The command refuses to update a running app, runs typecheck/tests/build, stages
and verifies the arm64 `better-sqlite3` binary, updates the existing
`/Applications/MTGA Draft Assistant.app` bundle in place, and preserves its
Dock identity. It leaves the app closed by default. For an intentional
interactive smoke test only:

```bash
npm run deploy:mbp -- --launch
```

Do not deploy only `app.asar`: the packaged native SQLite binary must be
updated and architecture-checked with it. The bundle PNG and ICNS are deployed
together; packaged builds never replace the Dock icon at runtime.

## Data Storage

- **Database**: `~/Library/Application Support/mtga-tracker/data/mtga-tracker.db`
- **Card Data**: Arena's `Raw_CardDatabase_*.mtga` (snapshot cached under the app's `cache/` dir)
- **Config**: `~/.mtga-tracker/config.json` (draft server URLs, timeouts)

## Log File Location

MTGA logs are read from the canonical detailed log:
```
~/Library/Logs/Wizards Of The Coast/MTGA/Player.log   (+ Player-prev.log at startup)
```
Set the `MTGA_LOG_PATH` env var to point at a different file for replay testing.
The legacy `~/Library/Application Support/com.wizards.mtga/Logs/Logs/UTC_Log - *.log`
directory is still tailed as a secondary source (config: `watchLegacyLogs`).

For testing without a running Arena, `MTGA_FAKE_ARENA_FILE` can point at a
JSON file (`{"x":0,"y":33,"width":1512,"height":949}`); geometry probes read
it instead of System Events, and rewriting the file "moves" the window.

### Native module ABIs (better-sqlite3)

The canonical `node_modules/better-sqlite3` binary is compiled for
**Electron's** ABI (a `postinstall` electron-rebuild keeps it that way), so
`npm run dev` works after any install. Vitest runs under system Node, so
`vitest.config.ts` aliases `better-sqlite3` to `better-sqlite3-node` — a
second npm-alias install of the same package at the system-Node ABI. Both
`npm test` and `npm run dev` therefore work back-to-back with no rebuild
dance; `deploy:mbp` stages from (and restores) the Electron-ABI binary.

## Architecture

```
electron/
├── main/           # Main process (Node.js)
│   ├── parser/     # Log parsing logic
│   ├── data/       # Database & card registry
│   └── windows/    # Window management
└── renderer/       # Renderer process (UI)
    └── overlay/    # Deck tracker overlay
```

## Troubleshooting

### Overlay not appearing over MTGA
- Grant Screen Recording permission: **System Preferences > Security & Privacy > Privacy > Screen Recording**
- Add the MTGA Draft Assistant app to the allowed list

### No match data showing
- Verify "Detailed Logs" is enabled in MTGA settings
- Restart MTGA after enabling logs
- Check that log files exist in the log directory

### Card names showing as "Unknown Card #12345"
- Run `python3 scripts/build_arena_mapping.py` to update card data
- New sets may require updating the card mapping

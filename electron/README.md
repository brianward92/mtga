# MTGA Tracker

A lightweight deck tracker and overlay for Magic: The Gathering Arena on macOS.

## Features

- **Deck Tracker Overlay**: See remaining cards in your deck during matches
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

### 3. Build Card Data (optional, included in repo)

```bash
cd ..
python3 scripts/build_arena_mapping.py
```

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

1. Start MTGA Tracker before or during a MTGA session
2. The overlay appears in the top-right corner of your screen
3. Start a match in MTGA - the deck tracker will populate automatically
4. Cards drawn will be marked and counts updated in real-time

### Overlay Controls

- **Minimize button (−)**: Collapse the overlay to just the header
- **Drag header**: Reposition the overlay (when expanded)

## Data Storage

- **Database**: `~/Library/Application Support/mtga-tracker/data/mtga-tracker.db`
- **Card Data**: `data/arena_mapping.json` (16,000+ cards)

## Log File Location

MTGA logs are read from:
```
~/Library/Application Support/com.wizards.mtga/Logs/Logs/UTC_Log - *.log
```

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
- Add the MTGA Tracker app to the allowed list

### No match data showing
- Verify "Detailed Logs" is enabled in MTGA settings
- Restart MTGA after enabling logs
- Check that log files exist in the log directory

### Card names showing as "Unknown Card #12345"
- Run `python3 scripts/build_arena_mapping.py` to update card data
- New sets may require updating the card mapping

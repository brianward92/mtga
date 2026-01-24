# MTG Registry

A zero-dependency, local-first Magic: The Gathering card browser and inventory tracker for browsing sets, filtering by color/name, and tracking on-hand counts.

## Features

- Browse 22 MTG sets (MH2 through TLA) with 9,720+ cards
- Filter by set, color, and name search
- Navigate cards with prev/next buttons or arrow keys
- Track inventory counts per card (negative counts allowed for tracking owed cards)
- All data stored locally in browser `localStorage` - never leaves your machine
- View card images and pricing data from Scryfall

## Quick Start

From the repository root:

```bash
./scripts/run_app.sh
```

This will:
1. Build card data from processed parquet files for all default sets
2. Start a local web server on http://localhost:8000
3. Auto-cleanup generated files when you press Ctrl+C

Then open http://localhost:8000 in your browser.

## Manual Usage

### Build card data

Generate `app/data/cards.js` from processed Scryfall data:

```bash
# Build all default sets (22 sets)
python scripts/build_app_data.py

# Or specify particular sets
python scripts/build_app_data.py --sets DMU BRO MOM LCI
```

Default sets (in release order):
MH2, NEO, SNC, DMU, BRO, ONE, MOM, LTR, WOE, LCI, MKM, OTJ, MH3, BLB, DSK, FDN, DFT, TDM, FIN, EOE, SPM, TLA

### Start the web server

```bash
cd app
python3 -m http.server 8000
open http://localhost:8000
```

### Cleanup

The generated `app/data/cards.js` file can be deleted after use. If using `run_app.sh`, this happens automatically on exit.

## Running as a Service (24/7)

To run the app as a persistent macOS service:

### Setup

The service runs as your user account. You need to:

1. **Install the service:**
   ```bash
   sudo ./scripts/manage_service.sh install
   ```

2. **Check status:**
   ```bash
   ./scripts/manage_service.sh status
   ```

### Management Commands

```bash
# View all options
./scripts/manage_service.sh help

# Common operations (require sudo)
sudo ./scripts/manage_service.sh start
sudo ./scripts/manage_service.sh stop
sudo ./scripts/manage_service.sh restart
sudo ./scripts/manage_service.sh uninstall

# View logs (no sudo needed)
./scripts/manage_service.sh logs        # error logs
./scripts/manage_service.sh logs access # access logs
```

The service:
- Runs on port 8000, accessible at http://localhost:8000
- Auto-starts on system boot
- Restarts automatically if it crashes
- Logs to `/var/log/mtga/access.log` and `/var/log/mtga/error.log`

## Data Pipeline

The app uses processed Scryfall data. To update:

```bash
# 1. Download latest Scryfall bulk data
python scripts/run_scryfall_download.py

# 2. Process into parquet format
python scripts/run_scryfall_processor.py

# 3. Rebuild app data
python scripts/build_app_data.py
```

Processed data is stored in `/opt/{user}/dat/mtga/processed/` as parquet files.

## Inventory Storage

- Inventory counts are stored in browser `localStorage` per set
- Storage key format: `mtg_registry_v1_<SETCODE>`
- Use "Clear registry" button to reset counts for current set
- Data persists across browser sessions but stays local to your machine

## Technical Details

### File Structure

```
app/
  index.html      # Main app UI
  script.js       # Client-side logic (grouping, filtering, inventory)
  style.css       # Styling
  data/
    cards.js      # Generated card data (window.MTG_CARDS)
```

### Card Data Format

Cards are loaded as a flat array in `window.MTG_CARDS`, then grouped by set in the browser:

```javascript
window.MTG_CARDS = [
  {
    "id": "unique-uuid",
    "name": "Card Name",
    "setCode": "DMU",
    "setName": "Dominaria United",
    "collectorNumber": "123",
    "colors": ["R", "G"],
    "typeLine": "Creature — Dragon",
    "rarity": "rare",
    "valueHint": "$5.99",
    "imageUrl": "https://..."
  },
  ...
]
```

The JavaScript groups these by `setCode` on page load for the set dropdown.

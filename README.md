# MTGA Repo

This repo contains the live MTG Registry card database and inventory tracker
plus supporting Magic card data tools.

## Live Product: MTG Registry

MTG Registry is the card database browser and physical inventory tracker served
from `app/`.

- Local URL on the prod box: <http://localhost:8000>
- LAN URL currently observed on this box: <http://192.168.4.25:8000>
- Inventory counts are stored in each browser's `localStorage` under
  `mtg_registry_v1_<SETCODE>`.
- The server does not store inventory counts.

The app is intentionally local-first. Card data is loaded from generated JSON
files under `app/data/`, and inventory edits happen entirely in the browser.

## Card Database Pipeline

The card database comes from Scryfall bulk data:

1. `scripts/run_scryfall_download.py` downloads the latest Scryfall
   `all_cards` payload into `/opt/$USER/dat/mtga/scryfall/`.
2. `scripts/run_scryfall_processor.py` converts that raw JSON into parquet
   files under `/opt/$USER/dat/mtga/processed/`.
3. `scripts/build_app_data.py` converts those parquet files into the web app's
   lazy-load schema v4 JSON files:
   - `app/data/manifest.json`
   - `app/data/manifest.json.gz`
   - `app/data/sets/<SETCODE>.json`
   - `app/data/sets/<SETCODE>.json.gz`

Set files use compact row arrays:

```json
{"schemaVersion":4,"setCode":"MSH","fields":["id","name"],"cards":[["...","..."]]}
```

The full v4 field list is `id`, `name`, `collectorNumber`, `colors`,
`manaCost`, `typeLine`, `rarity`, `priceUsd`, `priceUsdFoil`,
`priceUsdEtched`, `valueHint`, `imageSmallUrl`, and `imageNormalUrl`.
The processor writes both Scryfall `small` and `normal` image URLs; older
processed data with only `image_url` still builds by using it as the normal
fallback.

Default app builds use a strict union: the historical inventory baseline plus
released Scryfall `expansion` sets discovered from `sets.parquet`. That makes
new main sets appear automatically after the nightly Scryfall refresh without
adding commander decks, tokens, promos, or art-series sets to the normal
dropdown.

Generated app data is ignored by git and rebuilt by the runtime script. If
`app/data/images/` exists as a generated thumbnail directory or symlink, the
manifest advertises the set codes with enough local thumbnail coverage and the
browser tries those local thumbnails before falling back to Scryfall `small`
image URLs. The runtime script fills this cache for the default set so the first
viewport does not depend on a cold Scryfall image request.

## Prod Runtime

This box runs MTG Registry with cron plus a detached `screen` session.

Crontab entries:

- `00 00 * * * /Users/bward/src/mtga/scripts/daily_00_nyt.sh`
- `0 0 * * * /Users/bward/src/mtga/scripts/run_app.sh`

The app runtime is:

- `screen` session name: `mtga`
- server command: `scripts/serve_app.py`
- bind address: `0.0.0.0`
- port: `8000`

The server sends no-store headers for the app shell and manifest. Generated set
JSON is versioned by manifest `buildId`, served with immutable cache headers,
and sent from the precompressed `.json.gz` sidecar when the browser accepts
gzip. The browser decodes only the current/recent sets in a small LRU cache and
prefetches the other set files into the HTTP cache after the first card renders.
Card images load from Scryfall `small` URLs first, then only the current card is
upgraded to `normal` during idle time. The live image preload cache is capped at
the current card plus nearby cards.

Health checks:

```bash
screen -ls
lsof -nP -iTCP:8000 -sTCP:LISTEN
curl -fsS -I http://127.0.0.1:8000/
```

Healthy means:

- `screen -ls` shows a detached `mtga` session.
- `lsof` shows Python listening on `*:8000`.
- `curl` returns `HTTP/1.0 200 OK`.

Restart:

```bash
/Users/bward/src/mtga/scripts/run_app.sh
```

## Secondary App: MTGA Tracker

`electron/` contains a separate Electron desktop app named MTGA Tracker. It is
for MTG Arena log parsing, overlay display, match history, and Arena inventory
snapshots. It is not the web inventory app served on port `8000`.

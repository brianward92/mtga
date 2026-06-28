# MTGA Repo

This repo contains the live MTG Registry web app plus supporting Magic card data
tools.

## Live Product: MTG Registry

MTG Registry is the card browser and physical inventory tracker served from
`app/`.

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
   lazy-load JSON files:
   - `app/data/manifest.json`
   - `app/data/sets/<SETCODE>.json`

Generated app data is ignored by git and rebuilt by the runtime script.

## Prod Runtime

This box runs MTG Registry with cron plus a detached `screen` session.

Crontab entries:

- `00 00 * * * /Users/bward/src/mtga/scripts/daily_00_nyt.sh`
- `0 0 * * * /Users/bward/src/mtga/scripts/run_app.sh`

The app runtime is:

- `screen` session name: `mtga`
- server command: Python `http.server`
- bind address: `0.0.0.0`
- port: `8000`

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

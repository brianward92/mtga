# MTGA / DraftFM

This repository contains DraftFM research code and paper artifacts, plus the
MTG Registry web app and MTGA Draft Assistant desktop app.

## DraftFM Research

DraftFM is a cross-set draft model that scores unseen Magic sets from public
card features. Its frozen MSH evaluation reached 57.0% top-1 agreement with
high-win-rate players. Start here:

- Main paper: [`paper/draftfm.pdf`](paper/draftfm.pdf)
- Reproducibility companion: [`paper/companion.pdf`](paper/companion.pdf)
- Frozen protocol and post-evaluation chronology: [`docs/eval_protocol.md`](docs/eval_protocol.md)
- Exact paper run pins and checkpoint hashes: [`paper/data/run_manifest.json`](paper/data/run_manifest.json)
- Experiment ledger: [`experiments/ledger.jsonl`](experiments/ledger.jsonl)

The repository currently includes code, frozen summaries, and generated paper
outputs. The model weights and per-pick prediction archive are not published
yet, so this is not yet a clean-clone reproduction release. With the pinned run
artifacts available under `$MTGA_DATA_ROOT/foundation`, regenerate the tables
with:

```bash
.venv-ml/bin/python scripts/make_paper_tables.py
```

The generator refuses missing or mismatched pinned runs instead of silently
selecting a newer local experiment.

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
   - `app/data/index.html`
   - `app/data/bootstrap.js`
   - `app/data/bootstrap.js.gz`
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
gzip. Startup serves generated `data/index.html` at `/`; it already contains
the default card metadata and local thumbnail before JavaScript runs. Hydration
then uses `data/bootstrap.js`, which contains the manifest plus the default set
payload, so the default set renders without fetching manifest or set JSON from
app code. The browser decodes only the current/recent sets in a small LRU cache
and delays other set prefetches until after startup. Card images load from local
thumbnails or Scryfall `small` URLs first, then only the current card is
upgraded to `normal` after startup idle time. The live image preload cache is
capped at the current card plus nearby cards.

Health checks:

```bash
screen -ls
lsof -nP -iTCP:8000 -sTCP:LISTEN
curl -fsS -I http://127.0.0.1:8000/
```

Healthy means:

- `screen -ls` shows a detached `mtga` session.
- `lsof` shows Python listening on `*:8000`.
- `curl` returns `200 OK`.

Restart:

```bash
/Users/bward/src/mtga/scripts/run_app.sh
```

## Secondary App: MTGA Draft Assistant

`electron/` contains a separate Electron desktop app named MTGA Draft Assistant. It is
for MTG Arena log parsing, overlay display, match history, and Arena inventory
snapshots. It is not the web inventory app served on port `8000`.

## Draft Assistant

A self-hosted draft advisor: this box holds the
data, trains the models, and serves an EV-per-card API; the MTGA Draft Assistant
overlay on the gaming machine tails `Player.log` locally and calls the API.
Card stats come from 17Lands public data (CC BY 4.0) — anything user-facing
must display "Data from 17Lands.com".

Server pieces (all in `mtga/lands/`, `mtga/models/`, `mtga/draft_api.py`):

1. `scripts/run_17lands_download.py` — ETag-conditional S3 sync of
   `draft_data`/`game_data` per tracked set/format (see
   `mtga/lands/config.py`), plus a strictly once-per-day cache of the site's
   `card_ratings`/`color_ratings` JSON (the new-set cold-start feed).
2. `scripts/build_card_store.py` — canonical grpId table joining 17Lands
   `cards.csv` with the nightly Scryfall parquet.
3. `scripts/run_17lands_etl.py` — duckdb: raw gz CSV -> typed zstd parquet +
   the per-set card vocabulary sidecar.
4. `scripts/run_17lands_metrics.py` — own GIH/OH/GD/GNS win rates, IWD, ALSA,
   ATA with empirical-Bayes shrinkage (`--report` prints a top-20 table).
5. `scripts/train_pick_model.py` — DraftNet-style MLP (pool vector -> per-card
   EV, torch 2.2.2 -> ONNX). Promotion to `latest` is gated on beating the
   incumbent's top-quartile pick agreement on held-out drafts.
   `scripts/replay_draft.py` replays a held-out draft, model vs human.
6. `scripts/serve_draft_api.py` — stdlib JSON API on `0.0.0.0:8100`
   (`/api/v1/{health,sets,cards,ratings,models,score}`), screen session
   `mtga-draft` via `scripts/run_draft_api.sh`.

Environments: `.venv` (web/pipeline) and `.venv-ml` (torch pins; disposable)
— both Python 3.12 built by `scripts/setup.sh` / `scripts/setup_ml.sh`
(Homebrew python if available, else a uv-managed CPython).

Nightly automation (add to crontab; offset from the midnight Scryfall jobs):

- `30 2 * * * /Users/bward/src/mtga/scripts/daily_17lands.sh >> /tmp/cron_17lands.log 2>&1`
- `15 4 * * * /Users/bward/src/mtga/scripts/run_draft_api.sh >> /tmp/cron_draft_api.log 2>&1`

Health checks:

```bash
screen -ls                                  # detached mtga-draft session
curl -fsS http://127.0.0.1:8100/api/v1/health
```

Data lives under `/opt/$USER/dat/mtga/17lands/` and models under
`/opt/$USER/dat/mtga/models/<SET>/<FORMAT>/<version>/` with a `latest`
symlink. New sets: site ratings serve a heuristic model from day 1; the bulk
draft dump appears ~2 weeks after release and the nightly job trains and
promotes the real model automatically.

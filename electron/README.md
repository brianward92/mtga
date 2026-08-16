# MTGA Draft Assistant

A macOS menu-bar app that overlays MTG Arena during a draft and recommends
picks with **DraftFM** — the day-zero draft model from
[the paper](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=7257098) —
running **locally**, weights bundled, no server.

## What it does

- One transparent overlay glued to the Arena window. It follows moves and
  resizes at 30 Hz; card badges are click-through, and the right rail yields
  to Arena when the pointer rests over its body.
- **Card badges** on the pack grid: a frame per card tinted by tier, a chip
  with the pool-conditioned grade (the paper's 13-level ladder), a 5-flame
  conviction signal and the head-to-head % vs the next card, `#1 #2 #3` tags,
  and a LEAN/SLAM label on the model's pick. The raw set grade appears beside
  the pool-conditioned grade when they differ.
- **Context HUD** in a corner: set·format, P{pack}P{pick}, the recommendation
  with a one-line model explanation, runner-ups, your pool by colour, and lane
  lean. Hover a card in the pack and the HUD shows that card's detail. The pool
  and pick-history sheet opens with the draft and can be toggled with `⌘⇧D`.
- **Layering that works without permissions**: cursor geometry predicts Arena
  card previews and lifts the badges beneath them. The opt-in **Precise
  layering** menu item uses one-shot captures of only the Arena window to also
  detect previews and modals; captures are never stored.
- Nothing leaves the machine. Inference and card metadata are bundled; the app
  has no runtime server or card-data requests.

## Requirements

- macOS 14+ (Apple silicon build), MTG Arena with **Detailed Logs** enabled
  (Options → Account → Detailed Logs (Plugin Support)).
- No macOS permissions are required by default. **Precise layering** is opt-in
  and requires Screen Recording. Accessibility permission is never required.

## Package / install

```bash
cd electron
npm install
npm run package                     # unsigned Apple-silicon DMG + ZIP in release/
```

Open the DMG and drag **MTGA Draft Assistant** to Applications. Because this
development build is unsigned, macOS may require Control-clicking the app and
choosing **Open** on first launch. For a local development install, run
`npm run install:local -- --launch`; it typechecks, tests, builds, and copies
the app to `/Applications`, and refuses to replace a running copy.

`npm run dev` runs from source. The app lives in the menu bar (card icon):
toggles for badges / HUD / Precise layering, grid calibration, quit.

## The model bundle

`resources/draftfm/` ships with the app (`Resources/draftfm` in the bundle):

```
model/<tag>/{card_encoder.onnx,card_encoder.onnx.data,scorer.onnx,scorer.onnx.data,constants.npz,meta.json,featurizer_manifest.json}
sets/index.json
sets/<SET>/assets.npz    # model features, name order, and Arena grpId aliases
sets/<SET>/cards.json    # name-keyed identity: rarity, colours, cost, value, type
```

Inference is `main/model/draftfm.ts` (onnxruntime-node), a bit-for-bit port
of `mtga/models/draftfm.py` (`tests/draftfm.test.ts` checks against Python
reference fixtures). Set-relative grades come from scoring the whole set at
P1P1 with an empty pool once per set (cached under the app's userData).

Set bundles use one external card-data source: a dated raw Scryfall
`default_cards` bulk snapshot. Scryfall `arena_id` values supply Arena grpId
aliases; `cards.json` contains no art or card-stat payload. `sets/index.json`
records the model/manifest hashes, snapshot `updated_at`, build time, and
per-set counts. The HUD displays the active provenance as
`DraftFM <model tag> · Scryfall <snapshot date>`.

**Supporting a new set** = shipping a new `sets/<SET>/` (an app update):

```bash
# From the repo root, with the DraftFM data root and a dated snapshot available:
MTGA_DATA_ROOT=/path/to/data .venv/bin/python scripts/build_app_bundle.py \
  --set DSK --scryfall /path/to/default_cards-2026-08-15.jsonl.gz

# Or fetch the current Scryfall bulk snapshot first:
MTGA_DATA_ROOT=/path/to/data .venv/bin/python scripts/build_app_bundle.py \
  --set DSK --fetch --min-date 2026-08-15

# Optional day-zero escape hatch when Scryfall has not published Arena ids:
MTGA_DATA_ROOT=/path/to/data .venv/bin/python scripts/build_app_bundle.py \
  --set XYZ --scryfall /path/to/default_cards-2026-08-15.jsonl.gz \
  --arena-ids /path/to/arena-ids.json
```

`--arena-ids` accepts an explicit JSON object mapping card names to non-empty
grpId arrays; no such overlay ships in the repository or loads implicitly.
Sparse missing Scryfall ids in normal sets are fully reported. HOB is the
stricter day-zero case: it fails loudly until Scryfall publishes its ids or a
complete explicit overlay is supplied. Missing required text embeddings also
fail unless the builder's opt-in zero-fill mode is requested. The weights only
change when a new model is exported.

## Layout

```
main/            Electron main process
  index.ts       wiring: log → parser → coordinator → overlay; tray, shortcuts
  draft/         DraftCoordinator: draft state machine + scoring + history
  model/         DraftFM (onnxruntime), ModelManager (bundle, P1P1 curve), npz reader
  data/          set bundle loader, JSONL draft history
  overlay/       overlay window, layer detector, occlusion math, calibration
  parser/        Player.log watcher + draft parser
  arena-geometry.ts  native helper client (window rect, frontmost, frames)
renderer/overlay/  the single overlay page (badges, HUD, sheet, calibration)
shared/          pure logic used by both sides (state contract, grid layout, ladder…)
native/          arena-window-watch.swift (CGWindowList + one-shot SCK captures)
resources/draftfm/  bundled model + set bundles
```

## Data & files on your machine

- `~/.mtga-tracker/prefs.json` — toggles + grid calibrations
- `~/Library/Application Support/mtga-tracker/draft-history.jsonl` — your picks
  and what the model recommended
- `~/Library/Application Support/mtga-tracker/model-cache/` — P1P1 curves

Set `MTGA_LOG_PATH` to replay a different log; `MTGA_FAKE_ARENA_FILE` (JSON
rect) fakes the Arena window; `MTGA_BUNDLE_DIR` points at another bundle.

# MTGA Draft Assistant

A macOS menu-bar app that overlays MTG Arena during a draft and recommends
picks with **DraftFM** — the day-zero draft model from
[the paper](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=7257098) —
running **locally**, weights bundled, no server.

## What it does

- One transparent overlay glued to the Arena window (follows moves/resizes at
  30 Hz). Click-through: Arena keeps focus and gets every click.
- **Card badges** on the pack grid: a frame per card tinted by tier, a chip
  with the set-relative grade (the paper's 13-level ladder), a 5-flame
  conviction rating and the head-to-head % vs the next card, `#1 #2 #3` tags
  and a LEAN/SLAM label on the model's pick.
- **Context HUD** in a corner: set·format, P{pack}P{pick}, the recommendation
  with a one-line "why" (EV gap, 17Lands GIH WR / ALSA when bundled),
  runner-ups, your pool by colour and lane lean. Hover a card in the pack and
  the HUD shows that card's detail. `⌘⇧D` opens the pool & pick-history sheet.
- **Layer awareness**: Arena draws its card previews and menus inside its own
  window, so no overlay can sit between them and the pack. Instead the native
  helper takes one-shot screenshots of the Arena window (only that window;
  never stored; no macOS recording indicator) and per-cell diffs them against
  a clear baseline — badges under a preview or a modal lift, and come back.
  Needs the Screen Recording permission; without it a cursor-based prediction
  is used.
- Nothing leaves the machine. Card art thumbnails are the only URLs in the
  bundle (Scryfall) and are optional.

## Requirements

- macOS 14+ (Apple silicon build), MTG Arena with **Detailed Logs** enabled
  (Options → Account → Detailed Logs (Plugin Support)).
- Optional: Screen Recording permission for the app (layer awareness).

## Install / run

```bash
cd electron
npm install
npm run install:local -- --launch   # typecheck, tests, build, package, copy to /Applications
```

`npm run dev` runs from source. The app lives in the menu bar (card icon):
toggles for badges / HUD / layer awareness, grid calibration, quit.

## The model bundle

`resources/draftfm/` ships with the app (`Resources/draftfm` in the bundle):

```
model/<tag>/{card_encoder.onnx,card_encoder.onnx.data,scorer.onnx,scorer.onnx.data,constants.npz,meta.json}
sets/index.json
sets/<SET>/assets.npz    # per-set model assets (fp16 features, names, grpId aliases)
sets/<SET>/cards.json    # card identity per grpId (name, rarity, colours, cost, type, art URLs)
sets/<SET>/ratings.json  # 17Lands stats snapshot for display ("Data from 17Lands.com")
```

Inference is `main/model/draftfm.ts` (onnxruntime-node), a bit-for-bit port
of `mtga/models/draftfm.py` (`tests/draftfm.test.ts` checks against Python
reference fixtures). Set-relative grades come from scoring the whole set at
P1P1 with an empty pool once per set (cached under the app's userData).

**Supporting a new set** = shipping a new `sets/<SET>/` (an app update):

```bash
# from the repo root, with the DraftFM data root available
MTGA_DATA_ROOT=/path/to/data .venv/bin/python scripts/build_app_bundle.py --set HOB
```

The weights only change when a new model is exported.

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

Card statistics shown in the HUD/sheet come from 17Lands.com (CC BY 4.0).

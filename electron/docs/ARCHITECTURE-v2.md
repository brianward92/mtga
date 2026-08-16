# MTGA Draft Assistant v2 — architecture

Draft-only. One overlay window. Local DraftFM. (Built 2026-08-15; see
AUDIT-2026-08-15.md for what was cut and why.)

## Processes & modules

```
main/index.ts               bootstrap + wiring; overlay visibility policy; tray; global shortcuts; IPC
main/parser/                LogWatcher (Player-prev.log replay + Player.log tail) → LogParser → DraftParser
main/draft/coordinator.ts   DraftState machine: start/pack/pick/end/idle; scoring (0-based pack/pick);
                            grades; pool/picks; JSONL history; replay-safe
main/model/draftfm.ts       OnnxDraftFMModel port (onnxruntime-node); bit-for-bit vs Python fixtures
main/model/manager.ts       bundle discovery, per-set load, P1P1 curve cache, status
main/data/bundle.ts         sets/<SET>/{assets.npz,cards.json} + index.json; model/Scryfall provenance
main/data/history.ts        append-only JSONL
main/overlay/window.ts      the transparent click-through window (mouse forwarding; setInteractive)
main/overlay/layer.ts       LayerDetector: frame diff vs baseline / cursor prediction → LayerState
main/overlay/occlusion.ts   pure pixel math (cardness, per-cell diff)
main/overlay/calibration.ts grid calibration state + persistence (prefs.json)
main/arena-geometry.ts      native helper client: G (rect+frontmost) / F (frames) / C lines; stdin control
main/prefs.ts               ~/.mtga-tracker/prefs.json
main/status-tray.ts         menu-bar item
shared/                     state contract (DraftState…), layout (grid), display-order, hover, grades ladder
renderer/overlay/           single page: badges layer, HUD, sheet, calibration (see renderer files)
native/arena-window-watch.swift  permission-free CGWindowList geometry @30Hz + opt-in one-shot SCK captures
```

## Data flow

Player.log line → DraftParser event → DraftCoordinator (state) → `overlay:state`
push (full snapshot with `seq`) → renderer renders. Scoring is async: the pack
renders immediately from bundle identity; scores/grades land ~1 ms later.
Helper frames → LayerDetector → `overlay:layer` (covered cells / regions /
covered / hudCovered) → renderer lifts what Arena is drawing over.
`DraftState.snapshot` carries the active model tag and Scryfall bulk-data
`updated_at`; the HUD footer renders both as the on-screen provenance line.

## Visibility policy (main/index.ts)

Overlay shown iff Arena window found AND Arena (or we) frontmost AND
(calibrating OR draft active/complete with badges|hud OR idle with hud).
Window capture only while badges are live and layer detection is enabled.

## Permissions & layering

The default configuration needs no macOS permissions. Arena geometry and
frontmost state come from `CGWindowList`; the app never uses Accessibility.
Without capture, `LayerDetector` predicts card-preview regions from cursor
geometry, including landscape Room/split previews.

The menu-bar option **Precise layering** is an explicit opt-in. It requests
Screen Recording so the helper can take one-shot captures of only the Arena
window and diff pack cells against a clear baseline. Captures are not stored,
and the capture loop only runs while draft badges are live.

## Contracts

- Parser snapshot pack/pick are 1-based; the model takes 0-based (coordinator
  subtracts at the boundary — the old app got this wrong).
- Grades: the paper's 13-level ladder over the set's P1P1 curve (whole set
  scored as one pack, empty pool, serving condition 33/6).
- Bundle: manifest_hash in sets/index.json must equal the model's; DraftFM.load
  refuses mismatches.
- Set-bundle card data comes from one external source: a dated raw Scryfall
  `default_cards` snapshot. `arena_id` values provide grpId aliases in
  `assets.npz`; `cards.json` is name-keyed identity with the snapshot timestamp
  and contains neither art nor card statistics. Legacy `ratings.json` files
  are ignored.
- Provenance: `sets/index.json` records the model/manifest hashes, Scryfall
  `updated_at`, build time, and per-set counts. `DraftState.snapshot` and the
  HUD expose the model tag and snapshot timestamp used for the current draft.
- Renderer test hooks: data-testid overlay-root / badge-cell[data-scored] /
  hud / hud-pick / hud-provenance / hud-btn-sheet / hud-btn-calibrate / sheet /
  calibrate-panel / calibrate-cancel (used by tests/e2e/drive.mjs).

## Adding a set

Use a dated raw Scryfall snapshot (or `--fetch`), then commit the generated set
directory and index with the app update:

```bash
MTGA_DATA_ROOT=… .venv/bin/python scripts/build_app_bundle.py \
  --set XYZ --scryfall /path/to/default_cards-YYYY-MM-DD.jsonl.gz
```

An optional `--arena-ids PATH` overlay is a strictly validated JSON object
mapping card names to non-empty grpId arrays. It is an explicit day-zero
escape hatch only: no overlay ships in the repository or loads implicitly.

Sparse missing Scryfall Arena ids in normal sets are reported in full while
the useful set assets are built. HOB fails loudly until Scryfall publishes its
ids or the explicit overlay completely covers its model rows. Missing required
text embeddings also fail unless the builder's opt-in zero-fill mode is used.

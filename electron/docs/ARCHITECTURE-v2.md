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
main/data/bundle.ts         sets/<SET>/{assets.npz,cards.json,ratings.json} + index.json loader
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
native/arena-window-watch.swift  CGWindowList geometry @30Hz + one-shot SCK captures (no recording indicator)
```

## Data flow

Player.log line → DraftParser event → DraftCoordinator (state) → `overlay:state`
push (full snapshot with `seq`) → renderer renders. Scoring is async: the pack
renders immediately from bundle identity; scores/grades land ~1 ms later.
Helper frames → LayerDetector → `overlay:layer` (covered cells / regions /
covered / hudCovered) → renderer lifts what Arena is drawing over.

## Visibility policy (main/index.ts)

Overlay shown iff Arena window found AND Arena (or we) frontmost AND
(calibrating OR draft active/complete with badges|hud OR idle with hud).
Window capture only while badges are live and layer detection is enabled.

## Contracts

- Parser snapshot pack/pick are 1-based; the model takes 0-based (coordinator
  subtracts at the boundary — the old app got this wrong).
- Grades: the paper's 13-level ladder over the set's P1P1 curve (whole set
  scored as one pack, empty pool, serving condition 33/6).
- Bundle: manifest_hash in sets/index.json must equal the model's; DraftFM.load
  refuses mismatches.
- Renderer test hooks: data-testid overlay-root / badge-cell[data-scored] /
  hud / hud-pick / hud-btn-sheet / hud-btn-calibrate / sheet /
  calibrate-panel / calibrate-cancel (used by tests/e2e/drive.mjs).

## Adding a set

`MTGA_DATA_ROOT=… .venv/bin/python scripts/build_app_bundle.py --set XYZ` →
commit `electron/resources/draftfm/sets/XYZ/` → ship an app update.

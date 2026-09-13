# MTGA Draft Assistant — architecture

Draft-only. One overlay window. Local DraftFM.

## Processes and modules

```
main/index.ts                 bootstrap + wiring; overlay visibility; sidebar pointer ownership; tray; shortcuts; IPC
main/parser/                  LogWatcher (Player-prev.log replay + Player.log tail) → DraftParser
main/draft/coordinator.ts     DraftState machine: start/pack/pick/end/idle; scoring (0-based pack/pick);
                              grades; pool/picks; JSONL history; replay-safe
main/model/draftfm.ts         OnnxDraftFMModel port (onnxruntime-node); bit-for-bit vs Python fixtures
main/model/manager.ts         bundle discovery, per-set load, P1P1 curve cache, status
main/data/bundle.ts           sets/<SET>/{assets.npz,cards.json} + index.json; model/Scryfall provenance
main/data/history.ts          append-only JSONL
main/overlay/window.ts        the transparent click-through window (mouse forwarding; setInteractive)
main/overlay/layer.ts         LayerDetector: cursor rest → preview up; optional frame diff → LayerState
main/overlay/occlusion.ts     pure pixel math (cardness, per-cell diff)
main/overlay/sidebar-pointer.ts  the sidebar strip as an Arena dead zone (pointer + activation)
main/overlay/stand-aside.ts   the overlay hides while Arena's own menus are open
main/overlay/activity-policy.ts  when overlay content and live badges are wanted
main/overlay/geometry-sync.ts / reappearance.ts  Arena rect → overlay bounds, with a lost→found grace
main/overlay/calibration.ts   grid calibration state + persistence (prefs.json)
main/arena-geometry.ts        native helper client: G (rect+frontmost) / F (frames) / C / M lines; stdin control
main/prefs.ts                 ~/.mtga-tracker/prefs.json
main/status-tray.ts           menu-bar item
shared/                       state contract (DraftState…), layout (grid, sidebar), display-order, hover, grades, deck plan
renderer/overlay/             single page: badges layer, sidebar (HUD + pool sheet), calibration
native/arena-window-watch.swift  permission-free CGWindowList geometry @30 Hz, global mouse-down edges,
                              opt-in one-shot SCK captures, and Arena re-activation on request
```

## Data flow

Player.log line → DraftParser event → DraftCoordinator (state) → `overlay:state`
push (full snapshot with `seq`) → renderer renders. Scoring is async: the pack
renders immediately from bundle identity; scores/grades land ~1 ms later.
Cursor polls and helper frames → LayerDetector → `overlay:layer` (`cells` to
lift, preview `regions`, `covered`) → renderer steps aside.
`DraftState.snapshot` carries the active model tag and Scryfall bulk-data
`updated_at`; the sidebar footer renders both as the on-screen provenance line.

## Visibility policy (main/overlay/activity-policy.ts)

Overlay shown iff the Arena window is found AND Arena (or we) is frontmost AND
Arena is on a draft or deck-builder scene AND the overlay is not standing
aside AND (calibrating OR draft active/complete with badges|hud OR idle with
hud). Window capture runs only while badges are live and Precise layering is
on.

## Layering: Arena's own UI wins

Arena draws its hover previews and menus inside its one window, so no overlay
can be z-ordered between them and the pack. The overlay steps aside instead.

- **Hover preview.** Once the cursor has rested on a pack card for 250 ms,
  Arena's preview is taken to be up: every badge but the hovered card's lifts
  and the sidebar fades to 0.08, wherever the preview lands (keyword panels,
  token pairs, the right-most column's preview under the sidebar). Everything
  returns 120 ms after the cursor leaves the card. With Precise layering the
  helper's one-shot captures are diffed per cell against a clear baseline on
  top of that, which also catches modal scrims and the pack leaving the screen.
- **Menus.** A click in Arena's menu band (Home, Packs, Store, the gear) hides
  the overlay until the next click back on the draft screen or the next pick.
  Hovering the band does nothing.
- **The sidebar strip is a dead zone.** macOS delivers every mouse-moved event
  to the active application wherever the pointer is, so taking the mouse for
  the overlay window only stops clicks; Arena still saw the pointer over its
  drafted-pool column under the sidebar and popped previews from under it.
  While the pointer is on the strip the overlay therefore takes the mouse and
  becomes the active application: mouse-moved then reaches only the window
  under the pointer, the opaque strip. Over the transparent rest of the overlay
  the pointer still reaches Arena, so pack previews keep working. When the
  pointer leaves the strip the helper makes Arena active again, so Arena's next
  click lands as a click.

## Permissions

The default configuration needs no macOS permissions. Arena geometry and
frontmost state come from `CGWindowList`; the app never uses Accessibility.
The menu-bar option **Precise layering** is an explicit opt-in. It requests
Screen Recording so the helper can take one-shot captures of only the Arena
window. Captures are not stored, and the capture loop only runs while draft
badges are live.

## Contracts

- Parser snapshot pack/pick are 1-based; the model takes 0-based (the
  coordinator subtracts at the boundary).
- Grades: the paper's 13-level ladder over the set's P1P1 curve (whole set
  scored as one pack, empty pool, serving condition 33/6).
- Bundle: manifest_hash in sets/index.json must equal the model's; DraftFM.load
  refuses mismatches.
- Set-bundle card data comes from one external source: a dated raw Scryfall
  `default_cards` snapshot. `arena_id` values provide grpId aliases in
  `assets.npz`; `cards.json` is name-keyed identity with the snapshot timestamp
  and contains neither art nor card statistics.
- Provenance: `sets/index.json` records the model/manifest hashes, Scryfall
  `updated_at`, build time, and per-set counts. `DraftState.snapshot` and the
  sidebar expose the model tag and snapshot timestamp used for the current
  draft.
- `MTGA_STATE_FILE=path` mirrors every DraftState push to disk with the Arena
  rect, the pack slots and the deck plan.
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
mapping card names to non-empty grpId arrays. No overlay ships in the
repository or loads implicitly.

Sparse missing Scryfall Arena ids in normal sets are reported in full while
the useful set assets are built. A set fails loudly until Scryfall publishes
its ids or the explicit overlay completely covers its model rows. Missing
required text embeddings also fail unless the builder's opt-in zero-fill mode
is used.

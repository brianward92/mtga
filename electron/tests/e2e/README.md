# E2E visual test harness

Drives a complete synthetic DSK Quick Draft through the built Electron app —
no Arena and no server — and screenshots the overlay at each checkpoint. The
run uses the repository's local DraftFM bundle and fails on missing UI states
or renderer errors.

## How it works

`drive.mjs` creates a temporary, isolated environment:

- a fresh `HOME` and `MTGA_USER_DATA` for preferences, history, and caches;
- an empty fake `Player.log` and a fixed `MTGA_FAKE_ARENA_FILE` window rect;
- `MTGA_BUNDLE_DIR` pointing at `resources/draftfm` in this checkout; and
- a generated 42-pick log from `gen-draft-log.mjs`.

It launches the repository's built `dist/` app with the local Electron binary,
connects Puppeteer over CDP, streams the generated log, waits on renderer test
hooks, and captures PNGs. This does not install, replace, or read data from the
normal app. A temporary overlay window does appear while the harness runs.

## Running

```sh
cd electron
npm run build
npm run e2e

# Optional harness controls:
npm run e2e -- --keep-tmp --port 9333 --speed 8 --out /tmp/draftfm-e2e-shots
```

- `--keep-tmp` preserves the isolated home, log, and fake Arena file.
- `--port` selects the CDP port (default `9333`).
- `--speed` controls how often log streaming briefly yields (default `10`).
- `--out` selects the screenshot/log directory (default `tests/e2e/shots`).

## Checkpoints

| shot | assertion / state |
| --- | --- |
| `00-idle.png` | overlay connected, waiting for a draft |
| `01-p1p1-pack.png` | 14 cells, pool sheet open by default, model + Scryfall snapshot provenance, no legacy card-stat attribution |
| `02-p1p1-scored.png` | at least ten scored badge chips |
| `03-hover-detail.png` | cursor-driven card detail |
| `04-sheet.png` | default-open pool and pick-history sheet before the HUD button closes it |
| `05-p1p7.png` | eight-card pack at P1P7 |
| `06-p2p6.png` | mid-draft state |
| `07-calibrate.png` | calibration panel opened from the HUD |
| `08-complete.png` | completed draft state |

The output directory also receives `console_main.log` and
`console_renderer.log`. Renderer console errors make the run fail.

## Synthetic log

`gen-draft-log.mjs` emits Arena's two-line bot-draft response shape with
0-based raw pack/pick numbers. Its 14 valid DSK grpIds come from
`tests/fixtures/draftfm-reference-DSK.json`, so log generation does not depend
on the generated representation of `cards.json`. The seed controls pack order
and synthetic human choices:

```sh
node tests/e2e/gen-draft-log.mjs --set DSK --picks 42 --seed 11
```

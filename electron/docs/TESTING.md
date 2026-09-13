# Testing guide

Use the smallest check that covers the change, then run the full gate before
release. Commands run from `electron/`.

## Automated checks

```bash
npm test              # unit, pure-render and integration tests
npm run typecheck     # TypeScript without emitting files
npm run build         # native helper (on macOS) plus main/preload/renderer bundles
npm run e2e           # source E2E against the built dist/ (see below)
```

`npm run build` writes the source build under `dist/` and rebuilds
`build/native/arena-window-watch`; it does not package, install, or launch
the application. A focused Vitest run is useful while iterating:

```bash
npx --no-install vitest run tests/renderer-sheet-anchor.test.ts
```

`npm run install:local -- --launch` repeats the gate, copies the app to
`/Applications` and launches it. It refuses to replace a running copy: quit the
installed app first. Packaging is documented in [RELEASE.md](RELEASE.md).

## Source E2E

The E2E harness needs a current build:

```bash
npm run build
npm run e2e
```

It launches the local `dist/` app with an isolated temporary home, a fake
1512×949 Arena window, a synthetic 42-pick DSK Quick Draft, and the repository
model bundle. A temporary overlay appears during the run. It does not touch
the installed app.

By default, artifacts go to `tests/e2e/shots/`:

- `00-idle.png` … `08-complete.png` (see the
  [E2E harness reference](../tests/e2e/README.md) for what each proves)
- `console_main.log` and `console_renderer.log`

The logs are written even when the run fails. Renderer console errors fail the
run. Existing files with the same names are replaced.

```bash
npm run e2e -- --keep-tmp --port 9334 --speed 8 --out /tmp/mtga-e2e-shots
```

| option | meaning |
| --- | --- |
| `--keep-tmp` | Preserve the isolated home, fake log, and fake Arena file. |
| `--port PORT` | Chrome DevTools Protocol port; default `9333`. |
| `--speed N` | Pause briefly after every `N` streamed log lines; default `10`. |
| `--out PATH` | Screenshot and console-log directory; default `tests/e2e/shots`. |

## Environment seams

Startup environment variables, read once when the process starts.

- `MTGA_STATE_FILE=path` mirrors every main-process `DraftState` push as
  JSON, with the Arena rect, pack slots and deck plan. The parent directory
  must exist.
- `MTGA_FAKE_ARENA_FILE=path` polls a JSON rectangle
  (`{"x":0,"y":33,"width":1512,"height":949,"frontmost":true}`) every 500 ms
  instead of starting the native window helper. A missing file, malformed
  JSON, non-positive size, or `{}` means no Arena window; `"frontmost":false`
  simulates Arena losing the foreground. Geometry only: no luminance frames.
- `MTGA_E2E=1` disables real cursor sampling and the sidebar's activation
  hand-off. The harness sets it; never set it for a real Arena session.

```bash
MTGA_STATE_FILE=/tmp/mtga-draft-state.json MTGA_FAKE_ARENA_FILE=/tmp/mtga-fake-arena.json npm run dev
```

## Live checklist

Record the Arena size, draft position, and whether Precise layering was on
with each observation.

### Startup and no Arena

- [ ] Starting with no Arena window leaves the overlay hidden and the tray
  says `Waiting for Arena…`.
- [ ] A replayed or cached draft does not leak an overlay while Arena is absent.
- [ ] When Arena appears, including after the overlay started, the tray
  refreshes and the overlay adopts its bounds after the brief reappearance
  grace period.
- [ ] Losing Arena hides the overlay immediately. Returning Arena restores the
  current draft state without stale geometry or duplicate windows.
- [ ] Sending Arena behind another app hides the overlay; returning it to the
  foreground restores the overlay at the correct bounds.

### Idle

- [ ] With Arena found and the HUD enabled, idle shows only the small,
  click-through top-right glyph.
- [ ] No card badges, draft sidebar, stale warning, or completion controls
  remain visible.
- [ ] The tray says `No draft in progress`. Disabling the HUD hides even the
  idle glyph.

### Packs 1, 2, and 3

- [ ] At P1P1, badge cells align with every visible Arena card. Scoring
  replaces placeholders with stable ranks/grades, the sidebar shows P1P1 and
  exactly five ranked rows, and model/Scryfall provenance is present.
- [ ] Every scored card chip and each #1–#5 row shows the same rounded
  within-pack model probability for that card.
- [ ] The #1 WHY uses the direct pick-probability point gap to #2, then only
  supported pool-colour and name/type-hook evidence.
- [ ] After each pick, the old pack clears before the next one appears; no
  stale badge, score, hover detail, or recommendation survives the transition.
- [ ] At P2P1 and P3P1 in a 14-card single-pick draft, the pool has 14 and 28
  cards respectively. Pack/pick labels remain 1-based.
- [ ] Pool rows remain best-to-worst. Duplicate names collapse to one row with
  `×N` and every pick label; basic lands stay last under a `Lands` divider.

### Arena's own UI wins

- [ ] Resting the pointer on any pack card for a quarter second lifts every
  other badge and fades the sidebar to 0.08, including when Arena draws the
  preview to the right of the right-most column, under the sidebar. Leaving
  the card restores both within a fraction of a second. No badge, frame or
  rank tag is ever drawn over Arena's preview, its keyword panels or its
  token pair.
- [ ] Clicking Arena's gear (or Home, Packs, Store) hides the overlay while the
  menu is open; clicking back on the draft screen brings it back. Merely
  hovering the menu band changes nothing.
- [ ] Moving the pointer onto the sidebar never pops a preview of Arena's
  drafted-pool column from under it, however fast the pointer arrives. The
  pool list scrolls, and the sidebar's buttons click. Moving the pointer back
  onto the pack makes Arena's previews work again at once, and the next click
  on a card is a card click, not an activation click.
- [ ] Resting the pointer anywhere on the sidebar does not fade it.

### Sidebar bounds and content

- [ ] At 1512×949 and after moving/resizing Arena, one sidebar shell owns the
  full right column: its left edge is approximately 74% through Arena's
  centred, height-scaled content box, its top is approximately 11.5% of the
  window height, and it reaches the right and bottom edges. The panel is inset
  by about 6 px inside that shell. The shell completely masks Arena's Deck
  header, deck list, and Sideboard bar.
- [ ] The header contains set·format, P#P#, the model chip, and Pool rating.
  The fixed-height recommendation block contains aligned #1–#5 rows.
- [ ] Score arrival and hovering any pack card change content (including the
  recommendation art) without moving the ranked block, pool bar, pool-list
  viewport, or footer.
- [ ] Long Pack 2 and Pack 3 pools scroll only inside the list viewport while
  the provenance and button footer stays pinned to the bottom.

### Complete and dismiss

- [ ] Completion removes every badge, shows `Draft complete`, moves the
  sidebar to the left of the deck builder, and displays the complete pool with
  the proposed deck.
- [ ] `Dismiss` immediately returns to the idle glyph with no badge or sidebar
  leak. Without dismissal, the summary returns to idle after its 15-second
  linger.

# Testing guide

Use the smallest check that covers the change, then expand to the full gate
before release. Commands in this guide run from `electron/` unless noted.

## Safety boundary

Building and testing are separate from installing and live application
lifecycle work.

- `npm test`, `npm run typecheck`, and `npm run build` do not install or launch
  the app.
- `npm run e2e` launches a temporary repository build and displays its overlay,
  but it does not read, replace, or launch the app in `/Applications`.
- Do not run `npm run install:local`, pass `--launch`, open or quit the installed
  app, restart a source app, restart Arena, or change macOS permissions unless
  that action was explicitly authorized. A request to inspect or test is not
  authorization to change those processes.
- Environment seams are read at process startup. Never relaunch an app merely
  to add a seam; arrange it for the next authorized launch.
- Live draft actions are irreversible. The development picker requires a
  separate, explicit instruction for each real pick.

Dependency provisioning is also an installation step. On a deliberately
provisioned checkout, `npm ci` installs the locked development dependencies,
including the local TypeScript runner used by the picker. Do not run it when a
task says not to install anything. If a development command asks to download a
package despite a completed `npm ci`, stop instead of accepting the prompt.

## Automated checks

```bash
# Unit, pure-render, and integration tests
npm test

# TypeScript without emitting files
npm run typecheck

# Native helper (on supported macOS hosts) plus main/preload/renderer bundles
npm run build
```

`npm run build` writes the source build under `dist/` and may rebuild
`build/native/arena-window-watch`; it does not package, install, or launch the
application. A focused Vitest run is useful while iterating:

```bash
npx --no-install vitest run tests/renderer-sheet-anchor.test.ts
```

Run the full three-command gate after focused tests. Packaging and artifact
checks are documented in [RELEASE.md](RELEASE.md).

## Source E2E

The strict source harness needs a current build:

```bash
npm run build
npm run e2e
```

It launches the local `dist/` app with an isolated temporary home, a fake
1512×949 Arena window, a synthetic 42-pick DSK Quick Draft, and the repository
model bundle. A temporary overlay appears during the run. It does not interact
with the normally installed app, but it still counts as launching a source
process. Do not run it when all new processes or source-app launches are
forbidden; a restriction only on replacing or relaunching the installed app
does not prevent this isolated harness.

By default, artifacts go to `tests/e2e/shots/`:

- `00-idle.png`
- `01-p1p1-pack.png`
- `02-p1p1-scored.png`
- `03-hover-detail.png`
- `04-sheet.png`
- `05-p1p7.png`
- `06-p2p6.png`
- `07-calibrate.png`
- `08-complete.png`
- `console_main.log` and `console_renderer.log`

The logs are written even when the run fails. Renderer console errors fail the
run. Existing files with the same names are replaced.

Available harness options are parsed by `tests/e2e/drive.mjs`:

```bash
npm run e2e -- \
  --keep-tmp \
  --port 9334 \
  --speed 8 \
  --out /tmp/mtga-e2e-shots
```

| option | meaning |
| --- | --- |
| `--keep-tmp` | Preserve the isolated home, fake log, and fake Arena file instead of deleting them. |
| `--port PORT` | Set the Chrome DevTools Protocol port; default `9333`. Choose another port if it is occupied. |
| `--speed N` | Pause briefly after every `N` streamed log lines; default `10`. Use a positive integer for normal paced runs. |
| `--out PATH` | Set the screenshot and console-log directory; default `tests/e2e/shots`. |

See the [E2E harness reference](../tests/e2e/README.md) for its exact DOM
assertions and synthetic-log details.

## Development seams

These are startup environment variables, not command-line flags.

### Mirrored draft state

`MTGA_STATE_FILE` writes each main-process `DraftState` push as JSON. Its
parent directory must already exist. The file may not appear until the first
state update.

For an authorized source launch:

```bash
MTGA_STATE_FILE=/tmp/mtga-draft-state.json npm run dev
```

Read it without modifying the running draft:

```bash
jq '{phase,pack,pick,scoring,cards:(.cards|length),pool:(.pool|length)}' \
  /tmp/mtga-draft-state.json
```

The mirror is also the input to the development picker below. Setting the
variable in a different shell does not retrofit an already-running process.

### Fake Arena geometry

`MTGA_FAKE_ARENA_FILE` points to a JSON rectangle polled every 500 ms instead
of starting the native window helper:

```json
{"x":0,"y":33,"width":1512,"height":949,"frontmost":true}
```

`frontmost` is optional and defaults to `true`. A missing file, malformed JSON,
non-positive size, or `{}` represents no Arena window. Rewriting the file with
a valid rectangle simulates found/move/resize; setting `"frontmost":false`
simulates Arena losing the foreground. This seam supplies geometry only, not
luminance frames for Precise layering.

For an authorized source launch:

```bash
MTGA_FAKE_ARENA_FILE=/tmp/mtga-fake-arena.json npm run dev
```

The source E2E harness manages this seam, `MTGA_LOG_PATH`, `MTGA_USER_DATA`,
`MTGA_BUNDLE_DIR`, and `MTGA_E2E` itself. Do not set `MTGA_E2E=1` for a real
Arena session; it intentionally disables real cursor sampling.

## Live verification

Live checks observe the already-running app and Arena unless lifecycle changes
were expressly approved. Capture the Arena window, not the whole desktop, with:

```bash
scripts/dev/screenshot-arena.sh
scripts/dev/screenshot-arena.sh /tmp/arena-pack2.png
```

Usage is `screenshot-arena.sh [OUTPUT.png]`; `-h` or `--help` prints it. With no
output path, the helper writes `./arena-screenshot-YYYYMMDD-HHMMSS.png`, and it
refuses to overwrite an existing file. It queries the development window
helper first, falls back to the installed app's helper, and captures only the
reported Arena rectangle without launching the app. Screenshot capture may
require Screen Recording; do not grant or alter that permission without
approval.

If the helper warns that Arena is not frontmost, another window may overlap
that rectangle. Do not retain or share the image until its contents have been
reviewed; delete it if it contains unrelated content. Bring Arena forward for
a clean retry only when changing application focus was explicitly authorized.

Record the Arena size, HUD corner, draft position, and whether the sheet and
Precise layering were enabled with each screenshot.

### Startup and no Arena

This section requires explicit permission to change the app/Arena lifecycle.

- [ ] Starting with no Arena window leaves the overlay hidden and the tray
  says `Waiting for Arena…`.
- [ ] A replayed or cached draft does not leak an overlay while Arena is absent.
- [ ] When Arena becomes available, the tray refreshes immediately and the
  overlay adopts its current bounds after the brief reappearance grace period.
- [ ] Losing Arena hides the overlay immediately. Returning Arena restores the
  current draft state without stale geometry or duplicate windows.
- [ ] Sending Arena behind another app hides the overlay; returning it to the
  foreground restores the overlay at the correct bounds.

### Idle

- [ ] With Arena found and the HUD enabled, idle shows only the small,
  click-through top-right glyph.
- [ ] No card badges, full HUD body, pool sheet, stale warning, or completion
  controls remain visible.
- [ ] The tray says `No draft in progress`. Disabling the HUD hides even the
  idle glyph.

### Packs 1, 2, and 3

- [ ] At P1P1, badge cells align with every visible Arena card. Scoring replaces
  placeholders with stable ranks/grades, the HUD shows P1P1 and the top five,
  and model/Scryfall provenance is present.
- [ ] On the first draft of a fresh app session, the pool sheet is open by
  default. Closing and reopening it through the HUD button or `Command+Shift+D`
  keeps main and renderer state in sync.
- [ ] After each pick, the old pack clears before the next one appears; no stale
  badge, score, hover detail, or recommendation survives the transition.
- [ ] At P2P1 and P3P1 in a 14-card single-pick draft, the pool has 14 and 28
  cards respectively. Pack/pick labels remain 1-based and advance correctly.
- [ ] Pool rows remain best-to-worst. Duplicate names collapse to one row with
  `×N`, and that row lists every matching label such as `P1p2 · P2p5`.
- [ ] Basic lands stay at the bottom under a visible `Lands` divider. W/U/B/R/G
  header counts and pick-history agreement/rank tags update after each pick.

### Rail bounds, yielding, controls, and hover

- [ ] At 1512×949 and after moving/resizing Arena, the joined HUD/sheet remains
  fully inside the overlay. The populated sheet never paints below 91% of the
  Arena height, preserving the bottom 9% Sideboard area.
- [ ] Long Pack 2 and Pack 3 content scrolls inside the sheet body. The outer
  sheet does not scroll or extend below its rail bounds.
- [ ] Cycle the corner control through top-left, top-right, bottom-right, and
  bottom-left. The sheet stacks below top HUDs and above bottom HUDs, stays on
  the same side, and meets the HUD at a flush seam without doubled borders,
  radius, or shadow.
- [ ] Resting on either joined panel body for about 250 ms fades both panels to
  the low-opacity click-through state. Crossing their seam does not restart the
  dwell or leave only one panel visible.
- [ ] Moving onto a HUD or sheet button restores both panels immediately and
  the first click works. Opening/closing the sheet or moving corners clears any
  pending or yielded state instead of carrying it into the new topology.
- [ ] Hovering an Arena card changes the HUD to that card's detail without
  moving the pool bar or sheet seam. Leaving restores the recommendation.
- [ ] Arena card previews lift only the badges they cover (or use the
  permission-free geometric prediction); badge and rail surfaces never block
  unrelated Arena clicks.

### Complete and dismiss

- [ ] Completion removes every badge, shows `Draft complete`, and opens the
  populated sheet once even if the sheet was closed immediately beforehand.
- [ ] The completed sheet starts at the top, accounts for every drafted copy,
  preserves grouped rows/pick labels/Lands ordering, and remains internally
  scrollable above the Sideboard reserve.
- [ ] Closing the sheet during completion keeps it closed on later state pushes
  and does not dismiss the summary.
- [ ] `Dismiss` immediately returns to the idle glyph with no badge or sheet
  leak. Without dismissal, the summary returns to idle after its 15-second
  linger.

## Development picker

`scripts/dev/pick-next-card.sh` is a development-only real-Arena tool. The
product app itself remains Accessibility-free, but this helper activates Arena,
queries its window through System Events, and synthesizes mouse input, so macOS
may require Accessibility permission. Even `--dry-run` activates Arena, may
wake a sleeping live session, compiles local Swift helpers when absent, and
must not be treated as a passive inspection command.

It requires the app to have started with `MTGA_STATE_FILE` and Arena to be on a
draft pack:

```bash
# Resolve and print the model's top choice without clicking.
scripts/dev/pick-next-card.sh top --dry-run

# Resolve a specific Arena grpId without clicking.
scripts/dev/pick-next-card.sh 92301 --dry-run

# Make the current top-ranked pick. Run only with explicit authorization.
scripts/dev/pick-next-card.sh top
```

Usage is `pick-next-card.sh [top|<grpId>] [--dry-run] [--allow-land]`.
The script lists the pack, computes the target cell from mirrored state and the
live Arena rectangle, refuses basic lands unless `--allow-land` is present, and
never clicks a one-card pack. A real run double-clicks once, waits for a new
history pick, and retries once only when the same pack/pick is still visible.
Always run `--dry-run` first, re-check the displayed pack/pick and card name,
and obtain explicit approval before removing `--dry-run`.

# Release guide

The release target is an unsigned, unnotarized Apple-silicon macOS app. The
packaging scripts deliberately disable signing discovery, so producing
a local artifact never depends on a developer certificate.

## Build and verify

Install the locked JavaScript dependencies, run the behavior gates, then
package from `electron/`:

```bash
cd electron
npm ci
npm run typecheck
npm test
npm run build
npm run e2e
npm run package
```

`npm run package` builds the Swift window helper and Electron bundles again,
then writes these ignored artifacts under `release/`:

- `MTGA Draft Assistant-<version>-arm64.dmg`
- `MTGA Draft Assistant-<version>-arm64-mac.zip`
- `mac-arm64/MTGA Draft Assistant.app`

The DMG and ZIP are release artifacts. `npm run package:dir` creates only the
unpacked app, and `npm run install:local -- --launch` is a development helper:
it repeats typecheck/tests/build, refuses to replace a running copy, and copies
the app to `/Applications`. Packaging alone never installs or launches it.

The E2E harness uses an isolated home, fake Arena rectangle, synthetic 42-pick
DSK log, and the repository bundle. It opens a temporary overlay but neither
replaces nor reads the normally installed app. See
[`tests/e2e/README.md`](../tests/e2e/README.md) for its assertions and output.

## Packaged contents

Electron Builder copies the following application payloads:

- compiled main, preload, and renderer code in `Resources/app.asar`;
- the `arena-window-watch` arm64 helper in `Resources/native/`;
- the local DraftFM ONNX model and per-set bundles in `Resources/draftfm/`;
- the Darwin arm64 ONNX Runtime native binding; and
- the app, menu-bar, and tray artwork.

Linux, Windows, and Darwin x64 ONNX Runtime binaries are excluded. The app
does not ship card art, ratings files, a server client, or an implicit Arena-ID
overlay. `Info.plist` sets `LSUIElement=true`, so the installed app lives in the
menu bar rather than the Dock.

A compact artifact audit after packaging:

```bash
APP="release/mac-arm64/MTGA Draft Assistant.app"
VERSION=$(node -p "require('./package.json').version")
DMG="release/MTGA Draft Assistant-${VERSION}-arm64.dmg"

plutil -extract LSUIElement raw -o - "$APP/Contents/Info.plist"
file "$APP/Contents/MacOS/MTGA Draft Assistant"
file "$APP/Contents/Resources/native/arena-window-watch"
jq '.sets | length' "$APP/Contents/Resources/draftfm/sets/index.json"
find "$APP/Contents/Resources/app.asar.unpacked/node_modules/onnxruntime-node/bin" -type f
shasum -a 256 "$DMG"
```

The current package is intentionally not signed or notarized. Electron's
upstream executable may retain an ad-hoc linker signature, but there is no
Team Identifier or sealed application resource signature, and the DMG itself
is unsigned. Do not describe one of these development artifacts as a signed
release. Users may need to Control-click the app and choose **Open** once.

## Add or rebuild a set

Set assets are built from the frozen model manifest, the model's curated name
vocabulary when available, cached text embeddings, and one external card-data
source: a dated raw Scryfall `default_cards` snapshot. From the repository
root:

```bash
MTGA_DATA_ROOT=/path/to/data .venv/bin/python scripts/build_app_bundle.py \
  --set XYZ --scryfall /path/to/default_cards-YYYY-MM-DD.jsonl.gz

# Or fetch the current Scryfall bulk snapshot and enforce a minimum date:
MTGA_DATA_ROOT=/path/to/data .venv/bin/python scripts/build_app_bundle.py \
  --set XYZ --fetch --min-date YYYY-MM-DD
```

Review and commit both `electron/resources/draftfm/sets/XYZ/` and the updated
`electron/resources/draftfm/sets/index.json`. A set directory contains
`assets.npz` and name-keyed `cards.json`; it must not contain `ratings.json`.
The index records model/manifest hashes, Scryfall `updated_at`, build time, and
per-set counts.

`--all` attempts every curated set plus HOB and continues after a per-set
failure. HOB intentionally fails until Scryfall supplies its Arena IDs or a
complete explicit mapping is passed with `--arena-ids PATH`. That JSON escape
hatch is strictly validated and never loaded implicitly; no mapping file ships
in the repository. Sparse Scryfall ID gaps in ordinary sets are reported in
full. Missing text embeddings fail with setup guidance unless the explicit
zero-fill option is chosen.

After changing set assets, repeat the full build/E2E/package gate and inspect
the mounted artifact—not only the source directory—before publishing it.

## Permissions

The default overlay uses permission-free Arena window geometry and cursor
prediction. It does not require Accessibility permission. **Precise layering**
is optional and requests Screen Recording only to inspect one-shot luminance
frames of the Arena window; frames are not stored. Building, packaging, and
installing do not grant that permission automatically.

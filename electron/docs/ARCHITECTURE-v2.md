# MTGA Draft Assistant v2 — draft-only, single overlay, local DraftFM

Status: DRAFT (2026-08-15). Being reconciled against the code audit.

## Product
One menu-bar app. One transparent, click-through overlay window that covers the
Arena window (glued at ~30 Hz via the native helper). No separate panel.

Overlay contents
- Context HUD (corner, small, always subtle): model + set/format, pack·pick,
  pool colour bars / lane lean, and a one-line hint. Hidden outside drafts
  except a tiny status glyph.
- Draft mode ("goes nuts"): per-card frames + chips on the pack grid (grade,
  flames, head-to-head %, #1–#3, LEAN/SLAM), layer-aware (previews/modals lift
  what they cover), hover-to-detail: cursor over a card puts that card's detail
  (why: EV, GIH WR, ALSA, model prob) into the HUD — no click needed.
- Keyboard: global shortcut toggles an expanded pool/pick-history sheet inside
  the same overlay; menu bar for the rest (calibrate, toggle, quit).

## Inference (local, bundled)
- DraftFM foundation model (paper: SSRN 7257098) as ONNX: card_encoder.onnx,
  scorer.onnx, constants, meta — ~6.5 MB. Runs in-process via onnxruntime-node.
- Per-set asset bundle (~0.6 MB each): feature matrix (fp16 775 dims), rarity
  ids, names, grpId aliases; plus a 17Lands ratings snapshot for display
  (attribution required). New set ⇒ app update ships a new bundle; weights
  optional.
- Set-relative grades computed locally: score every card in the set at P1P1
  with an empty pool once per set ⇒ percentile table.
- No network at draft time. Remote API kept only as dev tooling.

## Layer awareness (no recording indicator)
- Native helper: CGWindowList geometry stream (30 Hz on change + 1 Hz
  heartbeat) and one-shot SCScreenshotManager captures of the Arena window
  (adaptive 2–8 Hz; only while overlay is live). One-shot captures do NOT
  trigger macOS's recording indicator (verified 2026-08-15).
- Main: per-cell frame diff vs. a "clear" baseline; cardness gate; frontmost
  from window order.

## Removed (draft-only)
match/deck tracker, collection sync, inventory, win/loss stats, dashboard,
tier-list mode, sqlite except a small draft-history store (or JSON), remote
score/ratings calls, legacy UTC log tailing (verify), the panel window.

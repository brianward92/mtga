// arena-window-watch — Arena window geometry + (optionally) a low-res
// luminance feed of the Arena window for the badge overlay's layer detection.
//
// Output lines (stdout):
//   G x,y,width,height,frontmost   window frame in points (top-left origin);
//                                  printed on change + a 1 Hz heartbeat
//   G NOWIN                        Arena not running / no on-screen window
//   F w,h,<base64 gray bytes>      one downscaled luminance frame (640 px wide,
//                                  aspect-correct height); only when the image
//                                  changed vs the previously emitted frame
//   C on|off                       frames flowing (capture enabled AND Screen
//                                  Recording granted) / not
//   D <JSON>                       independent deck OCR observation, text only;
//                                  epoch milliseconds, point dimensions, and
//                                  normalized line bounds from the top-left
//   M x,y                          a mouse button went down anywhere on screen
//                                  (global point, top-left origin). The overlay
//                                  steps aside for Arena's menus on a real
//                                  click, never on a hover.
// Args:  --capture   start with capture enabled (default: off).
//        --deck-scan start with deck OCR enabled (default: off).
// Stdin control channel (one command per line):
//   capture on | capture off       enable / disable the frame feed
//   deck-scan on | deck-scan off   deck OCR: 1 Hz briefly after interaction,
//                                  one scan per 5 seconds while idle
//   rate <hz>                      base capture rate (default 4; 0 pauses)
//   activate                       make Arena the active application again
//                                  (the overlay takes activation while the
//                                  pointer is on its sidebar)
// The helper exits when stdin closes or a stdout write fails.
//
// Geometry uses CGWindowList (no Accessibility needed). Frames are one-shot
// SCScreenshotManager captures filtered to the Arena window only, so our own
// overlays are never in the image and no other window is ever captured — and,
// unlike an SCStream, one-shot captures do not light macOS's purple
// "screen recording" menu-bar indicator. Rate is adaptive: base (4 Hz),
// 2× base for 1.5 s after the cursor moved or the window rect changed,
// 1 Hz when neither Arena nor we are frontmost, 0 when capture is off.
import Foundation
import AppKit
import ScreenCaptureKit
import CoreGraphics
import Vision

let arenaBundleIds: Set<String> = ["com.wizards.mtga"]
let arenaNames: Set<String> = ["MTGA", "MTG Arena", "Magic: The Gathering Arena"]
let selfBundleIds: Set<String> = ["com.mtga.draft-assistant", "com.mtga.tracker", "com.github.Electron"]
let FRAME_W = 160
let DEFAULT_RATE_HZ = 2.0
let BURST_WINDOW_S = 1.5
let DECK_ACTIVE_INTERVAL_S = 1.0
let DECK_IDLE_INTERVAL_S = 5.0
let DECK_INTERACTION_WINDOW_S = 3.0
let out = FileHandle.standardOutput
let outLock = NSLock()

func emit(_ line: String) {
  outLock.lock(); defer { outLock.unlock() }
  guard let data = (line + "\n").data(using: .utf8) else { return }
  do { try out.write(contentsOf: data) } catch { exit(0) } // parent gone
}

func isArena(_ pid: pid_t) -> Bool {
  guard let app = NSRunningApplication(processIdentifier: pid) else { return false }
  if let bid = app.bundleIdentifier, arenaBundleIds.contains(bid) { return true }
  if let name = app.localizedName, arenaNames.contains(name) { return true }
  return false
}

/// Arena's pids, derived from the window list rather than
/// NSWorkspace.runningApplications: that array is KVO-driven and never refreshes
/// in this process, which services RunLoop.main.run() and not a main run loop, so an
/// Arena launched after us would stay invisible forever. The window list and
/// NSRunningApplication(processIdentifier:) are both read live.
func arenaPids() -> Set<pid_t> {
  var pids = Set<pid_t>()
  guard let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]]
  else { return pids }
  var seen = Set<pid_t>()
  for w in list {
    guard let pid = w[kCGWindowOwnerPID as String] as? pid_t, seen.insert(pid).inserted else { continue }
    if isArena(pid) { pids.insert(pid) }
  }
  return pids
}

func appOk(_ app: NSRunningApplication?) -> Bool {
  guard let app = app else { return false }
  if let bid = app.bundleIdentifier, arenaBundleIds.contains(bid) || selfBundleIds.contains(bid) { return true }
  if let name = app.localizedName, arenaNames.contains(name) || name == "MTGA Draft Assistant" || name == "Electron" { return true }
  return false
}

/// Frontmost app derived from CGWindowList order (front-to-back). NSWorkspace's
/// frontmostApplication is KVO-driven and goes stale in a process that never
/// services the main run loop; the window list is always current.
func frontmostOk() -> Bool {
  guard let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else {
    return appOk(NSWorkspace.shared.frontmostApplication)
  }
  for w in list {
    guard let layer = w[kCGWindowLayer as String] as? Int, layer == 0 else { continue }
    guard let b = w[kCGWindowBounds as String] as? [String: CGFloat], (b["Width"] ?? 0) >= 100, (b["Height"] ?? 0) >= 60 else { continue }
    guard let pid = w[kCGWindowOwnerPID as String] as? pid_t else { continue }
    return appOk(NSRunningApplication(processIdentifier: pid))
  }
  return false
}

// Unity's borderless fullscreen removes the title-bar controls even on builds
// where AXFullScreen itself stays false. Read the actual close button instead.
var titleCache: (pid: pid_t, at: Date, height: Int)?
func titleBarHeight(_ pid: pid_t) -> Int {
  if let c = titleCache, c.pid == pid, Date().timeIntervalSince(c.at) < 0.25 { return c.height }
  let height = readTitleBarHeight(pid)
  titleCache = (pid, Date(), height)
  return height
}
func readTitleBarHeight(_ pid: pid_t) -> Int {
  let application = AXUIElementCreateApplication(pid)
  var windows: CFTypeRef?
  guard AXUIElementCopyAttributeValue(application, kAXWindowsAttribute as CFString, &windows) == .success,
        let list = windows as? [AXUIElement], let window = list.first else { return 28 }
  var fullscreen: CFTypeRef?
  if AXUIElementCopyAttributeValue(window, "AXFullScreen" as CFString, &fullscreen) == .success,
     (fullscreen as? Bool) == true { return 0 }
  var button: CFTypeRef?
  guard AXUIElementCopyAttributeValue(window, kAXCloseButtonAttribute as CFString, &button) == .success,
        let button = button, CFGetTypeID(button) == AXUIElementGetTypeID() else { return 0 }
  return 28
}

struct ArenaWin { let id: CGWindowID; let frame: CGRect; let pid: pid_t }

func arenaWindow(pids: Set<pid_t>) -> ArenaWin? {
  guard !pids.isEmpty,
        let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]]
  else { return nil }
  var best: ArenaWin? = nil
  for w in list {
    guard let pid = w[kCGWindowOwnerPID as String] as? pid_t, pids.contains(pid) else { continue }
    guard let layer = w[kCGWindowLayer as String] as? Int, layer == 0 else { continue }
    guard let b = w[kCGWindowBounds as String] as? [String: CGFloat] else { continue }
    guard let wid = w[kCGWindowNumber as String] as? CGWindowID else { continue }
    let r = CGRect(x: b["X"] ?? 0, y: b["Y"] ?? 0, width: b["Width"] ?? 0, height: b["Height"] ?? 0)
    if r.width < 200 || r.height < 150 { continue }
    if best == nil || r.width * r.height > best!.frame.width * best!.frame.height { best = ArenaWin(id: wid, frame: r, pid: pid) }
  }
  return best
}

// ---------------------------------------------------------------------------
// Shared state between the geometry loop, the stdin reader and the capture loop
// ---------------------------------------------------------------------------
final class Shared {
  private let lock = NSLock()
  private var _win: ArenaWin? = nil
  private var _frontmost = false
  private var _captureEnabled = CommandLine.arguments.contains("--capture")
  private var _deckScanEnabled = CommandLine.arguments.contains("--deck-scan")
  private var _deckScanGeneration = 0
  private var _rateHz = DEFAULT_RATE_HZ
  /// Last time the cursor moved or the Arena rect changed (drives the burst rate).
  private var _lastActivity = Date.distantPast
  private var _lastDeckInteraction = Date.distantPast

  func setWindow(_ win: ArenaWin?, frontmost: Bool) {
    lock.lock(); defer { lock.unlock() }
    let windowChanged = _win?.id != win?.id || _win?.frame != win?.frame
    if windowChanged { _lastActivity = Date(); _lastDeckInteraction = Date() }
    if frontmost && !_frontmost { _lastDeckInteraction = Date() }
    _win = win
    _frontmost = frontmost
  }
  func noteActivity() { lock.lock(); _lastActivity = Date(); lock.unlock() }
  func noteDeckInteraction(_ point: CGPoint? = nil) {
    lock.lock(); defer { lock.unlock() }
    guard _frontmost, let win = _win else { return }
    if let point, !win.frame.contains(point) { return }
    _lastDeckInteraction = Date()
  }
  func setCapture(_ on: Bool) { lock.lock(); _captureEnabled = on; lock.unlock() }
  func setDeckScan(_ on: Bool) {
    lock.lock(); defer { lock.unlock() }
    if _deckScanEnabled != on { _deckScanGeneration += 1 }
    _deckScanEnabled = on
    if on { _lastDeckInteraction = Date() }
  }
  func setRate(_ hz: Double) { lock.lock(); _rateHz = max(0, hz); lock.unlock() }

  struct Snapshot {
    let win: ArenaWin?; let frontmost: Bool; let enabled: Bool; let rateHz: Double; let lastActivity: Date
    let deckScanEnabled: Bool; let deckScanGeneration: Int; let lastDeckInteraction: Date
  }
  func snapshot() -> Snapshot {
    lock.lock(); defer { lock.unlock() }
    return Snapshot(win: _win, frontmost: _frontmost, enabled: _captureEnabled, rateHz: _rateHz, lastActivity: _lastActivity,
                    deckScanEnabled: _deckScanEnabled, deckScanGeneration: _deckScanGeneration, lastDeckInteraction: _lastDeckInteraction)
  }
}
let shared = Shared()

// ---------------------------------------------------------------------------
// Stdin control channel
// ---------------------------------------------------------------------------
/// Hand activation back to Arena. AppKit calls run on the main queue, which
/// RunLoop.main.run() services.
func activateArena() {
  let pids = arenaPids()
  DispatchQueue.main.async {
    for pid in pids { NSRunningApplication(processIdentifier: pid)?.activate(options: []) }
  }
}

// Send one move directly to Arena's empty left gutter before it loses focus.
// postToPid does not move the physical cursor or deliver input to other apps.
func dismissHover() {
  guard let win = shared.snapshot().win else { return }
  let point = CGPoint(x: win.frame.minX + win.frame.width * 0.04,
                      y: win.frame.minY + win.frame.height * 0.5)
  CGEvent(mouseEventSource: nil, mouseType: .mouseMoved,
          mouseCursorPosition: point, mouseButton: .left)?.postToPid(win.pid)
}

DispatchQueue.global(qos: .utility).async {
  while let line = readLine(strippingNewline: true) {
    let parts = line.trimmingCharacters(in: .whitespaces).lowercased().split(separator: " ").map(String.init)
    guard let command = parts.first else { continue }
    switch command {
    case "activate": activateArena()
    case "dismiss-hover": dismissHover()
    case "capture": if parts.count >= 2 { shared.setCapture(parts[1] == "on") }
    case "deck-scan": if parts.count >= 2 { shared.setDeckScan(parts[1] == "on") }
    case "rate": if parts.count >= 2, let hz = Double(parts[1]) { shared.setRate(hz) }
    default: break
    }
  }
  exit(0) // stdin closed: parent gone
}

// ---------------------------------------------------------------------------
// One-shot capture loop (ScreenCaptureKit screenshots — no recording indicator)
// ---------------------------------------------------------------------------
final class Capture {
  var filter: SCContentFilter? = nil
  var filterWindowId: CGWindowID = 0
  var lastLookup = Date.distantPast
  var announced: Bool? = nil
  var lastGray: [UInt8] = []
  var lastW = 0, lastH = 0

  func announce(_ ok: Bool) {
    if announced != ok { announced = ok; emit("C \(ok ? "on" : "off")") }
  }

  /// Content filter for the Arena window; refreshed when the CGWindowID changes.
  func filterFor(_ win: ArenaWin) async -> SCContentFilter? {
    if let f = filter, filterWindowId == win.id { return f }
    // Don't hammer the window server if the id isn't shareable (yet).
    if Date().timeIntervalSince(lastLookup) < 1.0 { return nil }
    lastLookup = Date()
    do {
      let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
      guard let scw = content.windows.first(where: { $0.windowID == win.id }) else { return nil }
      filter = SCContentFilter(desktopIndependentWindow: scw)
      filterWindowId = win.id
      return filter
    } catch {
      announce(false)
      return nil
    }
  }

  /// Downscale a CGImage to FRAME_W×h 8-bit gray via CoreGraphics.
  func gray(of img: CGImage, aspect: CGFloat) -> (Int, Int, [UInt8])? {
    let w = FRAME_W
    let h = max(1, Int((CGFloat(w) / max(0.05, aspect)).rounded()))
    var buf = [UInt8](repeating: 0, count: w * h)
    let ok = buf.withUnsafeMutableBytes { raw -> Bool in
      guard let ctx = CGContext(data: raw.baseAddress, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w,
                                space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue)
      else { return false }
      ctx.interpolationQuality = .low
      ctx.draw(img, in: CGRect(x: 0, y: 0, width: w, height: h))
      return true
    }
    return ok ? (w, h, buf) : nil
  }

  /// Sum-of-absolute-differences change gate; also true on size change / first frame.
  func changed(_ w: Int, _ h: Int, _ g: [UInt8]) -> Bool {
    if w != lastW || h != lastH || lastGray.count != g.count { return true }
    var sad = 0
    for i in 0..<g.count { sad += abs(Int(g[i]) - Int(lastGray[i])) }
    // Mean per-pixel difference above half a gray level: rendered content, so
    // there is no sensor noise — anything larger is a real change.
    return sad * 2 > g.count
  }

  func captureOnce(win: ArenaWin) async {
    guard let filter = await filterFor(win) else { return }
    let aspect = win.frame.width / max(1, win.frame.height)
    let cfg = SCStreamConfiguration()
    cfg.width = FRAME_W
    cfg.height = max(1, Int((CGFloat(FRAME_W) / max(0.05, aspect)).rounded()))
    cfg.showsCursor = false
    cfg.pixelFormat = kCVPixelFormatType_32BGRA
    do {
      let img = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: cfg)
      guard let (w, h, g) = gray(of: img, aspect: aspect) else { return }
      announce(true)
      if changed(w, h, g) {
        lastW = w; lastH = h; lastGray = g
        emit("F \(w),\(h),\(Data(g).base64EncodedString())")
      }
    } catch {
      // Window vanished mid-capture (retry next tick with a fresh filter) or
      // Screen Recording denied.
      filter_reset()
      announce(false)
    }
  }

  func filter_reset() { filter = nil; filterWindowId = 0 }

  func run() async {
    while true {
      let s = shared.snapshot()
      guard s.enabled, s.rateHz > 0 else {
        if announced == true { announce(false) }
        filter_reset()
        lastGray = []; lastW = 0; lastH = 0 // force a full frame when re-enabled
        try? await Task.sleep(nanoseconds: 100_000_000)
        continue
      }
      guard let win = s.win else {
        filter_reset()
        try? await Task.sleep(nanoseconds: 250_000_000)
        continue
      }
      let burst = Date().timeIntervalSince(s.lastActivity) < BURST_WINDOW_S
      let hz: Double = !s.frontmost ? min(s.rateHz, 1.0) : (burst ? s.rateHz * 2 : s.rateHz)
      let started = Date()
      await captureOnce(win: win)
      let elapsed = Date().timeIntervalSince(started)
      let wait = max(0.005, 1.0 / hz - elapsed)
      try? await Task.sleep(nanoseconds: UInt64(wait * 1e9))
    }
  }
}
let capture = Capture()
Task.detached { await capture.run() }

// ---------------------------------------------------------------------------
// Deck OCR: separate full-resolution one-shot captures, never a recording.
// The permission preflight precedes ALL ScreenCaptureKit calls here, including
// enumerating shareable windows: enabling OCR must not trigger a system prompt.
// ---------------------------------------------------------------------------
struct DeckTextLine: Encodable {
  let text: String
  let confidence: Float
  let x: CGFloat, y: CGFloat, width: CGFloat, height: CGFloat
}

struct DeckObservation: Encodable {
  let at: Double
  let width: CGFloat, height: CGFloat
  let status: String
  let reason: String?
  let lines: [DeckTextLine]
}

final class DeckScanner {
  private var filter: SCContentFilter?
  private var filterWindowId: CGWindowID = 0

  private func resetFilter() { filter = nil; filterWindowId = 0 }

  private func publish(_ observation: DeckObservation, generation: Int) {
    let current = shared.snapshot()
    guard current.deckScanEnabled, current.deckScanGeneration == generation,
          let data = try? JSONEncoder().encode(observation), let json = String(data: data, encoding: .utf8) else { return }
    emit("D \(json)")
  }

  private func unavailable(_ reason: String, snapshot: Shared.Snapshot) {
    publish(DeckObservation(at: Date().timeIntervalSince1970 * 1000,
                            width: snapshot.win?.frame.width ?? 0, height: snapshot.win?.frame.height ?? 0,
                            status: "unavailable", reason: reason, lines: []), generation: snapshot.deckScanGeneration)
  }

  private func filterFor(_ win: ArenaWin) async throws -> SCContentFilter? {
    if let filter, filterWindowId == win.id { return filter }
    let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
    guard let window = content.windows.first(where: { $0.windowID == win.id }) else { return nil }
    let next = SCContentFilter(desktopIndependentWindow: window)
    filter = next
    filterWindowId = win.id
    return next
  }

  private func recognizeRegion(_ image: CGImage, region: CGRect) throws -> [DeckTextLine] {
    try autoreleasepool {
      let imageBounds = CGRect(x: 0, y: 0, width: image.width, height: image.height)
      let pixels = CGRect(x: region.minX * imageBounds.width, y: region.minY * imageBounds.height,
                          width: region.width * imageBounds.width, height: region.height * imageBounds.height)
        .integral.intersection(imageBounds)
      guard let crop = image.cropping(to: pixels) else { return [] }
      let request = VNRecognizeTextRequest()
      request.recognitionLevel = .accurate
      request.recognitionLanguages = ["en-US"]
      request.usesLanguageCorrection = false
      request.preferBackgroundProcessing = true
      try VNImageRequestHandler(cgImage: crop, options: [:]).perform([request])
      return (request.results ?? []).compactMap { observation in
        guard let candidate = observation.topCandidates(1).first,
              !candidate.string.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        // Vision uses bottom-left coordinates within this crop. Map back through
        // the actual rounded pixel bounds to the complete Arena window, including
        // its title bar, with a top-left origin.
        let rect = observation.boundingBox
        let x = max(0, min(1, (pixels.minX + rect.minX * pixels.width) / imageBounds.width))
        let y = max(0, min(1, (pixels.minY + (1 - rect.maxY) * pixels.height) / imageBounds.height))
        let width = min(1 - x, max(0, rect.width * pixels.width / imageBounds.width))
        let height = min(1 - y, max(0, rect.height * pixels.height / imageBounds.height))
        guard width > 0, height > 0 else { return nil }
        return DeckTextLine(text: candidate.string, confidence: candidate.confidence,
                            x: x, y: y, width: width, height: height)
      }
    }
  }

  private func recognize(_ image: CGImage) throws -> [DeckTextLine] {
    // Vision internally downsamples large inputs. On a full Retina window that
    // discards small "1x" rail quantities, even while reading card names well.
    // Separate physical crops keep these glyphs readable and keep the pool's
    // card titles available for associating a real click with the chosen card.
    let rail = CGRect(x: 0.76, y: 0.12, width: 0.24, height: 0.80)
    let pool = CGRect(x: 0, y: 0.18, width: 0.76, height: 0.74)
    let quantityColumn = CGRect(x: 0.785, y: 0.20, width: 0.03, height: 0.71)
    let quantities = try recognizeRegion(image, region: quantityColumn).filter {
      $0.text.range(of: "^\\s*(?:[0-9]{1,3}|[Il])\\s*(?:[x×])?\\s*[()\\[\\]|]*\\s*$",
                    options: [.regularExpression, .caseInsensitive]) != nil
    }
    let railLines = try recognizeRegion(image, region: rail).filter { line in
      // Prefer the dedicated numeric crop on the same row. Leave every other
      // rail result intact: either pass can miss a small isolated quantity.
      !(line.x >= 0.782 && line.x + line.width <= 0.816 && quantities.contains {
        abs(($0.y + $0.height / 2) - (line.y + line.height / 2)) < 0.012
      })
    }
    return try quantities + railLines + recognizeRegion(image, region: pool)
  }

  private func scan(_ snapshot: Shared.Snapshot, win: ArenaWin) async {
    do {
      guard let filter = try await filterFor(win) else {
        unavailable("capture-failed", snapshot: snapshot)
        return
      }
      let beforeCapture = shared.snapshot()
      guard beforeCapture.deckScanEnabled, beforeCapture.deckScanGeneration == snapshot.deckScanGeneration,
            beforeCapture.frontmost, beforeCapture.win?.id == win.id else { return }
      let config = SCStreamConfiguration()
      config.width = max(1, Int((win.frame.width * 2).rounded()))
      config.height = max(1, Int((win.frame.height * 2).rounded()))
      config.scalesToFit = true
      config.showsCursor = false
      config.ignoreShadowsSingleWindow = true
      config.ignoreGlobalClipSingleWindow = true
      config.pixelFormat = kCVPixelFormatType_32BGRA
      config.capturesAudio = false
      let at = Date().timeIntervalSince1970 * 1000
      let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
      let lines = try recognize(image)
      let current = shared.snapshot()
      // A slow OCR request must not publish a result from a window that has
      // since moved, closed, lost focus, or had scanning disabled and reenabled.
      guard current.frontmost, current.win?.id == win.id, current.win?.frame == win.frame else { return }
      publish(DeckObservation(at: at, width: win.frame.width, height: win.frame.height,
                              status: "ok", reason: nil, lines: lines), generation: snapshot.deckScanGeneration)
    } catch {
      resetFilter()
      unavailable(CGPreflightScreenCaptureAccess() ? "capture-failed" : "permission", snapshot: snapshot)
    }
  }

  func run() async {
    var lastScan = Date.distantPast
    var lastGeneration = -1
    var lastInteraction = Date.distantPast
    var confirmationReads = 0
    while true {
      let snapshot = shared.snapshot()
      guard snapshot.deckScanEnabled else {
        resetFilter()
        lastScan = Date.distantPast
        try? await Task.sleep(nanoseconds: 100_000_000)
        continue
      }
      if snapshot.deckScanGeneration != lastGeneration {
        lastGeneration = snapshot.deckScanGeneration
        lastScan = Date.distantPast
        confirmationReads = 2
      }
      if snapshot.lastDeckInteraction > lastInteraction {
        lastInteraction = snapshot.lastDeckInteraction
        confirmationReads = 2
      }
      // Edits and scrolling wake a short 1 Hz scan burst. Two reads are always
      // allowed to confirm a change, even when OCR itself takes a few seconds.
      // Quiet deck screens need only a 5-second fallback for unobserved changes.
      let active = confirmationReads > 0 || Date().timeIntervalSince(snapshot.lastDeckInteraction) < DECK_INTERACTION_WINDOW_S
      let interval = active ? DECK_ACTIVE_INTERVAL_S : DECK_IDLE_INTERVAL_S
      if Date().timeIntervalSince(lastScan) < interval {
        try? await Task.sleep(nanoseconds: 100_000_000)
        continue
      }
      lastScan = Date()
      if !CGPreflightScreenCaptureAccess() {
        resetFilter()
        unavailable("permission", snapshot: snapshot)
      } else if let win = snapshot.win {
        if snapshot.frontmost { await scan(snapshot, win: win) }
        else { unavailable("background", snapshot: snapshot) }
      } else {
        resetFilter()
        unavailable("no-window", snapshot: snapshot)
      }
      confirmationReads = max(0, confirmationReads - 1)
    }
  }
}
let deckScanner = DeckScanner()
Task.detached(priority: .utility) { await deckScanner.run() }

// ---------------------------------------------------------------------------
// Geometry loop (~60Hz, prints on change + 1Hz heartbeat); also polls the
// cursor so the capture loop can burst while the user is interacting.
// ---------------------------------------------------------------------------
// Listen without consuming input. Quick clicks must not disappear between geometry samples.
let inputMask = (CGEventMask(1) << CGEventType.leftMouseDown.rawValue) |
  (CGEventMask(1) << CGEventType.rightMouseDown.rawValue) |
  (CGEventMask(1) << CGEventType.scrollWheel.rawValue) |
  (CGEventMask(1) << CGEventType.keyDown.rawValue)
let inputTap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap,
  options: .listenOnly, eventsOfInterest: inputMask, callback: { _, type, event, _ in
    if type == .keyDown {
      shared.noteDeckInteraction()
      if event.getIntegerValueField(.keyboardEventKeycode) == 53,
         event.getIntegerValueField(.keyboardEventAutorepeat) == 0 { emit("K escape") }
    } else if type == .leftMouseDown || type == .rightMouseDown {
      let p = event.location
      shared.noteDeckInteraction(p)
      emit("M \(Int(p.x.rounded())),\(Int(p.y.rounded()))")
    } else if type == .scrollWheel {
      // Wheel input refreshes visible rows without pretending a card was clicked.
      shared.noteDeckInteraction(event.location)
    }
    return Unmanaged.passUnretained(event)
  }, userInfo: nil)
if let inputTap, let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, inputTap, 0) {
  CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
  CGEvent.tapEnable(tap: inputTap, enable: true)
}
// If input monitoring is unavailable, sample only the cheap input state at
// 125 Hz; window enumeration remains on the slower adaptive geometry loop.
if inputTap == nil {
  DispatchQueue.global(qos: .userInteractive).async {
    var mouseDown = false
    var escapeDown = false
    var keyEvents = CGEventSource.counterForEventType(.combinedSessionState, eventType: .keyDown)
    var scrollEvents = CGEventSource.counterForEventType(.combinedSessionState, eventType: .scrollWheel)
    while true {
      let down = CGEventSource.buttonState(.combinedSessionState, button: .left) || CGEventSource.buttonState(.combinedSessionState, button: .right)
      if down && !mouseDown, let p = CGEvent(source: nil)?.location {
        shared.noteDeckInteraction(p)
        emit("M \(Int(p.x.rounded())),\(Int(p.y.rounded()))")
      }
      let escape = CGEventSource.keyState(.combinedSessionState, key: 53)
      if escape && !escapeDown { emit("K escape") }
      let keys = CGEventSource.counterForEventType(.combinedSessionState, eventType: .keyDown)
      let scrolls = CGEventSource.counterForEventType(.combinedSessionState, eventType: .scrollWheel)
      if keys != keyEvents { shared.noteDeckInteraction() }
      if scrolls != scrollEvents, let p = CGEvent(source: nil)?.location { shared.noteDeckInteraction(p) }
      keyEvents = keys; scrollEvents = scrolls
      mouseDown = down; escapeDown = escape
      usleep(8_000)
    }
  }
}

DispatchQueue.global(qos: .userInteractive).async {
  var last = ""
  var pids = arenaPids()
  var tick = 0
  var lastGeometryChange = Date.distantPast
  var lastHeartbeat = Date.distantPast
  var lastCursor = CGPoint(x: -1, y: -1)
  while true {
    tick += 1
    if tick % 60 == 0 { pids = arenaPids() }
    let win = arenaWindow(pids: pids)
    var line = "G NOWIN"
    var fm = false
    if let w = win {
      let r = w.frame
      fm = frontmostOk()
      line = "G \(Int(r.origin.x.rounded())),\(Int(r.origin.y.rounded())),\(Int(r.width.rounded())),\(Int(r.height.rounded())),\(fm ? 1 : 0),\(titleBarHeight(w.pid))"
    } else if pids.isEmpty {
      pids = arenaPids()
    }
    shared.setWindow(win, frontmost: fm)
    if let ev = CGEvent(source: nil) {
      let p = ev.location
      if abs(p.x - lastCursor.x) >= 1 || abs(p.y - lastCursor.y) >= 1 {
        if lastCursor.x >= 0 { shared.noteActivity() }
        lastCursor = p
      }
    }
    // Print on change, plus a 1Hz heartbeat so a consumer that missed the
    // last line (or had it overwritten) converges.
    if line != last { lastGeometryChange = Date() }
    if line != last || Date().timeIntervalSince(lastHeartbeat) >= 1 {
      last = line; lastHeartbeat = Date(); emit(line)
    }
    usleep(Date().timeIntervalSince(lastGeometryChange) < 0.3 ? 16_000 : 100_000)
  }
}
RunLoop.main.run()

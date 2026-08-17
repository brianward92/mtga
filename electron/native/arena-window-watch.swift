// arena-window-watch — Arena window geometry + (optionally) a low-res
// luminance feed of the Arena window for the badge overlay's layer detection.
//
// Output lines (stdout):
//   G x,y,width,height,frontmost   window frame in points (top-left origin);
//                                  printed on change + a 1 Hz heartbeat
//   G NOWIN                        Arena not running / no on-screen window
//   F w,h,<base64 gray bytes>      one downscaled luminance frame (160 px wide,
//                                  aspect-correct height); only when the image
//                                  changed vs the previously emitted frame
//   C on|off                       frames flowing (capture enabled AND Screen
//                                  Recording granted) / not
//   M x,y                          a mouse button went down anywhere on screen
//                                  (global point, top-left origin). The overlay
//                                  steps aside for Arena's menus on a real
//                                  click, never on a hover.
// Args:  --capture   start with capture enabled (default: off).
// Stdin control channel (one command per line):
//   capture on | capture off       enable / disable the frame feed
//   rate <hz>                      base capture rate (default 4; 0 pauses)
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

let arenaBundleIds: Set<String> = ["com.wizards.mtga"]
let arenaNames: Set<String> = ["MTGA", "MTG Arena", "Magic: The Gathering Arena"]
let selfBundleIds: Set<String> = ["com.mtga.tracker", "com.github.Electron"]
let FRAME_W = 160
let DEFAULT_RATE_HZ = 4.0
let BURST_WINDOW_S = 1.5
let out = FileHandle.standardOutput
let outLock = NSLock()

func emit(_ line: String) {
  outLock.lock(); defer { outLock.unlock() }
  guard let data = (line + "\n").data(using: .utf8) else { return }
  do { try out.write(contentsOf: data) } catch { exit(0) } // parent gone
}

func arenaPids() -> Set<pid_t> {
  var pids = Set<pid_t>()
  for app in NSWorkspace.shared.runningApplications {
    if let bid = app.bundleIdentifier, arenaBundleIds.contains(bid) { pids.insert(app.processIdentifier) }
    else if let name = app.localizedName, arenaNames.contains(name) { pids.insert(app.processIdentifier) }
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

struct ArenaWin { let id: CGWindowID; let frame: CGRect }

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
    if best == nil || r.width * r.height > best!.frame.width * best!.frame.height { best = ArenaWin(id: wid, frame: r) }
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
  private var _rateHz = DEFAULT_RATE_HZ
  /// Last time the cursor moved or the Arena rect changed (drives the burst rate).
  private var _lastActivity = Date.distantPast

  func setWindow(_ win: ArenaWin?, frontmost: Bool) {
    lock.lock(); defer { lock.unlock() }
    if let a = _win, let b = win, a.frame != b.frame { _lastActivity = Date() }
    else if (_win == nil) != (win == nil) { _lastActivity = Date() }
    _win = win
    _frontmost = frontmost
  }
  func noteActivity() { lock.lock(); _lastActivity = Date(); lock.unlock() }
  func setCapture(_ on: Bool) { lock.lock(); _captureEnabled = on; lock.unlock() }
  func setRate(_ hz: Double) { lock.lock(); _rateHz = max(0, hz); lock.unlock() }

  struct Snapshot { let win: ArenaWin?; let frontmost: Bool; let enabled: Bool; let rateHz: Double; let lastActivity: Date }
  func snapshot() -> Snapshot {
    lock.lock(); defer { lock.unlock() }
    return Snapshot(win: _win, frontmost: _frontmost, enabled: _captureEnabled, rateHz: _rateHz, lastActivity: _lastActivity)
  }
}
let shared = Shared()

// ---------------------------------------------------------------------------
// Stdin control channel
// ---------------------------------------------------------------------------
DispatchQueue.global(qos: .utility).async {
  while let line = readLine(strippingNewline: true) {
    let parts = line.trimmingCharacters(in: .whitespaces).lowercased().split(separator: " ").map(String.init)
    guard parts.count >= 2 else { continue }
    switch parts[0] {
    case "capture": shared.setCapture(parts[1] == "on")
    case "rate": if let hz = Double(parts[1]) { shared.setRate(hz) }
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
Task { await capture.run() }

// ---------------------------------------------------------------------------
// Geometry loop (~30Hz, prints on change + 1Hz heartbeat); also polls the
// cursor so the capture loop can burst while the user is interacting.
// ---------------------------------------------------------------------------
DispatchQueue.global(qos: .userInteractive).async {
  var last = ""
  var pids = arenaPids()
  var tick = 0
  var lastCursor = CGPoint(x: -1, y: -1)
  var mouseWasDown = false
  while true {
    tick += 1
    if tick % 30 == 0 { pids = arenaPids() }
    let win = arenaWindow(pids: pids)
    var line = "G NOWIN"
    var fm = false
    if let w = win {
      let r = w.frame
      fm = frontmostOk()
      line = "G \(Int(r.origin.x.rounded())),\(Int(r.origin.y.rounded())),\(Int(r.width.rounded())),\(Int(r.height.rounded())),\(fm ? 1 : 0)"
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
      // Mouse-down edge, sampled rather than monitored: CGEventSource button
      // state needs no Accessibility grant and no AppKit event loop, unlike
      // NSEvent's global monitors. The overlay steps aside for Arena's menus
      // on a real click, never on a hover.
      let down = CGEventSource.buttonState(.combinedSessionState, button: .left) ||
        CGEventSource.buttonState(.combinedSessionState, button: .right)
      if down && !mouseWasDown {
        emit("M \(Int(p.x.rounded())),\(Int(p.y.rounded()))")
      }
      mouseWasDown = down
    }
    // Print on change, plus a 1Hz heartbeat so a consumer that missed the
    // last line (or had it overwritten) converges.
    if line != last || tick % 30 == 0 { last = line; emit(line) }
    usleep(33_000)
  }
}
dispatchMain()

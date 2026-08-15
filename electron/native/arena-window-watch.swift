// arena-window-watch — Arena window geometry + (optionally) a low-res
// luminance stream of the Arena window for the badge overlay's layer detection.
//
// Output lines (stdout, only on change for geometry):
//   G x,y,width,height,frontmost   window frame in points (top-left origin)
//   G NOWIN                        Arena not running / no on-screen window
//   F w,h,<base64 gray bytes>      one downscaled luminance frame (≤ 12 fps)
//   C on|off                       capture available (Screen Recording granted)
// Args: --capture   enable the frame stream (needs Screen Recording).
// Geometry uses CGWindowList (no Accessibility needed); frames use
// ScreenCaptureKit filtered to the Arena window only, so our own overlays are
// never in the image and no other window is ever captured.
import Foundation
import AppKit
import ScreenCaptureKit
import CoreMedia
import CoreVideo

let arenaBundleIds: Set<String> = ["com.wizards.mtga"]
let arenaNames: Set<String> = ["MTGA", "MTG Arena", "Magic: The Gathering Arena"]
let selfBundleIds: Set<String> = ["com.mtga.tracker", "com.github.Electron"]
let wantCapture = CommandLine.arguments.contains("--capture")
let FRAME_W = 160
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
// Frame stream (ScreenCaptureKit)
// ---------------------------------------------------------------------------
final class FrameSink: NSObject, SCStreamOutput, SCStreamDelegate {
  var lastEmit = Date.distantPast
  func stream(_ stream: SCStream, didOutputSampleBuffer sb: CMSampleBuffer, of type: SCStreamOutputType) {
    guard type == .screen, let pb = CMSampleBufferGetImageBuffer(sb) else { return }
    // SCK delivers frames only when content changes; still cap the rate.
    let now = Date()
    if now.timeIntervalSince(lastEmit) < (1.0 / 12.0) { return }
    lastEmit = now
    CVPixelBufferLockBaseAddress(pb, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(pb, .readOnly) }
    let w = CVPixelBufferGetWidth(pb), h = CVPixelBufferGetHeight(pb)
    guard let base = CVPixelBufferGetBaseAddress(pb) else { return }
    let stride = CVPixelBufferGetBytesPerRow(pb)
    var gray = [UInt8](repeating: 0, count: w * h)
    let p = base.assumingMemoryBound(to: UInt8.self)
    for y in 0..<h {
      let row = p + y * stride
      for x in 0..<w {
        let b = Int(row[x * 4]), g = Int(row[x * 4 + 1]), r = Int(row[x * 4 + 2])
        gray[y * w + x] = UInt8((299 * r + 587 * g + 114 * b) / 1000)
      }
    }
    emit("F \(w),\(h),\(Data(gray).base64EncodedString())")
  }
  func stream(_ stream: SCStream, didStopWithError error: Error) {
    capture.streamStopped()
  }
}

final class Capture {
  var stream: SCStream? = nil
  var streamWindowId: CGWindowID = 0
  var streamAspect: CGFloat = 0
  let sink = FrameSink()
  let queue = DispatchQueue(label: "arena.frames")
  var starting = false
  var announced: Bool? = nil

  func announce(_ ok: Bool) {
    if announced != ok { announced = ok; emit("C \(ok ? "on" : "off")") }
  }

  func streamStopped() {
    stream = nil
    streamWindowId = 0
  }

  /// Ensure a stream exists for the current Arena window (restart on window id
  /// / aspect change). Called from the geometry loop.
  func ensure(win: ArenaWin?) {
    guard wantCapture else { return }
    guard let win = win else {
      if let s = stream { s.stopCapture { _ in }; streamStopped() }
      return
    }
    let aspect = win.frame.width / max(1, win.frame.height)
    if let _ = stream, streamWindowId == win.id, abs(aspect - streamAspect) < 0.02 { return }
    if starting { return }
    starting = true
    Task {
      defer { starting = false }
      if let s = stream { try? await s.stopCapture(); streamStopped() }
      do {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        guard let scw = content.windows.first(where: { $0.windowID == win.id }) else { return }
        let filter = SCContentFilter(desktopIndependentWindow: scw)
        let cfg = SCStreamConfiguration()
        cfg.width = FRAME_W
        cfg.height = max(1, Int((CGFloat(FRAME_W) / aspect).rounded()))
        cfg.pixelFormat = kCVPixelFormatType_32BGRA
        cfg.minimumFrameInterval = CMTime(value: 1, timescale: 15)
        cfg.showsCursor = false
        cfg.queueDepth = 3
        let s = SCStream(filter: filter, configuration: cfg, delegate: sink)
        try s.addStreamOutput(sink, type: .screen, sampleHandlerQueue: queue)
        try await s.startCapture()
        stream = s
        streamWindowId = win.id
        streamAspect = aspect
        announce(true)
      } catch {
        announce(false)
      }
    }
  }
}

let capture = Capture()

// ---------------------------------------------------------------------------
// Geometry loop (~30Hz, prints on change)
// ---------------------------------------------------------------------------
DispatchQueue.global(qos: .userInteractive).async {
  var last = ""
  var pids = arenaPids()
  var tick = 0
  var lastEnsure = Date.distantPast
  while true {
    tick += 1
    if tick % 30 == 0 { pids = arenaPids() }
    let win = arenaWindow(pids: pids)
    var line = "G NOWIN"
    if let w = win {
      let r = w.frame
      line = "G \(Int(r.origin.x.rounded())),\(Int(r.origin.y.rounded())),\(Int(r.width.rounded())),\(Int(r.height.rounded())),\(frontmostOk() ? 1 : 0)"
    } else if pids.isEmpty {
      pids = arenaPids()
    }
    // Print on change, plus a 1Hz heartbeat so a consumer that missed the
    // last line (or had it overwritten) converges.
    if line != last || tick % 30 == 0 { last = line; emit(line) }
    if Date().timeIntervalSince(lastEnsure) > 1.0 {
      lastEnsure = Date()
      capture.ensure(win: win)
    }
    usleep(33_000)
  }
}
dispatchMain()

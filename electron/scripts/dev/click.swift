import Foundation
import CoreGraphics
let a = CommandLine.arguments
guard a.count >= 3, let x = Double(a[1]), let y = Double(a[2]) else { exit(1) }
let p = CGPoint(x: x, y: y)
CGWarpMouseCursorPosition(p)
usleep(80_000)
for t in [CGEventType.leftMouseDown, CGEventType.leftMouseUp] {
  if let e = CGEvent(mouseEventSource: nil, mouseType: t, mouseCursorPosition: p, mouseButton: .left) { e.post(tap: .cghidEventTap) }
  usleep(60_000)
}

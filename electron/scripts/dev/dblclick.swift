import Foundation
import CoreGraphics
let a = CommandLine.arguments
guard a.count >= 3, let x = Double(a[1]), let y = Double(a[2]) else { exit(1) }
let p = CGPoint(x: x, y: y)
CGWarpMouseCursorPosition(p); usleep(80_000)
for state in [1, 2] as [Int64] {
  for t in [CGEventType.leftMouseDown, CGEventType.leftMouseUp] {
    let e = CGEvent(mouseEventSource: nil, mouseType: t, mouseCursorPosition: p, mouseButton: .left)!
    e.setIntegerValueField(.mouseEventClickState, value: state)
    e.post(tap: .cghidEventTap); usleep(40_000)
  }
  usleep(90_000)
}

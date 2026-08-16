import Foundation
import CoreGraphics
let a = CommandLine.arguments
guard a.count >= 3, let x = Double(a[1]), let y = Double(a[2]) else { exit(1) }
let p = CGPoint(x: x, y: y)
func post(_ t: CGEventType, _ pt: CGPoint, _ clicks: Int64 = 1) {
  let e = CGEvent(mouseEventSource: nil, mouseType: t, mouseCursorPosition: pt, mouseButton: .left)!
  e.setIntegerValueField(.mouseEventClickState, value: clicks)
  e.post(tap: .cghidEventTap)
}
// Approach with real movement so Unity updates hover state, then click.
CGWarpMouseCursorPosition(CGPoint(x: x, y: y - 60)); usleep(60_000)
for i in 1...12 { post(.mouseMoved, CGPoint(x: x, y: y - 60 + Double(i) * 5)); usleep(12_000) }
post(.mouseMoved, p); usleep(250_000)
post(.leftMouseDown, p); usleep(90_000)
post(.leftMouseUp, p)

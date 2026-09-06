// scroll <x> <y> <lines>: move the pointer to (x,y) in screen points and post a
// vertical scroll-wheel event; negative lines scroll down.
import CoreGraphics
import Foundation
let a = CommandLine.arguments
guard a.count == 4, let x = Double(a[1]), let y = Double(a[2]), let n = Int32(a[3]) else { print("usage: scroll x y lines"); exit(2) }
let p = CGPoint(x: x, y: y)
CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: p, mouseButton: .left)?.post(tap: .cghidEventTap)
usleep(80_000)
if let e = CGEvent(scrollWheelEvent2Source: nil, units: .line, wheelCount: 1, wheel1: n, wheel2: 0, wheel3: 0) { e.location = p; e.post(tap: .cghidEventTap) }

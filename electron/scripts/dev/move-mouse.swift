// Dev helper: move the cursor to x y (points, top-left origin). Not shipped.
import Foundation
import CoreGraphics
let a = CommandLine.arguments
guard a.count >= 3, let x = Double(a[1]), let y = Double(a[2]) else { print("usage: move-mouse x y"); exit(1) }
let p = CGPoint(x: x, y: y)
CGWarpMouseCursorPosition(p)
if let e = CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: p, mouseButton: .left) { e.post(tap: .cghidEventTap) }

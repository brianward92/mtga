// drag <fromX> <fromY> <toX> <toY> [steps]
// Press at one screen point, move in small steps, release at another.
//
// Arena's hand cards cannot be played with a click: a click only opens the
// card's zoom preview. Cards must be dragged onto the battlefield, and Unity
// needs to see intermediate motion — a single jump from source to target is
// dropped as if nothing moved.
import Foundation
import CoreGraphics

let a = CommandLine.arguments
guard a.count >= 5, let x1 = Double(a[1]), let y1 = Double(a[2]),
      let x2 = Double(a[3]), let y2 = Double(a[4]) else {
  FileHandle.standardError.write("usage: drag fromX fromY toX toY [steps]\n".data(using: .utf8)!)
  exit(2)
}
let steps = a.count >= 6 ? max(4, Int(a[5]) ?? 24) : 24
let src = CGPoint(x: x1, y: y1)
let dst = CGPoint(x: x2, y: y2)

func post(_ type: CGEventType, _ p: CGPoint) {
  CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: p, mouseButton: .left)?.post(tap: .cghidEventTap)
}

post(.mouseMoved, src)
usleep(220_000)          // let the card register the hover before the press
post(.leftMouseDown, src)
usleep(160_000)
for i in 1...steps {
  let t = Double(i) / Double(steps)
  post(.leftMouseDragged, CGPoint(x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t))
  usleep(16_000)
}
usleep(160_000)
post(.leftMouseUp, dst)

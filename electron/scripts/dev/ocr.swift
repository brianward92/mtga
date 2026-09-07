// ocr <image.png> [minHeightFraction]
// Apple Vision text recognition. Prints one JSON object per recognised line:
//   {"text":"3x Esquire of the King","x":0.12,"y":0.04,"w":0.6,"h":0.03}
// with x/y/w/h normalised to the image, origin TOP-left (Vision's is
// bottom-left; converted here). Used by deckbuild.ts to read Arena's deck
// list rail as a checkpoint: Arena logs nothing between clicks, so the
// screen is the only truth for the intermediate deck.
import Foundation
import Vision
import ImageIO

let args = CommandLine.arguments
guard args.count >= 2, let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: args[1]) as CFURL, nil),
      let image = CGImageSourceCreateImageAtIndex(src, 0, nil) else {
  FileHandle.standardError.write("usage: ocr <image.png>\n".data(using: .utf8)!); exit(2)
}
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = false   // card names are not dictionary words
request.recognitionLanguages = ["en-US"]
if args.count >= 3, let f = Double(args[2]) { request.minimumTextHeight = Float(f) }
let handler = VNImageRequestHandler(cgImage: image, options: [:])
do { try handler.perform([request]) } catch {
  FileHandle.standardError.write("ocr: \(error)\n".data(using: .utf8)!); exit(1)
}
let out = FileHandle.standardOutput
for obs in request.results ?? [] {
  guard let top = obs.topCandidates(1).first else { continue }
  let b = obs.boundingBox
  let esc = top.string.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"")
  let line = String(format: "{\"text\":\"%@\",\"x\":%.4f,\"y\":%.4f,\"w\":%.4f,\"h\":%.4f,\"conf\":%.2f}\n",
                    esc, b.origin.x, 1 - b.origin.y - b.size.height, b.size.width, b.size.height, top.confidence)
  out.write(line.data(using: .utf8)!)
}

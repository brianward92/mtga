/**
 * Byte-oriented line splitter for incremental log tailing.
 *
 * Chunks read from fs.createReadStream are raw Buffers; a multi-byte UTF-8
 * character (or a log line) can be split across chunk boundaries. This class
 * accumulates bytes and only decodes *complete* lines, so decoding never sees
 * a torn character. All offsets stay in byte space — never mix byte offsets
 * with JS string indices.
 */

const NEWLINE = 0x0a // \n
const CARRIAGE = 0x0d // \r

/** Splits arbitrary byte chunks into complete UTF-8 lines without tearing. */
export class LineSplitter {
  private remainder: Buffer = Buffer.alloc(0)

  /**
   * Push a raw chunk; returns every complete line contained in
   * remainder + chunk. Trailing partial line is kept for the next push.
   */
  push(chunk: Buffer): string[] {
    const data = this.remainder.length > 0 ? Buffer.concat([this.remainder, chunk]) : chunk
    const lines: string[] = []
    let start = 0
    let idx = data.indexOf(NEWLINE, start)

    while (idx !== -1) {
      let end = idx
      if (end > start && data[end - 1] === CARRIAGE) end--
      lines.push(data.toString('utf-8', start, end))
      start = idx + 1
      idx = data.indexOf(NEWLINE, start)
    }

    this.remainder = data.subarray(start)
    return lines
  }

  /**
   * Emit whatever partial line is buffered (e.g. a file that does not end in
   * a newline). Only safe on files that will not grow again (Player-prev.log,
   * end-of-replay) — flushing a live tail would split a line in two.
   */
  flush(): string | null {
    if (this.remainder.length === 0) return null
    const line = this.remainder.toString('utf-8')
    this.remainder = Buffer.alloc(0)
    return line
  }

  /** Bytes currently held back as a partial line. */
  get pendingBytes(): number {
    return this.remainder.length
  }

  /** Discard any buffered partial line. */
  reset(): void {
    this.remainder = Buffer.alloc(0)
  }
}

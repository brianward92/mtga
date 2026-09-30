import { describe, it, expect } from 'vitest'
import { parseWatchLine, parseFrameLine, parseDeckScreenLine } from '../main/arena-geometry'

describe('parseWatchLine', () => {
  it('parses a G geometry line with frontmost flag', () => {
    expect(parseWatchLine('G 10,33,1512,949,1')).toEqual({
      status: 'found',
      rect: { x: 10, y: 33, width: 1512, height: 949 },
      frontmost: true
    })
    expect(parseWatchLine('G 0,0,800,600,0')).toEqual({
      status: 'found',
      rect: { x: 0, y: 0, width: 800, height: 600 },
      frontmost: false
    })
  })

  it('accepts the bare (legacy, no "G " prefix) form and trailing whitespace', () => {
    expect(parseWatchLine('-5,20,300,200,1\n')).toEqual({
      status: 'found',
      rect: { x: -5, y: 20, width: 300, height: 200 },
      frontmost: true
    })
  })

  it('maps NOWIN / NOPROC to no-window', () => {
    expect(parseWatchLine('G NOWIN')).toEqual({ status: 'no-window' })
    expect(parseWatchLine('NOPROC')).toEqual({ status: 'no-window' })
  })

  it('treats a zero-sized rect as no-window', () => {
    expect(parseWatchLine('G 1,2,0,600,1')).toEqual({ status: 'no-window' })
    expect(parseWatchLine('G 1,2,800,0,1')).toEqual({ status: 'no-window' })
  })

  it('returns null for frame, capture and malformed lines', () => {
    expect(parseWatchLine('F 2,1,AAA=')).toBeNull()
    expect(parseWatchLine('C on')).toBeNull()
    expect(parseWatchLine('C off')).toBeNull()
    expect(parseWatchLine('')).toBeNull()
    expect(parseWatchLine('G 1,2,3')).toBeNull()
    expect(parseWatchLine('G 1,2,3,4')).toBeNull()
    expect(parseWatchLine('G a,b,c,d,e')).toBeNull()
    expect(parseWatchLine('garbage')).toBeNull()
  })
})

describe('parseFrameLine', () => {
  it('decodes a "F w,h,base64" line into row-major luminance', () => {
    const bytes = Uint8Array.from([0, 64, 128, 255, 10, 20])
    const line = `F 3,2,${Buffer.from(bytes).toString('base64')}`
    const frame = parseFrameLine(line)
    expect(frame).not.toBeNull()
    expect(frame!.width).toBe(3)
    expect(frame!.height).toBe(2)
    expect(Array.from(frame!.data)).toEqual([0, 64, 128, 255, 10, 20])
  })

  it('rejects size/payload mismatch', () => {
    const b64 = Buffer.from([1, 2, 3]).toString('base64')
    expect(parseFrameLine(`F 2,2,${b64}`)).toBeNull()
    expect(parseFrameLine(`F 3,1,${b64}`)).not.toBeNull()
  })

  it('rejects non-frame and malformed lines', () => {
    expect(parseFrameLine('G 1,2,3,4,1')).toBeNull()
    expect(parseFrameLine('C on')).toBeNull()
    expect(parseFrameLine('F ')).toBeNull()
    expect(parseFrameLine('F 3,2')).toBeNull()
    expect(parseFrameLine('F 0,2,AA==')).toBeNull()
    expect(parseFrameLine('F x,y,AA==')).toBeNull()
  })
})

describe('parseDeckScreenLine', () => {
  const observation = {
    at: 1790700000123,
    width: 1280,
    height: 748,
    status: 'ok',
    lines: [
      { text: '40/40 Cards', confidence: 0.98, x: 0.82, y: 0.13, width: 0.12, height: 0.025 },
      { text: '2 Fractured Reality', confidence: 0.91, x: 0.8, y: 0.22, width: 0.18, height: 0.022 }
    ]
  }

  it('preserves capture time, point dimensions, text and normalized top-left bounds', () => {
    expect(parseDeckScreenLine(`D ${JSON.stringify(observation)}`)).toEqual(observation)
    expect(parseWatchLine(`D ${JSON.stringify(observation)}`)).toBeNull()
  })

  it('accepts a readable window with no text without inventing deck data', () => {
    const empty = { ...observation, lines: [] }
    expect(parseDeckScreenLine(`D ${JSON.stringify(empty)}`)).toEqual(empty)
  })

  it('reports permission failure and no-window observations without pretending they are empty decks', () => {
    for (const reason of ['permission', 'no-window', 'background', 'capture-failed']) {
      const unavailable = { at: observation.at, width: 0, height: 0, status: 'unavailable', reason, lines: [] }
      expect(parseDeckScreenLine(`D ${JSON.stringify(unavailable)}`)).toEqual(unavailable)
    }
  })

  it('rejects malformed envelopes and wrong native channels', () => {
    for (const line of ['D ', 'D {', 'D null', 'D []', 'F 2,1,AAA=', 'G 0,0,1280,748,1']) {
      expect(parseDeckScreenLine(line)).toBeNull()
    }
    for (const patch of [
      { at: '1790700000123' }, { at: -1 }, { at: null }, { width: 0 }, { height: -1 },
      { width: '1280' }, { status: 'ready' }, { reason: 1 }, { lines: null }, { lines: {} },
      { status: 'unavailable' }
    ]) {
      expect(parseDeckScreenLine(`D ${JSON.stringify({ ...observation, ...patch })}`)).toBeNull()
    }
  })

  it('rejects any unsafe line rather than using a partially validated deck observation', () => {
    for (const patch of [
      { text: '' }, { text: ' ' }, { text: 2 }, { confidence: -0.1 }, { confidence: 1.1 },
      { confidence: null }, { x: -0.1 }, { x: 1.1 }, { y: -0.1 }, { width: 0 },
      { height: 0 }, { width: 0.5 }, { y: 0.99, height: 0.1 }, { x: '0.82' }
    ]) {
      const invalid = { ...observation.lines[0], ...patch }
      expect(parseDeckScreenLine(`D ${JSON.stringify({ ...observation, lines: [observation.lines[0], invalid] })}`)).toBeNull()
    }
    for (const line of [null, [], '40/40 Cards']) {
      expect(parseDeckScreenLine(`D ${JSON.stringify({ ...observation, lines: [line] })}`)).toBeNull()
    }
  })
})

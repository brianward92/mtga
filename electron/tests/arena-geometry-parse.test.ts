import { describe, it, expect } from 'vitest'
import { parseWatchLine, parseFrameLine } from '../main/arena-geometry'

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

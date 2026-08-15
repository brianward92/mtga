/**
 * Minimal NumPy .npz / .npy reader (pure TS, no deps).
 *
 * Supports what DraftFM's serving assets use: stored or deflated zip entries,
 * little-endian numeric dtypes (f2/f4/f8, i1..i8, u1..u8, b1), and fixed-width
 * unicode strings (<Un, UTF-32LE) including 0-dim scalars.
 */
import { inflateRawSync } from 'zlib'

export type NpyData =
  | { kind: 'f16'; shape: number[]; data: Uint16Array }
  | { kind: 'f32'; shape: number[]; data: Float32Array }
  | { kind: 'f64'; shape: number[]; data: Float64Array }
  | { kind: 'i8'; shape: number[]; data: Int8Array }
  | { kind: 'i16'; shape: number[]; data: Int16Array }
  | { kind: 'i32'; shape: number[]; data: Int32Array }
  | { kind: 'i64'; shape: number[]; data: BigInt64Array }
  | { kind: 'u8'; shape: number[]; data: Uint8Array }
  | { kind: 'u16'; shape: number[]; data: Uint16Array }
  | { kind: 'u32'; shape: number[]; data: Uint32Array }
  | { kind: 'u64'; shape: number[]; data: BigUint64Array }
  | { kind: 'bool'; shape: number[]; data: Uint8Array }
  | { kind: 'str'; shape: number[]; data: string[] }

export interface NpzArchive {
  [name: string]: NpyData
}

/** Parse a .npy buffer. */
export function parseNpy(buf: Buffer): NpyData {
  if (buf.length < 10 || buf[0] !== 0x93 || buf.toString('latin1', 1, 6) !== 'NUMPY') {
    throw new Error('not a .npy buffer')
  }
  const major = buf[6]
  let headerLen: number
  let offset: number
  if (major === 1) {
    headerLen = buf.readUInt16LE(8)
    offset = 10
  } else {
    headerLen = buf.readUInt32LE(8)
    offset = 12
  }
  const header = buf.toString('latin1', offset, offset + headerLen)
  const descr = /'descr':\s*'([^']+)'/.exec(header)?.[1]
  const fortran = /'fortran_order':\s*(True|False)/.exec(header)?.[1] === 'True'
  const shapeStr = /'shape':\s*\(([^)]*)\)/.exec(header)?.[1] ?? ''
  const shape = shapeStr.split(',').map(s => s.trim()).filter(Boolean).map(Number)
  if (!descr) throw new Error(`npy: unparseable header ${header}`)
  if (fortran) throw new Error('npy: fortran_order arrays are not supported')
  const count = shape.reduce((a, b) => a * b, 1)
  const body = buf.subarray(offset + headerLen)
  const view = (bytesPer: number): ArrayBuffer =>
    body.buffer.slice(body.byteOffset, body.byteOffset + count * bytesPer) as ArrayBuffer

  const endian = descr[0]
  if (endian === '>') throw new Error(`npy: big-endian dtype ${descr} not supported`)
  const code = descr.replace(/^[<|=]/, '')
  switch (code) {
    case 'f2': return { kind: 'f16', shape, data: new Uint16Array(view(2)) }
    case 'f4': return { kind: 'f32', shape, data: new Float32Array(view(4)) }
    case 'f8': return { kind: 'f64', shape, data: new Float64Array(view(8)) }
    case 'i1': return { kind: 'i8', shape, data: new Int8Array(view(1)) }
    case 'i2': return { kind: 'i16', shape, data: new Int16Array(view(2)) }
    case 'i4': return { kind: 'i32', shape, data: new Int32Array(view(4)) }
    case 'i8': return { kind: 'i64', shape, data: new BigInt64Array(view(8)) }
    case 'u1': return { kind: 'u8', shape, data: new Uint8Array(view(1)) }
    case 'u2': return { kind: 'u16', shape, data: new Uint16Array(view(2)) }
    case 'u4': return { kind: 'u32', shape, data: new Uint32Array(view(4)) }
    case 'u8': return { kind: 'u64', shape, data: new BigUint64Array(view(8)) }
    case 'b1': return { kind: 'bool', shape, data: new Uint8Array(view(1)) }
    default: {
      const m = /^U(\d+)$/.exec(code)
      if (!m) throw new Error(`npy: unsupported dtype ${descr}`)
      const width = Number(m[1])
      const strs: string[] = []
      for (let i = 0; i < count; i++) {
        const cps: number[] = []
        const base = i * width * 4
        for (let c = 0; c < width; c++) {
          const cp = body.readUInt32LE(base + c * 4)
          if (cp === 0) break
          cps.push(cp)
        }
        strs.push(String.fromCodePoint(...cps))
      }
      return { kind: 'str', shape, data: strs }
    }
  }
}

/** Parse a .npz (zip) buffer into named arrays. */
export function parseNpz(buf: Buffer): NpzArchive {
  const out: NpzArchive = {}
  // Walk local file headers sequentially (npz archives are simple, no zip64).
  let pos = 0
  while (pos + 30 <= buf.length && buf.readUInt32LE(pos) === 0x04034b50) {
    const flags = buf.readUInt16LE(pos + 6)
    const method = buf.readUInt16LE(pos + 8)
    let compSize = buf.readUInt32LE(pos + 18)
    let uncompSize = buf.readUInt32LE(pos + 22)
    const nameLen = buf.readUInt16LE(pos + 26)
    const extraLen = buf.readUInt16LE(pos + 28)
    const name = buf.toString('utf8', pos + 30, pos + 30 + nameLen)
    const dataStart = pos + 30 + nameLen + extraLen
    let zip64 = false
    if ((flags & 0x8) || compSize === 0xffffffff || uncompSize === 0xffffffff) {
      // Sizes live in the central directory (streamed / zip64 entries).
      const cd = findCentralEntry(buf, name)
      if (!cd) throw new Error(`npz: cannot size entry ${name}`)
      compSize = cd.compSize
      uncompSize = cd.uncompSize
      zip64 = true
    }
    const raw = buf.subarray(dataStart, dataStart + compSize)
    let data: Buffer
    if (method === 0) data = raw
    else if (method === 8) data = inflateRawSync(raw)
    else throw new Error(`npz: unsupported compression method ${method} for ${name}`)
    if (uncompSize && data.length !== uncompSize) throw new Error(`npz: size mismatch for ${name}`)
    const key = name.endsWith('.npy') ? name.slice(0, -4) : name
    out[key] = parseNpy(Buffer.from(data.buffer, data.byteOffset, data.length))
    pos = dataStart + compSize
    if (flags & 0x8) {
      // Data descriptor: optional signature, crc, then sizes (4 or 8 bytes each).
      if (pos + 4 <= buf.length && buf.readUInt32LE(pos) === 0x08074b50) pos += 4
      pos += 4 + (zip64 && (buf.length - pos >= 16) && buf.readUInt32LE(pos + 4) !== 0x04034b50 && isZip64Descriptor(buf, pos, compSize, uncompSize) ? 16 : 8)
    }
  }
  return out
}

/**
 * Sizes for `name` from the central directory, honouring zip64 extra fields
 * (numpy writes every entry with force_zip64: 0xFFFFFFFF placeholders in the
 * fixed fields and 8-byte sizes in extra id 0x0001).
 */
function findCentralEntry(buf: Buffer, name: string): { compSize: number; uncompSize: number } | null {
  let cdStart = -1
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      cdStart = buf.readUInt32LE(i + 16)
      if (cdStart === 0xffffffff) {
        // zip64 EOCD locator sits right before the EOCD
        const loc = i - 20
        if (loc >= 0 && buf.readUInt32LE(loc) === 0x07064b50) {
          const z64 = Number(buf.readBigUInt64LE(loc + 8))
          if (buf.readUInt32LE(z64) === 0x06064b50) cdStart = Number(buf.readBigUInt64LE(z64 + 48))
        }
      }
      break
    }
  }
  if (cdStart < 0) return null
  let p = cdStart
  while (p + 46 <= buf.length && buf.readUInt32LE(p) === 0x02014b50) {
    let compSize = buf.readUInt32LE(p + 20)
    let uncompSize = buf.readUInt32LE(p + 24)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const entryName = buf.toString('utf8', p + 46, p + 46 + nameLen)
    if (entryName === name) {
      let e = p + 46 + nameLen
      const end = e + extraLen
      while (e + 4 <= end) {
        const id = buf.readUInt16LE(e)
        const len = buf.readUInt16LE(e + 2)
        if (id === 0x0001) {
          let q = e + 4
          if (uncompSize === 0xffffffff) { uncompSize = Number(buf.readBigUInt64LE(q)); q += 8 }
          if (compSize === 0xffffffff) { compSize = Number(buf.readBigUInt64LE(q)); q += 8 }
        }
        e += 4 + len
      }
      return { compSize, uncompSize }
    }
    p += 46 + nameLen + extraLen + commentLen
  }
  return null
}

function isZip64Descriptor(buf: Buffer, pos: number, compSize: number, uncompSize: number): boolean {
  // After the CRC (4 bytes) either two 4-byte sizes or two 8-byte sizes follow.
  const c8 = Number(buf.readBigUInt64LE(pos + 4))
  const u8 = Number(buf.readBigUInt64LE(pos + 12))
  return c8 === compSize && u8 === uncompSize
}

/** IEEE half → float32 (scalar). */
export function halfToFloat(h: number): number {
  const s = (h & 0x8000) ? -1 : 1
  const e = (h >> 10) & 0x1f
  const f = h & 0x3ff
  if (e === 0) return s * Math.pow(2, -14) * (f / 1024)
  if (e === 31) return f ? NaN : s * Infinity
  return s * Math.pow(2, e - 15) * (1 + f / 1024)
}

/** float16 array → Float32Array. */
export function halfArrayToFloat32(src: Uint16Array): Float32Array {
  const out = new Float32Array(src.length)
  for (let i = 0; i < src.length; i++) out[i] = halfToFloat(src[i])
  return out
}

/**
 * Byte-offset line splitter tests — the watcher must never mix byte offsets
 * with JS string indices, and must decode multi-byte UTF-8 characters that
 * straddle read-chunk boundaries.
 */

import { describe, it, expect } from 'vitest'
import { LineSplitter } from '../main/parser/line-splitter'

describe('LineSplitter', () => {
  it('splits complete lines and holds the trailing partial', () => {
    const splitter = new LineSplitter()
    const lines = splitter.push(Buffer.from('one\ntwo\nthr', 'utf-8'))
    expect(lines).toEqual(['one', 'two'])
    expect(splitter.pendingBytes).toBe(3)

    const more = splitter.push(Buffer.from('ee\n', 'utf-8'))
    expect(more).toEqual(['three'])
    expect(splitter.pendingBytes).toBe(0)
  })

  it('decodes a multi-byte UTF-8 character split across chunk boundaries', () => {
    const splitter = new LineSplitter()
    const text = 'Étude — Æther\nnext\n' // multi-byte chars: É, —, Æ
    const bytes = Buffer.from(text, 'utf-8')

    // Split INSIDE the first multi-byte character (É is 2 bytes: 0xC3 0x89)
    const cut = 1
    expect(bytes[0]).toBe(0xc3) // sanity: we really are mid-character

    const first = splitter.push(bytes.subarray(0, cut))
    expect(first).toEqual([])

    const second = splitter.push(bytes.subarray(cut))
    expect(second).toEqual(['Étude — Æther', 'next'])
  })

  it('survives byte-by-byte feeding of multi-byte content', () => {
    const splitter = new LineSplitter()
    const text = '★draft★\n日本語のカード\n'
    const bytes = Buffer.from(text, 'utf-8')

    const lines: string[] = []
    for (let i = 0; i < bytes.length; i++) {
      lines.push(...splitter.push(bytes.subarray(i, i + 1)))
    }
    expect(lines).toEqual(['★draft★', '日本語のカード'])
  })

  it('strips \\r from CRLF line endings', () => {
    const splitter = new LineSplitter()
    const lines = splitter.push(Buffer.from('alpha\r\nbeta\r\n', 'utf-8'))
    expect(lines).toEqual(['alpha', 'beta'])
  })

  it('flush emits the final unterminated line', () => {
    const splitter = new LineSplitter()
    splitter.push(Buffer.from('complete\npartial', 'utf-8'))
    expect(splitter.flush()).toBe('partial')
    expect(splitter.flush()).toBeNull()
  })
})

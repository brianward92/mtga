import { EventEmitter } from 'events'
import { describe, expect, it, vi } from 'vitest'
import { startDraftLogPipeline, type DraftLogSink } from '../main/parser/pipeline'
import type { DraftParser } from '../main/parser/draft-parser'
import type { LogWatcher } from '../main/parser/watcher'
import type { DraftPickRecord, DraftSessionSnapshot } from '../main/parser/draft-session'

class FakeParser extends EventEmitter {
  lines: string[] = []
  handleLine(line: string): void { this.lines.push(line) }
}

class FakeWatcher extends EventEmitter {
  starts = 0
  async start(): Promise<void> { this.starts += 1 }
}

describe('draft log pipeline wiring', () => {
  it('routes parser, replay, and detailed-log events to the coordinator sink', () => {
    const parser = new FakeParser()
    const watcher = new FakeWatcher()
    const order: string[] = []
    const sink: DraftLogSink = {
      onDraftStart: vi.fn(() => order.push('draft-start')),
      onDraftPack: vi.fn(() => order.push('draft-pack')),
      onDraftPick: vi.fn(() => order.push('draft-pick')),
      onDraftEnd: vi.fn(() => order.push('draft-end')),
      setWarning: vi.fn(warning => order.push(`warning:${warning ?? 'none'}`)),
      setReplaying: vi.fn(replaying => order.push(`replaying:${replaying}`)),
      resumeAfterReplay: vi.fn(() => order.push('replay-complete'))
    }
    const snapshot = { draftId: 'd1' } as DraftSessionSnapshot
    const pick = { pack: 1, pick: 1, grpIds: [7], packGrpIds: [7, 8] } as DraftPickRecord

    expect(startDraftLogPipeline(sink, {
      parser: parser as unknown as DraftParser,
      watcher: watcher as unknown as LogWatcher
    })).toBe(watcher)
    expect(watcher.starts).toBe(1)

    watcher.emit('line', 'draft line', false)
    watcher.emit('replay-start')
    parser.emit('draft-start', snapshot)
    parser.emit('draft-pack', snapshot)
    parser.emit('draft-pick', snapshot, pick)
    parser.emit('draft-end', snapshot)
    parser.emit('detailed-logs', { enabled: false })
    parser.emit('detailed-logs', { enabled: true })
    watcher.emit('replay-complete')

    expect(parser.lines).toEqual(['draft line'])
    expect(sink.setReplaying).toHaveBeenCalledWith(true)
    expect(sink.onDraftStart).toHaveBeenCalledWith(snapshot)
    expect(vi.mocked(sink.onDraftStart).mock.calls[0][0]).toBe(snapshot)
    expect(sink.onDraftPack).toHaveBeenCalledWith(snapshot)
    expect(sink.onDraftPick).toHaveBeenCalledWith(snapshot, pick)
    expect(vi.mocked(sink.onDraftPick).mock.calls[0][0]).toBe(snapshot)
    expect(vi.mocked(sink.onDraftPick).mock.calls[0][1]).toBe(pick)
    expect(sink.onDraftEnd).toHaveBeenCalledWith(snapshot)
    expect(sink.setWarning).toHaveBeenNthCalledWith(1, 'Enable Detailed Logs in Arena: Options → Account → Detailed Logs (Plugin Support)')
    expect(sink.setWarning).toHaveBeenNthCalledWith(2, null)
    expect(sink.resumeAfterReplay).toHaveBeenCalledOnce()
    expect(order).toEqual([
      'replaying:true',
      'draft-start',
      'draft-pack',
      'draft-pick',
      'draft-end',
      'warning:Enable Detailed Logs in Arena: Options → Account → Detailed Logs (Plugin Support)',
      'warning:none',
      'replay-complete'
    ])
  })
})

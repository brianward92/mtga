import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readdirSync, readFileSync, utimesSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { archiveLogs } from '../main/data/log-archive'

let dir: string
let archive: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'logarch-'))
  archive = join(dir, 'arena-logs')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const write = (name: string, body: string, ageDays = 0): string => {
  const p = join(dir, name)
  writeFileSync(p, body)
  if (ageDays) { const t = Date.now() / 1000 - ageDays * 86400; utimesSync(p, t, t) }
  return p
}
const draftLog = (extra = '') => `noise\n[UnityCrossThreadLogger]BotDraftDraftPick {"x":1}\n${extra}`

describe('archiveLogs', () => {
  it('keeps a log that mentions a draft', () => {
    const added = archiveLogs([write('Player.log', draftLog())], archive)
    expect(added).toHaveLength(1)
    expect(readdirSync(archive)).toHaveLength(1)
  })

  it('ignores a login-only log, which is what most Arena logs are', () => {
    // EventGetCoursesV2 fires on every login, draft or not. Treating it as a
    // draft marker meant "only logs that mention a draft" kept every log, and
    // the noise evicted the one file holding a draft's picks.
    const login = 'noise\n[UnityCrossThreadLogger]<== EventGetCoursesV2(abc)\n{"Courses":[]}\n'
    expect(archiveLogs([write('Player.log', login)], archive)).toEqual([])
  })

  it("keeps today's draft log and evicts the oldest", () => {
    // An earlier attempt ranked by how many draft markers a log held, so that
    // "the log with the draft in it" would win. That inverted the goal: a live
    // log is archived while still growing, so today's draft holds fewer markers
    // than an old archive covering several drafts, sorted last, and was deleted
    // immediately. Once enough old logs accumulated nothing new was ever kept.
    const many = draftLog('\n[UnityCrossThreadLogger]BotDraftDraftPick {}'.repeat(40))
    archiveLogs([write('old.log', many, 30)], archive, 2)
    archiveLogs([write('older.log', many + 'x', 60)], archive, 2)
    archiveLogs([write('today.log', draftLog('todays draft'), 0)], archive, 2)
    const kept = readdirSync(archive).map(f => readFileSync(join(archive, f), 'utf8'))
    expect(kept).toHaveLength(2)
    expect(kept.some(t => t.includes('todays draft'))).toBe(true)
  })

  it('keeps the fuller copy when one session is archived twice as it grows', () => {
    const stamp = 3
    archiveLogs([write('Player.log', draftLog('part one'), stamp)], archive, 1)
    archiveLogs([write('Player.log', draftLog('part one and two'), stamp)], archive, 1)
    const kept = readdirSync(archive).map(f => readFileSync(join(archive, f), 'utf8'))
    expect(kept).toHaveLength(1)
    expect(kept[0]).toContain('part one and two')
  })

  it('never throws on an unreadable path', () => {
    expect(() => archiveLogs([join(dir, 'nope.log')], archive)).not.toThrow()
    expect(archiveLogs([join(dir, 'nope.log')], archive)).toEqual([])
  })
})

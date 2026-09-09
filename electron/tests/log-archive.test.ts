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

  it('evicts noise before it evicts the log with the draft in it', () => {
    // A live log is archived while still growing, so several prefixes of one
    // session pile up. The one holding the whole draft must outlive them.
    const rich = draftLog('x'.repeat(50)) + '\n[UnityCrossThreadLogger]BotDraftDraftPick {}\n'.repeat(30)
    archiveLogs([write('draft.log', rich, 5)], archive, 2)
    for (let i = 0; i < 4; i++) archiveLogs([write(`p${i}.log`, draftLog(`prefix-${i}`), 0)], archive, 2)
    const kept = readdirSync(archive)
    expect(kept).toHaveLength(2)
    const survived = kept.some(f => readFileSync(join(archive, f), 'utf8').split('BotDraftDraftPick').length - 1 > 20)
    expect(survived).toBe(true)
  })

  it('does not keep the same bytes twice, however they are named', () => {
    // Arena renames the live log to Player-prev.log on launch, so the same
    // content arrives under a second name and would otherwise be duplicated.
    const body = draftLog()
    archiveLogs([write('Player.log', body)], archive)
    const again = archiveLogs([write('Player-prev.log', body)], archive)
    expect(again).toEqual([])
    expect(readdirSync(archive)).toHaveLength(1)
  })

  it('keeps distinct logs and prunes to the newest few', () => {
    for (let i = 0; i < 5; i++) archiveLogs([write(`log${i}.log`, draftLog(`run-${i}`), i)], archive, 3)
    expect(readdirSync(archive)).toHaveLength(3)
  })

  it('never throws on an unreadable path', () => {
    expect(() => archiveLogs([join(dir, 'nope.log')], archive)).not.toThrow()
    expect(archiveLogs([join(dir, 'nope.log')], archive)).toEqual([])
  })
})

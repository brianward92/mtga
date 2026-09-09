import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readdirSync, utimesSync } from 'fs'
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

  it('ignores a log with no draft in it', () => {
    // Arena's logs are large and mostly noise; only the ones worth keeping are.
    expect(archiveLogs([write('Player.log', 'just unity chatter\n')], archive)).toEqual([])
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

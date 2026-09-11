import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

function files(root: string): string[] {
  return readdirSync(root).flatMap(name => {
    const path = join(root, name)
    return statSync(path).isDirectory() ? files(path) : [path]
  })
}

describe('Arena driver boundary', () => {
  it('keeps only overlay development tools in scripts/dev', () => {
    expect(readdirSync(join(process.cwd(), 'scripts/dev')).sort()).toEqual([
      'app-source-hash.sh', 'verify-ids.ts', 'whatcard.ts',
    ])
  })

  it('contains no desktop-control calls in product source', () => {
    for (const root of ['main', 'shared', 'renderer']) {
      for (const path of files(join(process.cwd(), root))) {
        expect(readFileSync(path, 'utf8'), relative(process.cwd(), path)).not.toMatch(/\bmacctl\b|\bosascript\b/)
      }
    }
  })

  it('limits child processes to overlay infrastructure', () => {
    const allowed = new Set(['main/arena-geometry.ts', 'main/data/arena-card-db.ts'])
    for (const root of ['main', 'shared', 'renderer']) {
      for (const path of files(join(process.cwd(), root))) {
        const rel = relative(process.cwd(), path)
        if (/\bchild_process\b/.test(readFileSync(path, 'utf8'))) expect(allowed.has(rel), rel).toBe(true)
      }
    }
  })
})

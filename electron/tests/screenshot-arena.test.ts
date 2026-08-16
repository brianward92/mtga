import { afterEach, describe, expect, it } from 'vitest'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { spawnSync } from 'child_process'

const SCRIPT = join(__dirname, '..', 'scripts', 'dev', 'screenshot-arena.sh')
const temporaryRoots: string[] = []

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'screenshot-arena-test-'))
  temporaryRoots.push(root)
  return root
}

function executable(root: string, name: string, body: string): string {
  const path = join(root, name)
  writeFileSync(path, `#!/usr/bin/env bash\nset -eu\n${body}\n`)
  chmodSync(path, 0o755)
  return path
}

function fakeCapture(root: string, exitCode = 0): string {
  return executable(root, 'screencapture', `
printf '%s\\n' "$@" > "$FAKE_CAPTURE_ARGS"
last=''
for arg in "$@"; do last=$arg; done
${exitCode === 0 ? "printf 'fake png' > \"$last\"" : `exit ${exitCode}`}
`)
}

function run(
  root: string,
  helperBody: string,
  output = join(root, 'Arena capture.png'),
  extraEnv: NodeJS.ProcessEnv = {}
) {
  const stopped = join(root, 'helper-stopped')
  const args = join(root, 'capture-args')
  const helper = executable(root, 'arena-window-watch', `
child=''
trap '[ -z "$child" ] || kill "$child" 2>/dev/null; printf stopped > "$FAKE_HELPER_STOPPED"; exit 0' HUP INT TERM
${helperBody}
`)
  const capture = extraEnv.MTGA_SCREENCAPTURE ?? fakeCapture(root)
  const result = spawnSync('bash', [SCRIPT, output], {
    encoding: 'utf8',
    timeout: 5_000,
    env: {
      ...process.env,
      MTGA_SCREENSHOT_PLATFORM: 'Darwin',
      MTGA_ARENA_WINDOW_WATCH: helper,
      MTGA_SCREENCAPTURE: capture,
      MTGA_ARENA_WAIT_SECONDS: '1',
      FAKE_CAPTURE_ARGS: args,
      FAKE_HELPER_STOPPED: stopped,
      ...extraEnv
    }
  })
  return { result, output, stopped, args }
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('screenshot-arena.sh', () => {
  it('passes a negative global Arena rect as one screencapture region argument', () => {
    const root = temporaryRoot()
    const { result, output, stopped, args } = run(root, `
printf '%s\\n' 'ignored helper line' 'G -1440,-25,1280,720,0'
sleep 60 & child=$!
wait "$child"
`)

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
    expect(readFileSync(output, 'utf8')).toBe('fake png')
    const captureArgs = readFileSync(args, 'utf8').trim().split('\n')
    expect(captureArgs.slice(0, 3)).toEqual(['-x', '-tpng', '-R-1440,-25,1280,720'])
    expect(captureArgs).toHaveLength(4)
    expect(captureArgs[3]).toMatch(/\/capture\.png$/)
    expect(result.stderr).toContain('Arena is not frontmost')
    expect(result.stdout).toContain('Captured Arena region 1280x720 at -1440,-25')
    expect(result.stdout).toContain('Arena capture.png')
    expect(existsSync(stopped)).toBe(true)
  })

  it('fails without invoking screencapture when Arena has no on-screen window', () => {
    const root = temporaryRoot()
    const { result, output, stopped, args } = run(root, `
printf '%s\\n' 'G NOWIN'
sleep 60 & child=$!
wait "$child"
`)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Arena window not found')
    expect(existsSync(output)).toBe(false)
    expect(existsSync(args)).toBe(false)
    expect(existsSync(stopped)).toBe(true)
  })

  it('times out clearly on malformed helper output and terminates the helper', () => {
    const root = temporaryRoot()
    const { result, output, stopped, args } = run(root, `
printf '%s\\n' 'G nope' 'F 1,1,AA=='
sleep 60 & child=$!
wait "$child"
`)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('timed out after 1s waiting for Arena geometry')
    expect(existsSync(output)).toBe(false)
    expect(existsSync(args)).toBe(false)
    expect(existsSync(stopped)).toBe(true)
  })

  it('removes temporary output and terminates the helper when screencapture fails', () => {
    const root = temporaryRoot()
    const capture = fakeCapture(root, 7)
    const { result, output, stopped, args } = run(root, `
printf '%s\\n' 'G 10,20,800,600,1'
sleep 60 & child=$!
wait "$child"
`, join(root, 'failed.png'), { MTGA_SCREENCAPTURE: capture })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('screencapture failed for Arena region 10,20,800,600')
    expect(existsSync(output)).toBe(false)
    expect(readFileSync(args, 'utf8')).toContain('-R10,20,800,600')
    expect(existsSync(stopped)).toBe(true)
  })

  it('does not replace an output file that appears while capture is running', () => {
    const root = temporaryRoot()
    const output = join(root, 'raced.png')
    const capture = executable(root, 'screencapture-race', `
last=''
for arg in "$@"; do last=$arg; done
printf 'captured' > "$last"
printf 'keep me' > "$FAKE_FINAL_OUTPUT"
`)
    const { result, stopped } = run(root, `
printf '%s\\n' 'G 10,20,800,600,1'
sleep 60 & child=$!
wait "$child"
`, output, { MTGA_SCREENCAPTURE: capture, FAKE_FINAL_OUTPUT: output })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('output appeared while capturing; existing file was preserved')
    expect(readFileSync(output, 'utf8')).toBe('keep me')
    expect(existsSync(stopped)).toBe(true)
  })

  it('fails clearly when the configured helper is unavailable', () => {
    const root = temporaryRoot()
    const output = join(root, 'unused.png')
    const result = spawnSync('bash', [SCRIPT, output], {
      encoding: 'utf8',
      env: {
        ...process.env,
        MTGA_SCREENSHOT_PLATFORM: 'Darwin',
        MTGA_ARENA_WINDOW_WATCH: join(root, 'missing-helper'),
        MTGA_SCREENCAPTURE: fakeCapture(root)
      }
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('configured arena-window-watch is not executable')
    expect(existsSync(output)).toBe(false)
  })

  it('fails clearly when screencapture is unavailable', () => {
    const root = temporaryRoot()
    const output = join(root, 'unused.png')
    const helper = executable(root, 'arena-window-watch', 'exit 0')
    const result = spawnSync('bash', [SCRIPT, output], {
      encoding: 'utf8',
      env: {
        ...process.env,
        MTGA_SCREENSHOT_PLATFORM: 'Darwin',
        MTGA_ARENA_WINDOW_WATCH: helper,
        MTGA_SCREENCAPTURE: join(root, 'missing-screencapture')
      }
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('screencapture is unavailable')
    expect(existsSync(output)).toBe(false)
  })
})

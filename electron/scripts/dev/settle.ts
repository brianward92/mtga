/** Block until the engine advances, or the deadline passes. */
import { readFileSync } from 'fs'; import { homedir } from 'os'; import { join } from 'path'
import { replay } from '../../shared/gre'
const LOG = join(homedir(), 'Library/Logs/Wizards of the Coast/MTGA/Player.log')
const read = () => replay(readFileSync(LOG, 'utf8').split('\n'))
const before = read()
const deadline = Date.now() + Number(process.argv[2] ?? 4000)
;(async () => {
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 120))
    const s = read()
    if (s.gameStateId !== before.gameStateId || s.decision?.kind !== before.decision?.kind) return
  }
})()

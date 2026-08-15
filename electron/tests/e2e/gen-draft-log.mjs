#!/usr/bin/env node
/**
 * Synthesize a complete Arena Quick Draft (bot draft) Player.log in the REAL
 * 2026 two-line response shape, using card ids from a bundled set.
 *
 *   node tests/e2e/gen-draft-log.mjs [--set DSK] [--picks 42] [--seed 7] > draft.log
 *
 * Emits, per pick: "<== BotDraftDraftStatus(id)" / "<== BotDraftDraftPick(id)"
 * marker + JSON body lines (PickNext with 0-based PackNumber/PickNumber and a
 * DraftPack of string grpIds), the "==> BotDraftDraftPick" request carrying
 * the human's choice, and finally a Completed status. Deterministic per seed.
 */
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const args = process.argv.slice(2)
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def }
const SET = opt('--set', 'DSK')
const PICKS = Number(opt('--picks', '42'))
let seed = Number(opt('--seed', '7'))
const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }

const here = dirname(fileURLToPath(import.meta.url))
const cards = JSON.parse(readFileSync(join(here, '..', '..', 'resources', 'draftfm', 'sets', SET, 'cards.json'), 'utf8'))
  .filter(c => c.setCode === SET || cards_any(c))
function cards_any() { return false }
const byRarity = r => cards.filter(c => c.rarity === r && !/^Basic Land/.test(c.type))
const pools = { common: byRarity('common'), uncommon: byRarity('uncommon'), rare: byRarity('rare').concat(byRarity('mythic')) }
const lands = cards.filter(c => /^Basic Land/.test(c.type))
const pickN = (arr, n) => { const out = []; const used = new Set(); while (out.length < n && used.size < arr.length) { const i = Math.floor(rand() * arr.length); if (!used.has(i)) { used.add(i); out.push(arr[i]) } } return out }

const EVENT = `QuickDraft_${SET}_20260811`
const PPP = 14
const out = []
const line = s => out.push(s)
const now = () => '8/15/2026 9:32:28 AM'
let idc = 1
const guid = () => `7d1f0a3c-${String(idc++).padStart(4, '0')}-4c2a-9b3d-aaaaaaaaaaaa`

function pack14() {
  const cs = [...pickN(pools.rare, 1), ...pickN(pools.uncommon, 3), ...pickN(pools.common, 9), ...pickN(lands, 1)]
  return cs.map(c => String(c.grpId))
}

line(`[UnityCrossThreadLogger]==> EventJoin {"id":"${guid()}","request":"{\\"EventName\\":\\"${EVENT}\\",\\"EntryCurrencyType\\":\\"Gem\\",\\"EntryCurrencyPaid\\":750}"}`)
line(`[UnityCrossThreadLogger]${now()}`)
line(`<== EventJoin(${guid()})`)
line(`{"Course":{"CourseId":"c30300d0-15e9-4860-88c7-7d3d8f5305b6","InternalEventName":"${EVENT}","CurrentModule":"BotDraft","ModulePayload":""}}`)

const picked = []
let pack = pack14()
for (let n = 0; n < PICKS; n++) {
  const packNumber = Math.floor(n / PPP), pickNumber = n % PPP
  if (pickNumber === 0 && n > 0) pack = pack14()
  const payload = { Result: 'Success', EventName: EVENT, DraftStatus: 'PickNext', PackNumber: packNumber, PickNumber: pickNumber, NumCardsToPick: 1, DraftPack: pack, PackStyles: [], PickedCards: picked.map(String), PickedStyles: [] }
  const id = guid()
  line(`[UnityCrossThreadLogger]==> ${n === 0 ? 'BotDraftDraftStatus' : 'BotDraftDraftPick'} {"id":"${id}","request":"{\\"EventName\\":\\"${EVENT}\\"}"}`)
  line(`FrontDoorConnectionAWS:LogOutgoingMessage(IFDPromiseWriter)`)
  line(``)
  line(`[UnityCrossThreadLogger]${now()}`)
  line(`<== ${n === 0 ? 'BotDraftDraftStatus' : 'BotDraftDraftPick'}(${id})`)
  line(JSON.stringify({ CurrentModule: 'BotDraft', Payload: JSON.stringify(payload) }))
  line(`FrontDoorConnectionAWS:LogIncomingMessage(CmdType, Guid, IFDPromiseWriter)`)
  // The human picks: a marker line the harness can key on ("PICK <n>").
  const choice = pack[Math.floor(rand() * Math.min(pack.length, 4))]
  line(`[UnityCrossThreadLogger]==> BotDraftDraftPick {"id":"${guid()}","request":"{\\"EventName\\":\\"${EVENT}\\",\\"PickInfo\\":{\\"EventName\\":\\"${EVENT}\\",\\"CardIds\\":[\\"${choice}\\"],\\"PackNumber\\":${packNumber},\\"PickNumber\\":${pickNumber}}}"}`)
  picked.push(Number(choice))
  pack = pack.filter(g => g !== choice)
}
const doneId = guid()
line(`[UnityCrossThreadLogger]${now()}`)
line(`<== BotDraftDraftPick(${doneId})`)
line(JSON.stringify({ CurrentModule: 'BotDraft', Payload: JSON.stringify({ Result: 'Success', EventName: EVENT, DraftStatus: 'Completed', PackNumber: 2, PickNumber: PPP - 1, NumCardsToPick: 0, DraftPack: [], PackStyles: [], PickedCards: picked.map(String), PickedStyles: [] }) }))
process.stdout.write(out.join('\n') + '\n')

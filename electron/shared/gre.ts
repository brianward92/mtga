/**
 * Reading a match out of Arena's log.
 *
 * The screen is the wrong place to learn the game state, and every attempt to
 * play from it has failed. A creature's power is drawn as art, its counters as
 * pips, "summoning sick" as a subtle tint. OCR reads none of that reliably, and
 * a misread board produces a legal-looking move that loses the game.
 *
 * The log has all of it exactly. Better than that, it has the **legal moves**:
 * a declare-blockers request names, for each of your creatures, precisely which
 * attackers it may block. There is nothing to infer and nothing to get wrong.
 *
 * So the division of labour is: read here, click there. The screen is only ever
 * used to deliver a decision that was made from this data.
 *
 * Pure functions over already-read text. No file reading, no I/O, so the whole
 * thing is testable against a recorded log.
 */

// ---- the shapes we care about ----------------------------------------------

export type Seat = number

export interface GameObject {
  instanceId: number
  grpId?: number
  zoneId?: number
  controllerSeatId?: Seat
  ownerSeatId?: Seat
  cardTypes?: string[]
  subtypes?: string[]
  power?: number
  toughness?: number
  damage?: number
  hasSummoningSickness?: boolean
  isTapped?: boolean
  /** Whom this creature is blocking, once blocks are declared. */
  blocking?: number[]
  /** Whom this creature is attacking, once attacks are declared. */
  attacking?: number[]
}

export interface TurnInfo {
  phase?: string
  step?: string
  turnNumber?: number
  activePlayer?: Seat
  priorityPlayer?: Seat
  decisionPlayer?: Seat
}

export interface Zone { zoneId: number; type: string; ownerSeatId?: Seat }

/** One legal action the GRE says a seat may take right now. */
export interface LegalAction {
  seatId: Seat
  actionType: string
  instanceId?: number
  abilityGrpId?: number
  manaCost?: Array<{ color?: string[]; count?: number }>
}

/** What the GRE is waiting for. Null when it is not our turn to answer. */
export type Decision =
  | { kind: 'blockers'; blockers: Array<{ blockerInstanceId: number; legalAttackers: number[]; maxAttackers?: number; declared: number[] }> }
  | { kind: 'attackers'; attackers: Array<{ attackerInstanceId: number; legalTargets: number[]; declared: number[] }>; canSubmit?: boolean }
  | { kind: 'mulligan' }
  | { kind: 'targets'; sourceInstanceId?: number; options: number[] }
  | { kind: 'actions'; actions: LegalAction[] }
  | { kind: 'other'; type: string }

export interface GameState {
  /**
   * Our seat.
   *
   * Only a message addressed to exactly ONE seat identifies us. Some messages —
   * the die roll, prompts, timer state — are broadcast to both players as
   * [1, 2], and taking the first entry of one of those reads as the opponent.
   * Getting this wrong mirrors the entire board: our creatures become theirs.
   */
  seat?: Seat
  turn: TurnInfo
  life: Record<Seat, number>
  zones: Record<number, Zone>
  objects: Record<number, GameObject>
  /** Seconds left on the clock that is currently running, if any. */
  timerSeconds?: number
  decision: Decision | null
  gameStateId?: number
  /** Set once the GRE reports a result. */
  finished?: { winner?: Seat; reason?: string }
}

export function emptyGame(): GameState {
  return { turn: {}, life: {}, zones: {}, objects: {}, decision: null }
}

// ---- reading messages off a log line ---------------------------------------

export interface GreMessage {
  type: string
  systemSeatIds?: Seat[]
  gameStateMessage?: Record<string, unknown>
  [key: string]: unknown
}

/**
 * Pull the GRE messages out of one log line.
 *
 * Arena writes several unrelated JSON shapes into this file, and most lines are
 * not JSON at all. Anything that does not parse is not an error, it is the
 * other 99% of the log, so this returns nothing rather than throwing.
 */
export function extractGreMessages(line: string): GreMessage[] {
  const start = line.indexOf('{')
  if (start < 0 || !line.includes('greToClientMessages')) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(line.slice(start))
  } catch {
    return []
  }
  const event = (parsed as { greToClientEvent?: { greToClientMessages?: GreMessage[] } })?.greToClientEvent
  return event?.greToClientMessages ?? []
}

// ---- folding messages into a state -----------------------------------------

/**
 * Read a numeric field that Arena wraps as `{value: n}`.
 *
 * The subtlety that matters: Arena omits `value` entirely when the number is
 * **zero**, so a 0/5 wall arrives as `power: {}`. Reading that as "unknown"
 * makes a defensive creature indistinguishable from an unread threat, and the
 * whole point of reading the board is to know what is actually across from you.
 * An empty object is a present field, and a present field with no value is 0.
 *
 * A field that is absent altogether is a different thing: the diff simply did
 * not mention it, and the previous value stands. That case returns undefined so
 * the merge leaves it alone.
 */
function num(v: unknown): number | undefined {
  if (typeof v === 'number') return v
  if (v && typeof v === 'object') {
    const inner = (v as { value?: unknown }).value
    if (typeof inner === 'number') return inner
    return 0
  }
  return undefined
}

function readObject(raw: Record<string, any>): GameObject {
  return {
    instanceId: raw.instanceId,
    grpId: raw.grpId,
    zoneId: raw.zoneId,
    controllerSeatId: raw.controllerSeatId,
    ownerSeatId: raw.ownerSeatId,
    cardTypes: raw.cardTypes,
    subtypes: raw.subtypes,
    // Power and toughness arrive as {value: n} and are ABSENT rather than
    // unchanged when a diff does not touch them, which is why the merge below
    // must not overwrite a known value with undefined.
    power: num(raw.power),
    toughness: num(raw.toughness),
    damage: num(raw.damage),
    hasSummoningSickness: raw.hasSummoningSickness,
    isTapped: raw.isTapped,
    blocking: raw.blockInfo?.attackerIds,
    attacking: raw.attackInfo?.blockerIds ? undefined : raw.attackState ? raw.attackInfo?.attackerIds : undefined,
  }
}

/** Merge a diff's version of an object over what we already knew. */
function mergeObject(previous: GameObject | undefined, next: GameObject): GameObject {
  if (!previous) return next
  const merged = { ...previous } as unknown as Record<string, unknown>
  for (const [key, value] of Object.entries(next)) {
    if (value !== undefined) merged[key] = value
  }
  return merged as unknown as GameObject
}

/**
 * Fold one GRE message into the running state.
 *
 * Game state arrives as a Full snapshot once and then as Diffs, and a Diff
 * carries ONLY what changed. Replacing rather than merging loses every
 * creature's power and toughness the moment anything else about it updates,
 * which is the kind of bug that reads as "the board is wrong" much later.
 */
export function applyMessage(state: GameState, message: GreMessage): GameState {
  const next: GameState = {
    ...state,
    turn: { ...state.turn },
    life: { ...state.life },
    zones: { ...state.zones },
    objects: { ...state.objects },
  }

  if (message.systemSeatIds?.length === 1) next.seat = message.systemSeatIds[0]

  const gs = message.gameStateMessage as Record<string, any> | undefined
  if (gs) {
    if (gs.type === 'GameStateType_Full') {
      // A full snapshot is authoritative: anything not in it is gone.
      next.objects = {}
      next.zones = {}
    }
    next.gameStateId = gs.gameStateId ?? next.gameStateId
    if (gs.turnInfo) Object.assign(next.turn, gs.turnInfo)
    for (const player of gs.players ?? []) {
      if (typeof player.systemSeatNumber === 'number' && typeof player.lifeTotal === 'number') {
        next.life[player.systemSeatNumber] = player.lifeTotal
      }
    }
    for (const zone of gs.zones ?? []) next.zones[zone.zoneId] = zone
    for (const raw of gs.gameObjects ?? []) {
      const object = readObject(raw)
      next.objects[object.instanceId] = mergeObject(next.objects[object.instanceId], object)
    }
    for (const gone of gs.diffDeletedInstanceIds ?? []) delete next.objects[gone]

    // The clock that is actually counting down. Arena keeps six timers per
    // player and only the running one is the rope.
    const running = (gs.timers ?? []).find((t: any) => t.running && typeof t.durationSec === 'number')
    if (running) next.timerSeconds = running.durationSec - (running.elapsedSec ?? 0)

    if (gs.gameInfo?.results?.length) {
      const last = gs.gameInfo.results[gs.gameInfo.results.length - 1]
      next.finished = { winner: last.winningTeamId, reason: last.reason }
    }
  }

  const decision = decisionFrom(message)
  if (decision) next.decision = decision
  // A request is answered as soon as the next state arrives, so a plain state
  // message with no request means there is nothing outstanding.
  else if (gs && message.type === 'GREMessageType_GameStateMessage') next.decision = null

  return next
}

function decisionFrom(message: GreMessage): Decision | null {
  const m = message as Record<string, any>
  switch (message.type) {
    case 'GREMessageType_DeclareBlockersReq': {
      const blockers = (m.declareBlockersReq?.blockers ?? []).map((b: any) => ({
        blockerInstanceId: b.blockerInstanceId,
        // The GRE hands us legality directly. Never re-derive it: evasion,
        // menace, "can't be blocked by" and protection are all already applied.
        legalAttackers: b.attackerInstanceIds ?? [],
        maxAttackers: b.maxAttackers,
        declared: b.selectedAttackerInstanceIds ?? [],
      }))
      return { kind: 'blockers', blockers }
    }
    case 'GREMessageType_DeclareAttackersReq': {
      const attackers = (m.declareAttackersReq?.attackers ?? []).map((a: any) => ({
        attackerInstanceId: a.attackerInstanceId,
        legalTargets: a.legalAttackers ?? a.validAttackTargets ?? [],
        declared: a.selectedTargetId ? [a.selectedTargetId] : [],
      }))
      return { kind: 'attackers', attackers, canSubmit: m.declareAttackersReq?.canSubmitAttackers }
    }
    case 'GREMessageType_MulliganReq':
      return { kind: 'mulligan' }
    case 'GREMessageType_SelectTargetsReq': {
      const first = m.selectTargetsReq?.targets?.[0]
      return {
        kind: 'targets',
        sourceInstanceId: m.selectTargetsReq?.sourceId,
        options: first?.targetIdx ?? first?.legalTargets?.map((t: any) => t.targetInstanceId) ?? [],
      }
    }
    case 'GREMessageType_ActionsAvailableReq': {
      const actions: LegalAction[] = (m.actionsAvailableReq?.actions ?? []).map((a: any) => ({
        seatId: m.systemSeatIds?.[0],
        actionType: a.actionType,
        instanceId: a.instanceId,
        abilityGrpId: a.abilityGrpId,
        manaCost: a.manaCost,
      }))
      return { kind: 'actions', actions }
    }
    case 'GREMessageType_GameStateMessage':
    case 'GREMessageType_QueuedGameStateMessage':
    case 'GREMessageType_UIMessage':
    case 'GREMessageType_TimerStateMessage':
      return null
    default:
      return message.type?.endsWith('Req') ? { kind: 'other', type: message.type } : null
  }
}

/** Replay a whole log into a final state. */
export function replay(lines: Iterable<string>, from: GameState = emptyGame()): GameState {
  let state = from
  for (const line of lines) {
    for (const message of extractGreMessages(line)) state = applyMessage(state, message)
  }
  return state
}

// ---- questions the play loop actually asks ---------------------------------

export function battlefield(state: GameState, seat?: Seat): GameObject[] {
  const ids = new Set(
    Object.values(state.zones).filter(z => z.type === 'ZoneType_Battlefield').map(z => z.zoneId)
  )
  return Object.values(state.objects).filter(
    o => o.zoneId !== undefined && ids.has(o.zoneId) && (seat === undefined || o.controllerSeatId === seat)
  )
}

export function creatures(state: GameState, seat?: Seat): GameObject[] {
  return battlefield(state, seat).filter(o => o.cardTypes?.includes('CardType_Creature'))
}

/** Is the GRE waiting on us specifically? */
export function ourTurnToAct(state: GameState): boolean {
  return state.decision !== null && state.turn.decisionPlayer === state.seat
}

/** Untapped lands the opponent controls: the input to "what can they have". */
export function openMana(state: GameState, opponentSeat: Seat): number {
  return battlefield(state, opponentSeat).filter(
    o => o.cardTypes?.includes('CardType_Land') && !o.isTapped
  ).length
}

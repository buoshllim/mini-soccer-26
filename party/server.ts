import type * as Party from 'partykit/server'
import type { GameState, PlayerInput, ClientMsg, ServerMsg, LobbyState, Player, Vec2, PlayerRole } from '../src/types'
import { FIELD } from '../src/types'

const TICK_MS = 50  // 20 ticks/sec
const DT = TICK_MS / 1000

export default class SoccerServer implements Party.Server {
  private state: GameState
  private inputs: Map<string, PlayerInput> = new Map()
  private assignments: Map<string, 'home' | 'away'> = new Map()
  private tickInterval: ReturnType<typeof setInterval> | null = null
  private countdownTimer: ReturnType<typeof setInterval> | null = null
  private kickoffTimeout: ReturnType<typeof setTimeout> | null = null

  constructor(readonly room: Party.Room) {
    this.state = makeInitialState()
  }

  onConnect(conn: Party.Connection) {
    if (this.assignments.size >= 2) {
      conn.send(JSON.stringify({ type: 'error', msg: 'Room full' } satisfies ServerMsg))
      conn.close()
      return
    }
    const team = this.assignments.size === 0 ? 'home' : 'away'
    this.assignments.set(conn.id, team)
    conn.send(JSON.stringify({ type: 'assigned', team } satisfies ServerMsg))
    conn.send(JSON.stringify({ type: 'state', state: this.state } satisfies ServerMsg))

    if (this.assignments.size === 2 && this.state.phase === 'lobby') {
      this.initLobby()
    }
  }

  onClose(conn: Party.Connection) {
    this.assignments.delete(conn.id)
    this.inputs.delete(conn.id)

    if (this.assignments.size < 2 && this.state.lobby) {
      this.state.lobby = undefined
      this.state.phase = 'lobby'
    }

    if (this.assignments.size === 0) {
      // Room is empty — clean everything up
      if (this.tickInterval) { clearInterval(this.tickInterval); this.tickInterval = null }
      if (this.countdownTimer) { clearInterval(this.countdownTimer); this.countdownTimer = null }
      if (this.kickoffTimeout) { clearTimeout(this.kickoffTimeout); this.kickoffTimeout = null }
      this.state = makeInitialState()
    }

    this.broadcast({ type: 'state', state: this.state })
  }

  onMessage(message: string, sender: Party.Connection) {
    const msg: ClientMsg = JSON.parse(message) as ClientMsg
    if (msg.type === 'input') {
      this.inputs.set(sender.id, msg.input)
    } else if (msg.type === 'lobby') {
      this.handleLobbyMsg(msg, sender.id)
    }
  }

  private initLobby() {
    this.state.lobby = {
      home: { color: null, formation: null, jerseyNumber: randomJersey(), ready: false },
      away: { color: null, formation: null, jerseyNumber: randomJersey(), ready: false },
    }
    this.broadcast({ type: 'state', state: this.state })
  }

  private handleLobbyMsg(
    msg: ClientMsg & { type: 'lobby' },
    connId: string
  ) {
    const team = this.assignments.get(connId)
    if (!team || !this.state.lobby) return
    const slot = this.state.lobby[team]
    if (!slot) return
    if (msg.color !== undefined) slot.color = msg.color
    if (msg.jerseyNumber !== undefined) slot.jerseyNumber = msg.jerseyNumber
    if (msg.formation !== undefined) slot.formation = msg.formation
    if (msg.ready !== undefined) slot.ready = msg.ready
    this.broadcast({ type: 'state', state: this.state })
    this.checkBothReady()
  }

  private checkBothReady() {
    const lobby = this.state.lobby
    if (!lobby) return
    const { home, away } = lobby
    if (home?.ready && away?.ready && home.color && away.color && home.formation && away.formation) {
      this.startCountdown()
    }
  }

  private startCountdown() {
    if (this.state.phase === 'countdown') return
    this.state.phase = 'countdown'
    this.state.countdown = 3
    this.broadcast({ type: 'state', state: this.state })
    let n = 3
    if (this.countdownTimer) clearInterval(this.countdownTimer)
    this.countdownTimer = setInterval(() => {
      n--
      if (n <= 0) {
        clearInterval(this.countdownTimer!)
        this.countdownTimer = null
        this.startGame()
      } else {
        this.state.countdown = n
        this.broadcast({ type: 'state', state: this.state })
      }
    }, 1000)
  }

  private startGame() {
    const { home, away } = this.state.lobby!
    this.state.players = buildPlayers(home!, away!)
    this.state.ball = {
      pos: { x: FIELD.CENTER_X, y: FIELD.CENTER_Y, z: 0 },
      vel: { x: 0, y: 0, z: 0 },
      ownerId: null,
    }
    this.state.phase = 'kickoff'
    this.state.kickoffTeam = Math.random() < 0.5 ? 'home' : 'away'
    this.state.timeLeft = 5 * 60
    this.state.countdown = undefined
    this.broadcast({ type: 'state', state: this.state })
    this.tickInterval = setInterval(() => this.tick(), TICK_MS)
    // Auto-start playing after 2s kickoff display
    if (this.kickoffTimeout) clearTimeout(this.kickoffTimeout)
    this.kickoffTimeout = setTimeout(() => {
      if (this.state.phase === 'kickoff') this.state.phase = 'playing'
      this.kickoffTimeout = null
    }, 2000)
  }

  private tick() {
    // Game loop — physics and AI implemented in Tasks 5-8
    // For now just broadcast current state and tick timer
    if (this.state.phase === 'playing') {
      this.state.timeLeft = Math.max(0, this.state.timeLeft - DT)
      if (this.state.timeLeft <= 0) {
        this.endHalf()
        return
      }
    }
    this.broadcast({ type: 'state', state: this.state })
  }

  private endHalf() {
    if (this.state.half === 1) {
      this.state.phase = 'halftime'
      this.state.half = 2
      this.broadcast({ type: 'state', state: this.state })
      // After 5s halftime, restart
      setTimeout(() => {
        this.state.timeLeft = 5 * 60
        this.startCountdown()
      }, 5000)
    } else {
      this.state.phase = 'ended'
      if (this.tickInterval) {
        clearInterval(this.tickInterval)
        this.tickInterval = null
      }
      this.broadcast({ type: 'state', state: this.state })
    }
  }

  private broadcast(msg: ServerMsg) {
    this.room.broadcast(JSON.stringify(msg))
  }
}

function makeInitialState(): GameState {
  return {
    players: [],
    ball: {
      pos: { x: FIELD.CENTER_X, y: FIELD.CENTER_Y, z: 0 },
      vel: { x: 0, y: 0, z: 0 },
      ownerId: null,
    },
    score: { home: 0, away: 0 },
    timeLeft: 5 * 60,
    half: 1,
    phase: 'lobby',
    kickoffTeam: null,
    stats: {
      possession: { home: 0, away: 0 },
      shots: { home: 0, away: 0 },
      shotsOnTarget: { home: 0, away: 0 },
    },
  }
}

function randomJersey(): number {
  return Math.floor(Math.random() * 99) + 1
}

function gridSlotToRole(slotIdx: number): PlayerRole {
  const row = Math.floor(slotIdx / 3)
  if (row === 0) return 'fwd'
  if (row === 1) return 'mid'
  return 'def'
}

function gridSlotToStartPos(slotIdx: number, team: 'home' | 'away'): Vec2 {
  const col = slotIdx % 3
  const row = Math.floor(slotIdx / 3)

  const yPositions = [15, 30, 45] as const  // left, center, right
  const xPositionsHome = [72, 58, 35] as const  // FWD, MID, DEF
  const xPositionsAway = [28, 42, 65] as const

  const y = yPositions[col]
  const x = team === 'home' ? xPositionsHome[row] : xPositionsAway[row]
  return { x, y }
}

function randomUniqueJersey(used: Set<number>): number {
  let n: number
  do {
    n = Math.floor(Math.random() * 98) + 2  // 2-99 range for AI (human can pick 1-99)
  } while (used.has(n))
  return n
}

function buildPlayers(
  home: NonNullable<LobbyState['home']>,
  away: NonNullable<LobbyState['away']>
): Player[] {
  const players: Player[] = []
  const usedJerseys = { home: new Set<number>(), away: new Set<number>() }

  // Add GK for each team
  const addGK = (team: 'home' | 'away', jersey: number) => {
    const pos: Vec2 = team === 'home'
      ? { x: 4, y: FIELD.CENTER_Y }
      : { x: FIELD.W - 4, y: FIELD.CENTER_Y }

    players.push({
      id: `${team}-gk`,
      team,
      role: 'gk',
      pos,
      facing: { x: team === 'home' ? 1 : -1, y: 0 },
      stamina: 1,
      isControlled: false,
      hasBall: false,
      jerseyNumber: jersey,
      animState: 'idle',
    })
    usedJerseys[team].add(jersey)
  }

  // Add outfielder for each formation slot
  const addOutfielder = (
    team: 'home' | 'away',
    slotIdx: number,
    playerIdx: number,
    isHuman: boolean,
    humanJersey: number
  ) => {
    const role = gridSlotToRole(slotIdx)
    const pos = gridSlotToStartPos(slotIdx, team)
    const jersey = isHuman
      ? humanJersey
      : randomUniqueJersey(usedJerseys[team])
    usedJerseys[team].add(jersey)

    players.push({
      id: `${team}-${playerIdx}`,
      team,
      role,
      pos,
      facing: { x: team === 'home' ? 1 : -1, y: 0 },
      stamina: 1,
      isControlled: isHuman,
      hasBall: false,
      jerseyNumber: jersey,
      animState: 'idle',
    })
  }

  addGK('home', 1)
  addGK('away', 1)

  home.formation!.slots.forEach((slotIdx, i) => {
    addOutfielder('home', slotIdx, i, i === 0, home.jerseyNumber)
  })
  away.formation!.slots.forEach((slotIdx, i) => {
    addOutfielder('away', slotIdx, i, i === 0, away.jerseyNumber)
  })

  return players
}

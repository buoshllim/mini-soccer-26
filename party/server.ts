import type * as Party from 'partykit/server'
import type { GameState, PlayerInput, ClientMsg, ServerMsg, LobbyState } from '../src/types'
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

// Stub — implemented in Task 5
function buildPlayers(
  home: NonNullable<LobbyState['home']>,
  away: NonNullable<LobbyState['away']>
): import('../src/types').Player[] {
  void home
  void away
  return []
}

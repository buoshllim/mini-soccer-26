import type * as Party from 'partykit/server'
import type { GameState, PlayerInput, ClientMsg, ServerMsg, LobbyState, Player, Ball, Vec2, PlayerRole } from '../src/types'
import { FIELD } from '../src/types'

const TICK_MS = 50  // 20 ticks/sec
const DT = TICK_MS / 1000

const FRICTION = 0.92       // ball velocity multiplier per tick (ground friction)
const PLAYER_SPEED = 8      // units/sec base speed
const SPRINT_MULT = 1.6
const TIRED_MULT = 0.8      // speed when stamina < 0.01
const STAMINA_REGEN = 0.20 * DT   // per tick
const STAMINA_DRAIN = 0.30 * DT   // per tick while sprinting

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

  private tick(): void {
    const { state } = this

    if (state.phase !== 'playing' && state.phase !== 'kickoff') {
      return
    }

    // Move controlled players based on input
    for (const player of state.players) {
      if (player.role === 'gk' && !player.isControlled) continue  // GK AI handled in Task 8

      const team = player.team
      const connId = [...this.assignments.entries()].find(([, t]) => t === team)?.[0]
      const input: PlayerInput | null = (player.isControlled && connId)
        ? (this.inputs.get(connId) ?? null)
        : null

      tickPlayerMovement(player, input)
    }

    // Ball physics
    tickBallPhysics(state.ball)

    // Track last touching team for out-of-bounds logic (added in Task 14)
    if (state.ball.ownerId !== null) {
      const owner = state.players.find(p => p.id === state.ball.ownerId)
      if (owner) {
        (state.ball as any).__lastTeam = owner.team
      }
    }

    // Dribble attach: free ball (z < 1.5) near any player gets attached
    if (state.ball.ownerId === null && state.ball.pos.z < 1.5) {
      let closest: Player | null = null
      let closestDist: number = FIELD.DRIBBLE_ATTACH_DIST

      for (const p of state.players) {
        const d = dist2d(p.pos, { x: state.ball.pos.x, y: state.ball.pos.y })
        if (d < closestDist) {
          closestDist = d
          closest = p
        }
      }

      if (closest) {
        state.ball.ownerId = closest.id
        closest.hasBall = true
        state.ball.vel = { x: 0, y: 0, z: 0 }
      }
    }

    // Move ball with its owner
    if (state.ball.ownerId !== null) {
      const owner = state.players.find(p => p.id === state.ball.ownerId)
      if (owner) {
        // Ball is 1.2 units in front of player's facing direction
        state.ball.pos.x = owner.pos.x + owner.facing.x * 1.2
        state.ball.pos.y = owner.pos.y + owner.facing.y * 1.2
        state.ball.pos.z = 0
      } else {
        // Owner disappeared — release ball
        state.ball.ownerId = null
      }
    }

    // Possession stats: accumulate ticks
    if (state.ball.ownerId !== null) {
      const owner = state.players.find(p => p.id === state.ball.ownerId)
      if (owner) {
        state.stats.possession[owner.team]++
      }
    }

    // Timer countdown (only in 'playing' phase, not 'kickoff')
    if (state.phase === 'playing') {
      state.timeLeft = Math.max(0, state.timeLeft - DT)
      if (state.timeLeft <= 0) {
        this.endHalf()
        return
      }
    }

    this.broadcast({ type: 'state', state })
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

// ---- Physics helpers ----

function dist2d(a: Vec2, b: { x: number; y: number }): number {
  const dx = a.x - b.x, dy = a.y - b.y
  return Math.sqrt(dx * dx + dy * dy)
}

function norm2d(v: { x: number; y: number }): Vec2 {
  const d = Math.sqrt(v.x * v.x + v.y * v.y)
  if (d < 0.0001) return { x: 0, y: 0 }
  return { x: v.x / d, y: v.y / d }
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

function tickPlayerMovement(player: Player, input: PlayerInput | null): void {
  let speed = PLAYER_SPEED

  const sprinting = !!(input?.sprint) && player.stamina > 0
  if (sprinting) {
    speed *= SPRINT_MULT
    player.stamina = clamp(player.stamina - STAMINA_DRAIN, 0, 1)
  } else {
    if (player.stamina < 0.01) speed *= TIRED_MULT
    player.stamina = clamp(player.stamina + STAMINA_REGEN, 0, 1)
  }

  const moving = !!(input && (input.dx !== 0 || input.dy !== 0))
  if (moving) {
    const dir = norm2d({ x: input!.dx, y: input!.dy })
    player.pos.x += dir.x * speed * DT
    player.pos.y += dir.y * speed * DT
    player.facing = dir
    player.animState = 'run'
  } else {
    player.animState = 'idle'
  }

  // Keep in field bounds
  player.pos.x = clamp(player.pos.x, FIELD.PLAYER_RADIUS, FIELD.W - FIELD.PLAYER_RADIUS)
  player.pos.y = clamp(player.pos.y, FIELD.PLAYER_RADIUS, FIELD.H - FIELD.PLAYER_RADIUS)
}

function tickBallPhysics(ball: Ball): void {
  if (ball.ownerId !== null) return  // ball moves with player, handled separately

  // Apply velocity
  ball.pos.x += ball.vel.x * DT
  ball.pos.y += ball.vel.y * DT
  ball.pos.z += ball.vel.z * DT

  // Gravity on z axis
  if (ball.pos.z > 0) {
    ball.vel.z -= 20 * DT  // gravity
  } else {
    ball.pos.z = 0
    if (ball.vel.z < -0.5) {
      ball.vel.z = -ball.vel.z * 0.5  // bounce
    } else {
      ball.vel.z = 0
    }
  }

  // Ground friction (only when on the ground)
  if (ball.pos.z === 0) {
    ball.vel.x *= FRICTION
    ball.vel.y *= FRICTION
    // Stop tiny drift
    if (Math.abs(ball.vel.x) < 0.05) ball.vel.x = 0
    if (Math.abs(ball.vel.y) < 0.05) ball.vel.y = 0
  }

  // Wall bounces (field boundaries)
  const br = FIELD.BALL_RADIUS
  if (ball.pos.x < br) { ball.pos.x = br; ball.vel.x = Math.abs(ball.vel.x) * 0.7 }
  if (ball.pos.x > FIELD.W - br) { ball.pos.x = FIELD.W - br; ball.vel.x = -Math.abs(ball.vel.x) * 0.7 }
  if (ball.pos.y < br) { ball.pos.y = br; ball.vel.y = Math.abs(ball.vel.y) * 0.7 }
  if (ball.pos.y > FIELD.H - br) { ball.pos.y = FIELD.H - br; ball.vel.y = -Math.abs(ball.vel.y) * 0.7 }
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

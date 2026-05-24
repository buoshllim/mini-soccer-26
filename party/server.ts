import type * as Party from 'partykit/server'
import type { GameState, PlayerInput, ClientMsg, ServerMsg, LobbyState, Player, Ball, Vec2, PlayerRole, SetpieceState } from '../src/types'
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

      // Process action input
      if (player.isControlled && input?.action) {
        if (player.hasBall) {
          handleBallAction(state, player, input)
        } else {
          handleNoBallAction(state, player, input)
        }
      }

      // Tab: switch controlled player
      if (player.isControlled && input?.switchPlayer) {
        const teammates = state.players
          .filter(p => p.team === player.team && p.role !== 'gk' && !p.isControlled)
          .sort((a, b) => dist2d(a.pos, state.ball.pos) - dist2d(b.pos, state.ball.pos))

        if (teammates.length > 0) {
          player.isControlled = false
          teammates[0].isControlled = true
        }
      }
    }

    // Ball physics
    tickBallPhysics(state.ball)

    // Goal detection
    if (checkGoal(state)) {
      const kickoffTeam = state.score.home > state.score.away ? 'away' : 'home'
      state.kickoffTeam = kickoffTeam
      state.phase = 'kickoff'
      state.ball = { pos: { x: FIELD.CENTER_X, y: FIELD.CENTER_Y, z: 0 }, vel: { x: 0, y: 0, z: 0 }, ownerId: null }
      for (const p of state.players) {
        p.hasBall = false
        // Reset controlled: 1st outfielder of each team
        const isFirst = state.players.filter(pp => pp.team === p.team && pp.role !== 'gk').indexOf(p) === 0
        p.isControlled = isFirst
      }
      if (this.kickoffTimeout) clearTimeout(this.kickoffTimeout)
      this.kickoffTimeout = setTimeout(() => {
        if (this.state.phase === 'kickoff') this.state.phase = 'playing'
        this.kickoffTimeout = null
      }, 2000)
      this.broadcast({ type: 'state', state })
      return  // skip rest of tick
    }

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

// ---- Action helpers ----

function isInPenaltyArea(pos: Vec2, team: 'home' | 'away'): boolean {
  // Is pos inside team's OWN penalty area?
  const paLeft = team === 'home' ? 0 : FIELD.W - FIELD.PA_DEPTH
  const paRight = team === 'home' ? FIELD.PA_DEPTH : FIELD.W
  const paTop = FIELD.CENTER_Y - FIELD.PA_HALF_WIDTH
  const paBottom = FIELD.CENTER_Y + FIELD.PA_HALF_WIDTH
  return pos.x >= paLeft && pos.x <= paRight && pos.y >= paTop && pos.y <= paBottom
}

function triggerSetpiece(state: GameState, type: SetpieceState['type'], team: 'home' | 'away', pos: Vec2): void {
  state.phase = type
  state.setpiece = { type, team, pos: { x: pos.x, y: pos.y } }
  state.ball.pos = { x: pos.x, y: pos.y, z: 0 }
  state.ball.vel = { x: 0, y: 0, z: 0 }
  state.ball.ownerId = null

  // Release ball from any player
  for (const p of state.players) p.hasBall = false

  // Auto-place controlled player 1.5 units behind ball (FC style)
  const controlled = state.players.find(p => p.team === team && p.isControlled)
  if (controlled) {
    const dir = team === 'home' ? -1 : 1  // behind = toward own goal
    controlled.pos = {
      x: clamp(pos.x + dir * 1.5, FIELD.PLAYER_RADIUS, FIELD.W - FIELD.PLAYER_RADIUS),
      y: clamp(pos.y, FIELD.PLAYER_RADIUS, FIELD.H - FIELD.PLAYER_RADIUS),
    }
  }
}

function handleBallAction(state: GameState, player: Player, input: PlayerInput): void {
  const { ball } = state
  // Kick direction: arrow keys if pressed, else player facing
  const hasDir = input.dx !== 0 || input.dy !== 0
  const dir = hasDir ? norm2d({ x: input.dx, y: input.dy }) : player.facing

  const power = clamp(input.power, 0, 1)
  const kickSpeed = (base: number) => base * (0.4 + power * 0.6)

  const releaseBall = () => {
    player.hasBall = false
    ball.ownerId = null
    player.animState = 'kick'
  }

  switch (input.action) {
    case 'shoot': {
      const spd = kickSpeed(28)
      ball.vel = { x: dir.x * spd, y: dir.y * spd, z: 3 }
      releaseBall()
      state.stats.shots[player.team]++
      break
    }
    case 'chipshot': {
      // Fixed power, lofted arc over GK
      ball.vel = { x: dir.x * 14, y: dir.y * 14, z: 14 }
      releaseBall()
      state.stats.shots[player.team]++
      break
    }
    case 'lowpass': {
      const spd = kickSpeed(18)
      ball.vel = { x: dir.x * spd, y: dir.y * spd, z: 0 }
      releaseBall()
      // Switch control to nearest teammate toward ball destination (on kick)
      switchControlToNearest(state, player.team, dir)
      break
    }
    case 'loftedpass': {
      const spd = kickSpeed(16)
      ball.vel = { x: dir.x * spd, y: dir.y * spd, z: kickSpeed(8) }
      releaseBall()
      switchControlToNearest(state, player.team, dir)
      break
    }
    case 'throughpass': {
      const spd = kickSpeed(20)
      ball.vel = { x: dir.x * spd, y: dir.y * spd, z: 2 }
      releaseBall()
      switchControlToNearest(state, player.team, dir)
      break
    }
  }
}

function handleNoBallAction(state: GameState, player: Player, input: PlayerInput): void {
  const { ball } = state

  switch (input.action) {
    case 'tackle': {
      const ballOwner = state.players.find(p => p.id === ball.ownerId)
      if (!ballOwner || ballOwner.team === player.team) break
      if (dist2d(player.pos, ballOwner.pos) < FIELD.TACKLE_DIST) {
        const isShielding = (ballOwner as any).__shielding === true
        const success = Math.random() > (isShielding ? 0.5 : 0)
        if (success) {
          ballOwner.hasBall = false
          ball.ownerId = null
          ball.vel = { x: player.facing.x * 5, y: player.facing.y * 5, z: 0 }
        }
      }
      break
    }
    case 'slidetackle': {
      const ballOwner = state.players.find(p => p.id === ball.ownerId)
      if (!ballOwner || ballOwner.team === player.team) break
      const range = FIELD.TACKLE_DIST + 1
      if (dist2d(player.pos, ballOwner.pos) < range) {
        // Foul if tackling from behind (angle > 120° from attacker's facing)
        const toTackler = norm2d({ x: player.pos.x - ballOwner.pos.x, y: player.pos.y - ballOwner.pos.y })
        const dot = toTackler.x * ballOwner.facing.x + toTackler.y * ballOwner.facing.y
        const fromBehind = dot > 0.5
        if (fromBehind) {
          triggerFoul(state, player, ballOwner)
        } else {
          ballOwner.hasBall = false
          ball.ownerId = null
          ball.vel = { x: player.facing.x * 8, y: player.facing.y * 8, z: 0 }
        }
      }
      player.animState = 'slide'
      break
    }
    case 'gkrush': {
      // Signal GK to rush (GK AI handles movement)
      const gk = state.players.find(p => p.team === player.team && p.role === 'gk' && !p.isControlled)
      if (gk) {
        (gk as any).__rushing = true
      }
      break
    }
  }
}

function triggerFoul(state: GameState, fouler: Player, victim: Player): void {
  const foulPos = { ...victim.pos }
  const victimTeam = victim.team
  const inPA = isInPenaltyArea(foulPos, fouler.team)  // foul in fouler's own PA?
  const setpieceType = inPA ? 'penalty' : 'freekick'
  triggerSetpiece(state, setpieceType, victimTeam, foulPos)
}

function switchControlToNearest(state: GameState, team: 'home' | 'away', dir: Vec2): void {
  // Estimate ball destination
  const dest = {
    x: state.ball.pos.x + dir.x * 12,
    y: state.ball.pos.y + dir.y * 12,
  }

  let nearest: Player | null = null
  let nearestDist = Infinity

  for (const p of state.players) {
    if (p.team !== team || p.role === 'gk' || p.hasBall) continue
    const d = dist2d(p.pos, dest)
    if (d < nearestDist) {
      nearestDist = d
      nearest = p
    }
  }

  if (nearest) {
    for (const p of state.players) {
      if (p.team === team) p.isControlled = false
    }
    nearest.isControlled = true
  }
}

function checkOffside(state: GameState, passer: Player): void {
  const attackDir = passer.team === 'home' ? 1 : -1

  // Find last defender's x position (excluding GK)
  const defenders = state.players.filter(p => p.team !== passer.team && p.role !== 'gk')
  if (defenders.length === 0) return

  const lastDefX = defenders
    .map(p => p.pos.x)
    .sort((a, b) => attackDir === 1 ? b - a : a - b)[0]

  // Check if any attacker is in offside position
  const attackers = state.players.filter(p =>
    p.team === passer.team && !p.hasBall && p.role !== 'gk'
  )

  const offside = attackers.some(a =>
    attackDir === 1
      ? a.pos.x > lastDefX && a.pos.x > passer.pos.x
      : a.pos.x < lastDefX && a.pos.x < passer.pos.x
  )

  if (offside) {
    // Indirect freekick for the defending team
    triggerSetpiece(state, 'freekick', passer.team === 'home' ? 'away' : 'home', {
      x: passer.pos.x,
      y: state.ball.pos.y,
    })
  }
}

function checkGoal(state: GameState): boolean {
  const { ball } = state
  if (ball.ownerId !== null) return false

  const goalTop = FIELD.CENTER_Y - FIELD.GOAL_WIDTH / 2
  const goalBot = FIELD.CENTER_Y + FIELD.GOAL_WIDTH / 2

  if (ball.pos.x <= 0 && ball.pos.y >= goalTop && ball.pos.y <= goalBot) {
    // Away team scored (into home goal)
    state.score.away++
    state.stats.shotsOnTarget.away++
    return true
  }
  if (ball.pos.x >= FIELD.W && ball.pos.y >= goalTop && ball.pos.y <= goalBot) {
    // Home team scored (into away goal)
    state.score.home++
    state.stats.shotsOnTarget.home++
    return true
  }
  return false
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

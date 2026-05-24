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
  private lastTickAt = 0

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

    if (this.assignments.size === 2 && this.state.phase === 'lobby') {
      this.initLobby()
    }

    conn.send(JSON.stringify({ type: 'state', state: this.state } satisfies ServerMsg))
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
      this.ensureTicking()
    } else if (msg.type === 'lobby') {
      this.handleLobbyMsg(msg, sender.id)
    }
  }

  private ensureTicking(): void {
    const gamePhases = new Set(['kickoff', 'playing', 'freekick', 'penalty', 'corner', 'throwin', 'goalkick'])
    if (!gamePhases.has(this.state.phase)) return
    // If tick hasn't run in 5× interval, restart it (handles DO hibernation)
    const now = Date.now()
    if (now - this.lastTickAt > TICK_MS * 5) {
      if (this.tickInterval !== null) { clearInterval(this.tickInterval); this.tickInterval = null }
      this.tickInterval = setInterval(() => this.tick(), TICK_MS)
    }
  }

  private initLobby() {
    const makeJerseys = (): [number, number, number, number, number] =>
      [randomJersey(), randomJersey(), randomJersey(), randomJersey(), randomJersey()]
    this.state.lobby = {
      home: { color: null, formation: null, jerseyNumbers: makeJerseys(), ready: false },
      away: { color: null, formation: null, jerseyNumbers: makeJerseys(), ready: false },
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
    if (msg.jerseyNumbers !== undefined) slot.jerseyNumbers = msg.jerseyNumbers
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
    this.state.kickoffTeam = this.state.kickoffTeam ?? (Math.random() < 0.5 ? 'home' : 'away')
    this.state.timeLeft = 5 * 60
    this.state.countdown = undefined
    this.state.phase = 'kickoff'

    // Give ball to kickoff team's controlled player at center
    const kickoffPlayer = this.state.players.find(
      p => p.team === this.state.kickoffTeam && p.isControlled
    )
    this.state.ball = {
      pos: { x: FIELD.CENTER_X, y: FIELD.CENTER_Y, z: 0 },
      vel: { x: 0, y: 0, z: 0 },
      ownerId: kickoffPlayer?.id ?? null,
    }
    if (kickoffPlayer) {
      kickoffPlayer.hasBall = true
      kickoffPlayer.pos = { x: FIELD.CENTER_X, y: FIELD.CENTER_Y }
    }

    this.broadcast({ type: 'state', state: this.state })
    if (this.tickInterval) { clearInterval(this.tickInterval); this.tickInterval = null }
    this.lastTickAt = Date.now()
    this.tickInterval = setInterval(() => this.tick(), TICK_MS)
  }

  private tick(): void {
    this.lastTickAt = Date.now()
    const { state } = this

    // Kickoff: only kickoff team's player can move; any action starts the game
    if (state.phase === 'kickoff') {
      const kickoffTeam = state.kickoffTeam
      if (kickoffTeam) {
        const connId = [...this.assignments.entries()].find(([, t]) => t === kickoffTeam)?.[0]
        const input = connId ? (this.inputs.get(connId) ?? null) : null
        const player = state.players.find(p => p.team === kickoffTeam && p.isControlled)

        if (player && input) {
          tickPlayerMovement(player, input)
          // Keep ball attached to kickoff player
          if (player.hasBall) {
            state.ball.pos.x = player.pos.x + player.facing.x * 1.2
            state.ball.pos.y = player.pos.y + player.facing.y * 1.2
            state.ball.ownerId = player.id
          }
          // Any action starts the game
          if (input.action && player.hasBall) {
            const translated = translateActionForBall(input)
            handleBallAction(state, player, translated)
            state.phase = 'playing'
          }
        }
      }
      this.broadcast({ type: 'state', state })
      return
    }

    // Setpiece: allow the setpiece team's controlled player to resume play
    if (['freekick', 'penalty', 'corner', 'throwin', 'goalkick'].includes(state.phase)) {
      const setTeam = state.setpiece?.team
      if (setTeam) {
        for (const player of state.players) {
          if (!player.isControlled || player.team !== setTeam) continue
          const connId = [...this.assignments.entries()].find(([, t]) => t === setTeam)?.[0]
          const input = connId ? (this.inputs.get(connId) ?? null) : null
          if (input?.action) {
            // Attach ball to player for setpiece kick
            player.hasBall = true
            state.ball.ownerId = player.id
            state.ball.pos.x = player.pos.x + player.facing.x * 1.2
            state.ball.pos.y = player.pos.y + player.facing.y * 1.2
            const translated = translateActionForBall(input)
            handleBallAction(state, player, translated)
            state.phase = 'playing'
          } else if (input && (input.dx !== 0 || input.dy !== 0)) {
            tickPlayerMovement(player, input)
          }
        }
      }
      this.broadcast({ type: 'state', state })
      return
    }

    if (state.phase !== 'playing') {
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

      // Ball shielding: dribbling player moving away from opponent
      if (player.hasBall && input && (input.dx !== 0 || input.dy !== 0)) {
        const nearby = state.players.filter(p => p.team !== player.team && dist2d(p.pos, player.pos) < 2)
        if (nearby.length > 0) {
          const opp = nearby[0]
          const toOpp = norm2d({ x: opp.pos.x - player.pos.x, y: opp.pos.y - player.pos.y })
          const inputDir = norm2d({ x: input.dx, y: input.dy })
          const dot = toOpp.x * inputDir.x + toOpp.y * inputDir.y
          if (dot < -0.5) {
            ;(player as any).__shielding = true
            // Reduce movement speed while shielding
            player.pos.x -= inputDir.x * PLAYER_SPEED * 0.4 * DT
            player.pos.y -= inputDir.y * PLAYER_SPEED * 0.4 * DT
          } else {
            ;(player as any).__shielding = false
          }
        } else {
          ;(player as any).__shielding = false
        }
      } else if (!player.hasBall) {
        ;(player as any).__shielding = false
      }

      // Process action input
      if (player.isControlled && input?.action) {
        if (player.hasBall) {
          // Client sends tackle/slidetackle/gkrush for C/X/Z; server upgrades to pass actions
          const translatedInput = translateActionForBall(input)
          handleBallAction(state, player, translatedInput)
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

    // AI movement
    this.tickAI(state)

    // Ball physics
    tickBallPhysics(state.ball)

    // Goal detection
    if (checkGoal(state)) {
      const kickoffTeam: 'home' | 'away' = state.score.home > state.score.away ? 'away' : 'home'
      state.kickoffTeam = kickoffTeam
      state.phase = 'kickoff'
      // Reset controlled: 1st outfielder of each team
      for (const p of state.players) {
        p.hasBall = false
        const isFirst = state.players.filter(pp => pp.team === p.team && pp.role !== 'gk').indexOf(p) === 0
        p.isControlled = isFirst
      }
      // Attach ball to kickoff team's controlled player at center
      const kickoffPlayer = state.players.find(p => p.team === kickoffTeam && p.isControlled)
      state.ball = {
        pos: { x: FIELD.CENTER_X, y: FIELD.CENTER_Y, z: 0 },
        vel: { x: 0, y: 0, z: 0 },
        ownerId: kickoffPlayer?.id ?? null,
      }
      if (kickoffPlayer) {
        kickoffPlayer.hasBall = true
        kickoffPlayer.pos = { x: FIELD.CENTER_X, y: FIELD.CENTER_Y }
      }
      this.broadcast({ type: 'state', state })
      return
    }

    // Header: airborne ball descending within reach of a player
    if (state.ball.pos.z > 2 && state.ball.vel.z < 0 && state.ball.ownerId === null) {
      for (const player of state.players) {
        if (dist2d(player.pos, { x: state.ball.pos.x, y: state.ball.pos.y }) < 2) {
          const connId = [...this.assignments.entries()].find(([, t]) => t === player.team)?.[0]
          const input = player.isControlled && connId ? (this.inputs.get(connId) ?? null) : null
          const hasDir = input && (input.dx !== 0 || input.dy !== 0)
          const dir = hasDir ? norm2d({ x: input!.dx, y: input!.dy }) : player.facing

          if (player.role === 'gk' && isInPenaltyArea(player.pos, player.team)) {
            // GK catches aerial ball in PA
            state.ball.ownerId = player.id
            player.hasBall = true
            state.ball.vel = { x: 0, y: 0, z: 0 }
            for (const p of state.players) {
              if (p.team === player.team) p.isControlled = false
            }
            player.isControlled = true
          } else {
            // Outfield header
            state.ball.vel = { x: dir.x * 14, y: dir.y * 14, z: 6 }
            state.ball.ownerId = null
            player.animState = 'kick'
          }
          break
        }
      }
    }

    // Out of bounds detection (only when ball is free and game is playing)
    if (state.phase === 'playing' && state.ball.ownerId === null) {
      checkOutOfBounds(state)
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

  private tickAI(state: GameState): void {
    for (const player of state.players) {
      if (player.isControlled) continue  // Human controls this player

      if (player.role === 'gk') {
        tickGKAI(state, player)
      } else {
        tickFieldAI(state, player)
      }
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

function translateActionForBall(input: PlayerInput): PlayerInput {
  const map: Partial<Record<NonNullable<PlayerInput['action']>, PlayerInput['action']>> = {
    tackle: 'lowpass', slidetackle: 'loftedpass', gkrush: 'throughpass',
  }
  const translated = input.action ? (map[input.action] ?? input.action) : null
  return { ...input, action: translated }
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
      checkOffside(state, player)
      if (state.phase !== 'playing') break  // offside was triggered
      const spd = kickSpeed(18)
      ball.vel = { x: dir.x * spd, y: dir.y * spd, z: 0 }
      releaseBall()
      // Switch control to nearest teammate toward ball destination (on kick)
      switchControlToNearest(state, player.team, dir)
      break
    }
    case 'loftedpass': {
      checkOffside(state, player)
      if (state.phase !== 'playing') break
      const spd = kickSpeed(16)
      ball.vel = { x: dir.x * spd, y: dir.y * spd, z: kickSpeed(8) }
      releaseBall()
      switchControlToNearest(state, player.team, dir)
      break
    }
    case 'throughpass': {
      checkOffside(state, player)
      if (state.phase !== 'playing') break
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

function checkOutOfBounds(state: GameState): void {
  const { ball } = state
  const lastTeam: 'home' | 'away' = (ball as any).__lastTeam ?? 'home'

  // Side out (top/bottom) → throwin for opposite team
  if (ball.pos.y < 0 || ball.pos.y > FIELD.H) {
    const oppositeTeam: 'home' | 'away' = lastTeam === 'home' ? 'away' : 'home'
    ball.pos.y = clamp(ball.pos.y, 0, FIELD.H)
    ball.vel = { x: 0, y: 0, z: 0 }
    ball.ownerId = null
    triggerSetpiece(state, 'throwin', oppositeTeam, { x: ball.pos.x, y: ball.pos.y })
    return
  }

  // Goal line out (left/right, not a goal) → corner or goalkick
  if (ball.pos.x < 0 || ball.pos.x > FIELD.W) {
    const isLeft = ball.pos.x < 0
    const attackingTeam: 'home' | 'away' = isLeft ? 'away' : 'home'
    const defendingTeam: 'home' | 'away' = isLeft ? 'home' : 'away'

    ball.pos.x = clamp(ball.pos.x, 0, FIELD.W)
    ball.vel = { x: 0, y: 0, z: 0 }
    ball.ownerId = null

    if (lastTeam === attackingTeam) {
      // Attacker kicked it out → goalkick for defending team
      triggerSetpiece(state, 'goalkick', defendingTeam, {
        x: isLeft ? 6 : FIELD.W - 6,
        y: FIELD.CENTER_Y,
      })
    } else {
      // Defender kicked it out → corner for attacking team
      const cornerY = ball.pos.y < FIELD.CENTER_Y ? 0 : FIELD.H
      triggerSetpiece(state, 'corner', attackingTeam, {
        x: isLeft ? 0 : FIELD.W,
        y: cornerY,
      })
    }
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

function tickGKAI(state: GameState, gk: Player): void {
  const { ball } = state
  const goalX = gk.team === 'home' ? 4 : FIELD.W - 4
  const isRushing: boolean = (gk as any).__rushing === true

  if (isRushing) {
    const d = dist2d(gk.pos, { x: ball.pos.x, y: ball.pos.y })
    if (d < 2.0) {
      // GK reached ball area
      if (isInPenaltyArea(ball.pos, gk.team)) {
        if (ball.ownerId === null) {
          // Catch ball
          ball.ownerId = gk.id
          gk.hasBall = true
          ball.vel = { x: 0, y: 0, z: 0 }
          // Transfer control: clear all teammates first, then give to GK
          for (const p of state.players) {
            if (p.team === gk.team) p.isControlled = false
          }
          gk.isControlled = true
        } else {
          // Tackle attacker
          const attacker = state.players.find(p => p.id === ball.ownerId)
          if (attacker && attacker.team !== gk.team) {
            const success = Math.random() > 0.35
            if (success) {
              attacker.hasBall = false
              ball.ownerId = null
              const clearDir = gk.team === 'home' ? 1 : -1
              ball.vel = {
                x: clearDir * 15 + (Math.random() - 0.5) * 4,
                y: (Math.random() - 0.5) * 8,
                z: 4,
              }
            }
          }
        }
      } else {
        // Outside PA: clear the ball
        if (ball.ownerId === null || ball.ownerId === gk.id) {
          if (gk.hasBall) gk.hasBall = false
          ball.ownerId = null
          const clearDir = gk.team === 'home' ? 1 : -1
          ball.vel = { x: clearDir * 18, y: (Math.random() - 0.5) * 6, z: 5 }
        }
      }
      ;(gk as any).__rushing = false
    } else {
      // Move toward ball
      const dir = norm2d({ x: ball.pos.x - gk.pos.x, y: ball.pos.y - gk.pos.y })
      gk.pos.x += dir.x * PLAYER_SPEED * 1.3 * DT
      gk.pos.y += dir.y * PLAYER_SPEED * 1.3 * DT
      gk.facing = dir
      gk.animState = 'run'
      return
    }
  }

  // Auto-rush: if free ball is close enough
  const d = dist2d(gk.pos, { x: ball.pos.x, y: ball.pos.y })
  if (d < FIELD.GK_RUSH_DIST && ball.ownerId === null && ball.pos.z < 2) {
    ;(gk as any).__rushing = true
    return
  }

  // Track ball laterally along goal line
  const targetY = clamp(
    ball.pos.y,
    FIELD.CENTER_Y - FIELD.GOAL_WIDTH / 2 - 1,
    FIELD.CENTER_Y + FIELD.GOAL_WIDTH / 2 + 1
  )
  const dy = targetY - gk.pos.y
  if (Math.abs(dy) > 0.1) {
    gk.pos.y += Math.sign(dy) * PLAYER_SPEED * 0.85 * DT
    gk.animState = 'run'
  } else {
    gk.animState = 'idle'
  }
  // Always stay on goal line
  gk.pos.x = goalX
  gk.pos.y = clamp(gk.pos.y, FIELD.PLAYER_RADIUS, FIELD.H - FIELD.PLAYER_RADIUS)
}

function tickFieldAI(state: GameState, player: Player): void {
  const { ball } = state
  const isHomeSide = ball.pos.x > FIELD.CENTER_X
  const teamAttacking = player.team === 'home' ? isHomeSide : !isHomeSide

  let targetX: number
  let targetY: number

  // Stagger AI players to avoid piling up: offset by player index
  const teammates = state.players.filter(p => p.team === player.team && p.role === player.role)
  const idx = teammates.indexOf(player)
  const yOffset = (idx - (teammates.length - 1) / 2) * 8  // spread vertically

  switch (player.role) {
    case 'fwd':
      if (teamAttacking) {
        // Chase ball if close enough, else position near opponent goal
        const dBall = dist2d(player.pos, { x: ball.pos.x, y: ball.pos.y })
        if (dBall < 15) {
          targetX = ball.pos.x
          targetY = ball.pos.y
        } else {
          targetX = player.team === 'home' ? 75 : 25
          targetY = FIELD.CENTER_Y + yOffset
        }
      } else {
        // Stay high (opponent half)
        targetX = player.team === 'home' ? 68 : 32
        targetY = FIELD.CENTER_Y + yOffset
      }
      break

    case 'mid':
      if (teamAttacking) {
        targetX = clamp(ball.pos.x, player.team === 'home' ? 40 : 0, player.team === 'home' ? 80 : 60)
        targetY = clamp(ball.pos.y, 10, 50) + yOffset * 0.5
      } else {
        targetX = player.team === 'home' ? 45 : 55
        targetY = clamp(ball.pos.y, 10, 50) + yOffset * 0.5
      }
      break

    case 'def':
      if (teamAttacking) {
        // Stay back
        targetX = player.team === 'home' ? 28 : 72
        targetY = FIELD.CENTER_Y + yOffset
      } else {
        // Get between ball and own goal
        const goalX = player.team === 'home' ? 4 : FIELD.W - 4
        targetX = clamp(ball.pos.x, goalX + 8, FIELD.CENTER_X + (player.team === 'home' ? -5 : 5))
        targetY = clamp(ball.pos.y, 8, 52) + yOffset * 0.5
      }
      break

    default:
      return
  }

  // Move toward target
  const target = { x: targetX, y: targetY }
  const d = dist2d(player.pos, target)
  if (d > 0.5) {
    const dir = norm2d({ x: target.x - player.pos.x, y: target.y - player.pos.y })
    player.pos.x += dir.x * PLAYER_SPEED * 0.85 * DT
    player.pos.y += dir.y * PLAYER_SPEED * 0.85 * DT
    player.facing = dir
    player.animState = 'run'
  } else {
    player.animState = 'idle'
  }

  // Keep in field
  player.pos.x = clamp(player.pos.x, FIELD.PLAYER_RADIUS, FIELD.W - FIELD.PLAYER_RADIUS)
  player.pos.y = clamp(player.pos.y, FIELD.PLAYER_RADIUS, FIELD.H - FIELD.PLAYER_RADIUS)

  // Auto-tackle: if near ball carrier from opponent team
  const carrier = state.players.find(p => p.id === ball.ownerId)
  if (carrier && carrier.team !== player.team) {
    const dCarrier = dist2d(player.pos, carrier.pos)
    if (dCarrier < FIELD.TACKLE_DIST) {
      const success = Math.random() > 0.72  // 28% chance per tick = ~1.4 per second
      if (success) {
        carrier.hasBall = false
        ball.ownerId = null
        ball.vel = { x: player.facing.x * 6, y: player.facing.y * 6, z: 0 }
      }
    }
  }
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
    jersey: number
  ) => {
    const role = gridSlotToRole(slotIdx)
    const pos = gridSlotToStartPos(slotIdx, team)
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

  addGK('home', home.jerseyNumbers[0])
  addGK('away', away.jerseyNumbers[0])

  home.formation!.slots.forEach((slotIdx, i) => {
    addOutfielder('home', slotIdx, i, i === 0, home.jerseyNumbers[i + 1])
  })
  away.formation!.slots.forEach((slotIdx, i) => {
    addOutfielder('away', slotIdx, i, i === 0, away.jerseyNumbers[i + 1])
  })

  return players
}

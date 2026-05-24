import type * as Party from 'partykit/server'
import type { GameState, PlayerInput, ClientMsg, ServerMsg, Player, Ball, Vec2 } from '../src/types'
import { FIELD } from '../src/types'

const TICK_MS = 50
const DT = TICK_MS / 1000
const FRICTION = 0.95
const WALL_BOUNCE = 0.95          // very elastic walls
const PLAYER_SPEED = 13
const PLAYER_ACCEL = 0.28
const GK_SPEED = 11
const GK_RUSH_DIST = 22
const BALL_PLAYER_RESTITUTION = 0.95  // bouncier player deflection
const GOAL_FREEZE = 1.5           // seconds players are frozen after a goal (match ceremony duration)

export default class SoccerServer implements Party.Server {
  private state: GameState
  private inputs: Map<string, PlayerInput> = new Map()
  private assignments: Map<string, 'home' | 'away'> = new Map()
  private homeConnId: string | null = null
  private awayConnId: string | null = null
  private tickInterval: ReturnType<typeof setInterval> | null = null
  private countdownTimer: ReturnType<typeof setInterval> | null = null
  private lastTickAt = 0

  constructor(readonly room: Party.Room) {
    this.state = makeInitialState()
  }

  onConnect(conn: Party.Connection) {
    let team: 'home' | 'away' | null = null
    if (this.homeConnId === null) { team = 'home'; this.homeConnId = conn.id }
    else if (this.awayConnId === null) { team = 'away'; this.awayConnId = conn.id }

    if (team === null) {
      conn.send(JSON.stringify({ type: 'error', msg: 'Room full' } satisfies ServerMsg))
      conn.close()
      return
    }

    this.assignments.set(conn.id, team)
    conn.send(JSON.stringify({ type: 'assigned', team } satisfies ServerMsg))

    // If game ended and both players reconnected → reset for rematch
    if (this.homeConnId && this.awayConnId && this.state.phase === 'ended') {
      this.state = makeInitialState()
      this.state.lobby = {
        home: { color: null, ready: false },
        away: { color: null, ready: false },
      }
      this.broadcast({ type: 'state', state: this.state })
      return
    }

    if (this.homeConnId && this.awayConnId && this.state.phase === 'lobby' && !this.state.lobby) {
      this.state.lobby = {
        home: { color: null, ready: false },
        away: { color: null, ready: false },
      }
      this.broadcast({ type: 'state', state: this.state })
    }

    conn.send(JSON.stringify({ type: 'state', state: this.state } satisfies ServerMsg))
  }

  onClose(conn: Party.Connection) {
    if (this.homeConnId === conn.id) this.homeConnId = null
    if (this.awayConnId === conn.id) this.awayConnId = null
    this.assignments.delete(conn.id)
    this.inputs.delete(conn.id)

    if (!this.homeConnId && !this.awayConnId) {
      if (this.tickInterval) { clearInterval(this.tickInterval); this.tickInterval = null }
      if (this.countdownTimer) { clearInterval(this.countdownTimer); this.countdownTimer = null }
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
      const team = this.assignments.get(sender.id)
      if (!team || !this.state.lobby) return
      const slot = this.state.lobby[team]
      if (!slot) return
      if (msg.color !== undefined) slot.color = msg.color
      if (msg.ready !== undefined) slot.ready = msg.ready
      if (msg.username !== undefined) slot.username = msg.username
      this.broadcast({ type: 'state', state: this.state })
      this.checkBothReady()
    }
  }

  private ensureTicking() {
    if (this.state.phase !== 'playing') return
    const now = Date.now()
    if (now - this.lastTickAt > TICK_MS * 5) {
      if (this.tickInterval) { clearInterval(this.tickInterval); this.tickInterval = null }
      this.tickInterval = setInterval(() => this.tick(), TICK_MS)
    }
  }

  private checkBothReady() {
    const { home, away } = this.state.lobby ?? {}
    if (home?.ready && away?.ready && home.color && away.color) this.startCountdown()
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
        clearInterval(this.countdownTimer!); this.countdownTimer = null
        this.startGame()
      } else {
        this.state.countdown = n
        this.broadcast({ type: 'state', state: this.state })
      }
    }, 1000)
  }

  private startGame() {
    this.state.players = buildPlayers()
    this.state.timeLeft = 150
    this.state.countdown = undefined
    this.state.phase = 'playing'
    this.state.ball = { pos: { x: FIELD.CENTER_X, y: FIELD.CENTER_Y }, vel: { x: 0, y: 0 }, ownerId: null }
    this.broadcast({ type: 'state', state: this.state })
    if (this.tickInterval) { clearInterval(this.tickInterval); this.tickInterval = null }
    this.lastTickAt = Date.now()
    this.tickInterval = setInterval(() => this.tick(), TICK_MS)
  }

  private tick() {
    this.lastTickAt = Date.now()
    const { state } = this
    if (state.phase !== 'playing') return

    // 1. Human input → move controlled field players
    for (const team of ['home', 'away'] as const) {
      const connId = [...this.assignments.entries()].find(([, t]) => t === team)?.[0]
      const input = connId ? (this.inputs.get(connId) ?? null) : null
      const controlled = state.players.find(p => p.team === team && p.isControlled && p.role !== 'gk')
      if (controlled && input && controlled.stunTimer <= 0) {
        const hasBall = controlled.id === state.ball.ownerId
        movePlayer(controlled, input.dx, input.dy, hasBall)
        if (controlled.id === state.ball.ownerId && input.kickPower > 0) {
          releaseBallKick(state.ball, controlled, input.kickPower)
        }
      }
    }

    // 2. Stun timers — light friction, preserve knockback momentum longer
    for (const p of state.players) {
      if (p.stunTimer > 0) {
        p.stunTimer = Math.max(0, p.stunTimer - DT)
        p.vel.x *= 0.97; p.vel.y *= 0.97
        p.pos.x += p.vel.x * DT; p.pos.y += p.vel.y * DT
        clampToField(p)
      }
    }

    // 3. Field AI (non-controlled, non-GK)
    for (const p of state.players) {
      if (p.isControlled || p.role === 'gk' || p.stunTimer > 0) continue
      tickFieldAI(state, p)
    }

    // 4. GK AI
    for (const p of state.players) {
      if (p.role === 'gk') tickGKAI(state, p)
    }

    // 5. Ball physics
    const ball = state.ball
    if (ball.ownerId === null) {
      ball.pos.x += ball.vel.x * DT
      ball.pos.y += ball.vel.y * DT
      ball.vel.x *= FRICTION; ball.vel.y *= FRICTION
      if (Math.abs(ball.vel.x) < 0.05) ball.vel.x = 0
      if (Math.abs(ball.vel.y) < 0.05) ball.vel.y = 0
      bounceBall(state)
    } else {
      const owner = state.players.find(p => p.id === ball.ownerId)
      if (owner) {
        ball.pos.x = owner.pos.x + owner.facing.x * 1.0
        ball.pos.y = owner.pos.y + owner.facing.y * 1.0
      } else {
        ball.ownerId = null
      }
    }

    // 6. Dribble attach: slow free ball → nearest non-GK picks it up
    if (ball.ownerId === null && ballSpeed(ball) < FIELD.BALL_SLOW_SPEED) {
      let nearest: Player | null = null
      let nearestDist = FIELD.PLAYER_RADIUS * 3
      for (const p of state.players) {
        if (p.role === 'gk' || p.stunTimer > 0) continue
        const d = dist2d(p.pos, ball.pos)
        if (d < nearestDist) { nearestDist = d; nearest = p }
      }
      if (nearest) {
        ball.ownerId = nearest.id
        ball.vel = { x: 0, y: 0 }
        for (const p of state.players) {
          if (p.team === nearest.team && p.role !== 'gk') p.isControlled = false
        }
        nearest.isControlled = true
      }
    }

    // 7. Fast ball collision with non-owner field players (chaotic deflection)
    if (ball.ownerId === null && ballSpeed(ball) >= FIELD.BALL_SLOW_SPEED) {
      for (const p of state.players) {
        if (p.id === ball.ownerId || p.role === 'gk') continue
        const d = dist2d(p.pos, ball.pos)
        if (d < FIELD.PLAYER_RADIUS + FIELD.BALL_RADIUS) {
          deflectBall(state.ball, p)
          break
        }
      }
    }

    // 8. Player-player collision
    for (let i = 0; i < state.players.length; i++) {
      for (let j = i + 1; j < state.players.length; j++) {
        resolvePlayerCollision(state, state.players[i], state.players[j])
      }
    }

    // 9. Goal detection
    if (checkGoal(state)) {
      this.broadcast({ type: 'state', state })
      return
    }

    // 10. Possession stats
    if (ball.ownerId) {
      const owner = state.players.find(p => p.id === ball.ownerId)
      if (owner) state.stats.possession[owner.team]++
    }

    // 11. Timer
    state.timeLeft = Math.max(0, state.timeLeft - DT)
    if (state.timeLeft <= 0) {
      this.endHalf()
      return
    }

    this.broadcast({ type: 'state', state })
  }

  private endHalf() {
    if (this.state.half === 1) {
      this.state.phase = 'halftime'
      this.state.half = 2
      this.broadcast({ type: 'state', state: this.state })
      setTimeout(() => {
        this.state.timeLeft = 150
        this.startCountdown()
      }, 5000)
    } else {
      this.state.phase = 'ended'
      if (this.tickInterval) { clearInterval(this.tickInterval); this.tickInterval = null }
      this.broadcast({ type: 'state', state: this.state })
    }
  }

  private broadcast(msg: ServerMsg) {
    this.room.broadcast(JSON.stringify(msg))
  }
}

// ─── Player helpers ───────────────────────────────────────────────────────────

function movePlayer(p: Player, dx: number, dy: number, hasBall = false): void {
  const len = Math.sqrt(dx * dx + dy * dy)
  if (len < 0.01) {
    p.vel.x *= 0.7; p.vel.y *= 0.7
    p.pos.x += p.vel.x * DT; p.pos.y += p.vel.y * DT
    clampToField(p)
    return
  }
  const nx = dx / len, ny = dy / len
  const speed = hasBall ? PLAYER_SPEED * 1.12 : PLAYER_SPEED
  const targetVx = nx * speed, targetVy = ny * speed
  p.vel.x += (targetVx - p.vel.x) * PLAYER_ACCEL
  p.vel.y += (targetVy - p.vel.y) * PLAYER_ACCEL
  p.pos.x += p.vel.x * DT
  p.pos.y += p.vel.y * DT
  p.facing = { x: nx, y: ny }
  clampToField(p)
}

function clampToField(p: Player): void {
  const r = FIELD.PLAYER_RADIUS
  p.pos.x = clamp(p.pos.x, r, FIELD.W - r)
  p.pos.y = clamp(p.pos.y, r, FIELD.H - r)
}

// ─── Ball helpers ─────────────────────────────────────────────────────────────

function ballSpeed(ball: Ball): number {
  return Math.sqrt(ball.vel.x ** 2 + ball.vel.y ** 2)
}

function releaseBallKick(ball: Ball, player: Player, power: number): void {
  const spd = FIELD.KICK_MIN_SPEED + (FIELD.KICK_MAX_SPEED - FIELD.KICK_MIN_SPEED) * power
  const spread = (Math.random() - 0.5) * 0.52  // ±~15°
  const angle = Math.atan2(player.facing.y, player.facing.x) + spread
  ball.vel = { x: Math.cos(angle) * spd, y: Math.sin(angle) * spd }
  ball.ownerId = null
}

function deflectBall(ball: Ball, player: Player): void {
  const nx = (ball.pos.x - player.pos.x), ny = (ball.pos.y - player.pos.y)
  const len = Math.sqrt(nx * nx + ny * ny) || 1
  const rnx = nx / len, rny = ny / len
  const dot = ball.vel.x * rnx + ball.vel.y * rny
  ball.vel.x = (ball.vel.x - 2 * dot * rnx + player.vel.x * 0.5) * BALL_PLAYER_RESTITUTION
  ball.vel.y = (ball.vel.y - 2 * dot * rny + player.vel.y * 0.5) * BALL_PLAYER_RESTITUTION
  // Random ±25° spread for chaos
  const spread = (Math.random() - 0.5) * 0.87
  const angle = Math.atan2(ball.vel.y, ball.vel.x) + spread
  const spd = Math.min(ballSpeed(ball), FIELD.KICK_MAX_SPEED)
  ball.vel = { x: Math.cos(angle) * spd, y: Math.sin(angle) * spd }
  ball.pos.x = player.pos.x + rnx * (FIELD.PLAYER_RADIUS + FIELD.BALL_RADIUS + 0.1)
  ball.pos.y = player.pos.y + rny * (FIELD.PLAYER_RADIUS + FIELD.BALL_RADIUS + 0.1)
}

function bounceBall(state: GameState): void {
  const { ball } = state
  const br = FIELD.BALL_RADIUS
  const goalTop = FIELD.CENTER_Y - FIELD.GOAL_WIDTH / 2
  const goalBot = FIELD.CENTER_Y + FIELD.GOAL_WIDTH / 2

  if (ball.pos.y < br) { ball.pos.y = br; ball.vel.y = Math.abs(ball.vel.y) * WALL_BOUNCE }
  if (ball.pos.y > FIELD.H - br) { ball.pos.y = FIELD.H - br; ball.vel.y = -Math.abs(ball.vel.y) * WALL_BOUNCE }

  if (ball.pos.x < br && !(ball.pos.y >= goalTop && ball.pos.y <= goalBot)) {
    ball.pos.x = br; ball.vel.x = Math.abs(ball.vel.x) * WALL_BOUNCE
  }
  if (ball.pos.x > FIELD.W - br && !(ball.pos.y >= goalTop && ball.pos.y <= goalBot)) {
    ball.pos.x = FIELD.W - br; ball.vel.x = -Math.abs(ball.vel.x) * WALL_BOUNCE
  }
}

function checkGoal(state: GameState): boolean {
  const { ball } = state
  const goalTop = FIELD.CENTER_Y - FIELD.GOAL_WIDTH / 2
  const goalBot = FIELD.CENTER_Y + FIELD.GOAL_WIDTH / 2
  let scored = false

  if (ball.pos.x <= 0 && ball.pos.y >= goalTop && ball.pos.y <= goalBot) {
    state.score.away++; state.stats.shots.away++; scored = true
  } else if (ball.pos.x >= FIELD.W && ball.pos.y >= goalTop && ball.pos.y <= goalBot) {
    state.score.home++; state.stats.shots.home++; scored = true
  }

  if (scored) {
    for (const p of state.players) {
      const init = getInitialPos(p.id)
      p.pos = { ...init }; p.vel = { x: 0, y: 0 }
      // Freeze all players briefly — nobody picks up ball until freeze lifts
      p.stunTimer = GOAL_FREEZE
    }
    ball.pos = { x: FIELD.CENTER_X, y: FIELD.CENTER_Y }
    ball.vel = { x: 0, y: 0 }
    ball.ownerId = null
    for (const p of state.players) p.isControlled = false
    const hFw = state.players.find(p => p.team === 'home' && p.role === 'fw')
    const aFw = state.players.find(p => p.team === 'away' && p.role === 'fw')
    if (hFw) hFw.isControlled = true
    if (aFw) aFw.isControlled = true
  }
  return scored
}

// ─── Collision ────────────────────────────────────────────────────────────────

function resolvePlayerCollision(state: GameState, a: Player, b: Player): void {
  const dx = b.pos.x - a.pos.x, dy = b.pos.y - a.pos.y
  const d = Math.sqrt(dx * dx + dy * dy)
  const minDist = FIELD.PLAYER_RADIUS * 2
  if (d >= minDist || d < 0.001) return

  const nx = dx / d, ny = dy / d

  // Push apart
  const overlap = (minDist - d) / 2
  a.pos.x -= nx * overlap; a.pos.y -= ny * overlap
  b.pos.x += nx * overlap; b.pos.y += ny * overlap
  clampToField(a); clampToField(b)

  // Velocity along collision normal
  const rvx = b.vel.x - a.vel.x, rvy = b.vel.y - a.vel.y
  const relSpeed = Math.sqrt(rvx * rvx + rvy * rvy)
  const dot = rvx * nx + rvy * ny

  // dot < 0 means they're approaching along the collision normal — apply bounce
  if (dot < 0) {
    // Super-elastic: e=2 bounce factor. impulse = -dot * (1+e)/2 = -dot * 1.5
    const impulse = -dot * 1.5  // positive value
    a.vel.x -= impulse * nx; a.vel.y -= impulse * ny  // push a away from b
    b.vel.x += impulse * nx; b.vel.y += impulse * ny  // push b away from a
  }

  // Stun + ball release on hard collision — duration scales with impact speed
  if (relSpeed > FIELD.STUN_SPEED_THRESHOLD && a.stunTimer <= 0 && b.stunTimer <= 0) {
    const stunSecs = Math.min(0.4 + relSpeed * 0.07, 2.5)
    a.stunTimer = stunSecs
    b.stunTimer = stunSecs
    if (state.ball.ownerId === a.id || state.ball.ownerId === b.id) {
      state.ball.ownerId = null
      state.ball.vel = { x: (Math.random() - 0.5) * 14, y: (Math.random() - 0.5) * 14 }
    }
  }
}

// ─── AI ───────────────────────────────────────────────────────────────────────

function tickFieldAI(state: GameState, p: Player): void {
  const { ball } = state
  const myGoalX = p.team === 'home' ? FIELD.GK_HOME_X : FIELD.GK_AWAY_X
  const oppGoalX = p.team === 'home' ? FIELD.W : 0
  const ballInOwnHalf = p.team === 'home' ? ball.pos.x < FIELD.CENTER_X : ball.pos.x > FIELD.CENTER_X

  let tx: number, ty: number, aiSpeed: number

  if (p.role === 'fw') {
    // Chase ball anywhere, very aggressive
    tx = ball.pos.x; ty = ball.pos.y
    aiSpeed = PLAYER_SPEED * 0.97
  } else if (p.role === 'mf') {
    // Full field tracking, stay at least 12 units from own goal
    const ownBound = p.team === 'home' ? myGoalX + 12 : FIELD.W - 12
    const oppBound = p.team === 'home' ? FIELD.W - 8 : 8
    tx = clamp(ball.pos.x, Math.min(ownBound, oppBound), Math.max(ownBound, oppBound))
    ty = ball.pos.y
    aiSpeed = PLAYER_SPEED * 0.93
  } else {
    // DF: press ball when it's in own half, hold compact position when in opp half
    if (ballInOwnHalf) {
      // Intercept — track ball but stay between ball and own goal
      // home: clamp to [12, 50]; away: clamp to [50, 88] (correct direction per team)
      const dfLo = p.team === 'home' ? myGoalX + 8 : FIELD.CENTER_X
      const dfHi = p.team === 'home' ? FIELD.CENTER_X : myGoalX - 8
      tx = clamp(ball.pos.x, dfLo, dfHi)
      ty = ball.pos.y
    } else {
      // Hold position ~22 units from goal, shadow ball Y to stay ready
      tx = p.team === 'home' ? 22 : 78
      ty = clamp(ball.pos.y, 12, 48)
    }
    aiSpeed = PLAYER_SPEED * 0.91
  }

  const dx = tx - p.pos.x, dy = ty - p.pos.y
  const d = Math.sqrt(dx * dx + dy * dy)
  if (d > 0.5) {
    const nx = dx / d, ny = dy / d
    p.vel.x += (nx * aiSpeed - p.vel.x) * PLAYER_ACCEL
    p.vel.y += (ny * aiSpeed - p.vel.y) * PLAYER_ACCEL
    p.pos.x += p.vel.x * DT; p.pos.y += p.vel.y * DT
    p.facing = { x: nx, y: ny }
    clampToField(p)
  }

  // Kick toward goal immediately when AI picks up ball
  if (p.id === state.ball.ownerId) {
    const dir = norm2d({ x: oppGoalX - p.pos.x, y: FIELD.CENTER_Y - p.pos.y })
    const spread = (Math.random() - 0.5) * 0.5
    const angle = Math.atan2(dir.y, dir.x) + spread
    const spd = FIELD.KICK_MIN_SPEED + Math.random() * (FIELD.KICK_MAX_SPEED - FIELD.KICK_MIN_SPEED) * 0.65
    state.ball.vel = { x: Math.cos(angle) * spd, y: Math.sin(angle) * spd }
    state.ball.ownerId = null
  }
}

function tickGKAI(state: GameState, gk: Player): void {
  const { ball } = state
  const goalX = gk.team === 'home' ? FIELD.GK_HOME_X : FIELD.GK_AWAY_X
  const oppGoalX = gk.team === 'home' ? FIELD.W : 0
  const d = dist2d(gk.pos, ball.pos)

  if (d < GK_RUSH_DIST && ball.ownerId !== gk.id) {
    const dir = norm2d({ x: ball.pos.x - gk.pos.x, y: ball.pos.y - gk.pos.y })
    gk.vel.x += (dir.x * GK_SPEED - gk.vel.x) * 0.3
    gk.vel.y += (dir.y * GK_SPEED - gk.vel.y) * 0.3
    gk.pos.x += gk.vel.x * DT; gk.pos.y += gk.vel.y * DT
    gk.facing = dir
    clampToField(gk)

    if (d < FIELD.PLAYER_RADIUS * 2) {
      const spread = (Math.random() - 0.5) * 0.7
      const angle = Math.atan2(FIELD.CENTER_Y - gk.pos.y, oppGoalX - gk.pos.x) + spread
      const spd = 32 + Math.random() * 20
      state.ball.vel = { x: Math.cos(angle) * spd, y: Math.sin(angle) * spd }
      state.ball.ownerId = null
    }
  } else {
    const ty = clamp(ball.pos.y, FIELD.CENTER_Y - FIELD.GOAL_WIDTH / 2 - 1, FIELD.CENTER_Y + FIELD.GOAL_WIDTH / 2 + 1)
    const dy = ty - gk.pos.y
    if (Math.abs(dy) > 0.3) {
      gk.vel.x = 0; gk.vel.y = Math.sign(dy) * GK_SPEED * 0.7
      gk.pos.y += gk.vel.y * DT
    } else {
      gk.vel.x = 0; gk.vel.y = 0
    }
    gk.pos.x = goalX
    gk.pos.y = clamp(gk.pos.y, FIELD.PLAYER_RADIUS, FIELD.H - FIELD.PLAYER_RADIUS)
  }
}

// ─── Builders ─────────────────────────────────────────────────────────────────

function buildPlayers(): Player[] {
  const make = (id: string, team: 'home' | 'away', role: 'gk' | 'df' | 'mf' | 'fw', pos: Vec2, controlled: boolean): Player => ({
    id, team, role, pos, vel: { x: 0, y: 0 },
    facing: { x: team === 'home' ? 1 : -1, y: 0 },
    isControlled: controlled, stunTimer: 0,
  })

  // Zigzag formation: players staggered on Y axis so they don't line up
  return [
    make('home-gk',  'home', 'gk', { x: FIELD.GK_HOME_X, y: 30 }, false),
    make('home-df',  'home', 'df', { x: 18, y: 22 }, false),
    make('home-mf1', 'home', 'mf', { x: 30, y: 38 }, false),
    make('home-mf2', 'home', 'mf', { x: 40, y: 20 }, false),
    make('home-fw',  'home', 'fw', { x: 48, y: 35 }, true),

    make('away-gk',  'away', 'gk', { x: FIELD.GK_AWAY_X, y: 30 }, false),
    make('away-df',  'away', 'df', { x: 82, y: 38 }, false),
    make('away-mf1', 'away', 'mf', { x: 70, y: 22 }, false),
    make('away-mf2', 'away', 'mf', { x: 60, y: 40 }, false),
    make('away-fw',  'away', 'fw', { x: 52, y: 25 }, true),
  ]
}

function getInitialPos(id: string): Vec2 {
  const map: Record<string, Vec2> = {
    'home-gk':  { x: FIELD.GK_HOME_X, y: 30 },
    'home-df':  { x: 18, y: 22 },
    'home-mf1': { x: 30, y: 38 },
    'home-mf2': { x: 40, y: 20 },
    'home-fw':  { x: 48, y: 35 },
    'away-gk':  { x: FIELD.GK_AWAY_X, y: 30 },
    'away-df':  { x: 82, y: 38 },
    'away-mf1': { x: 70, y: 22 },
    'away-mf2': { x: 60, y: 40 },
    'away-fw':  { x: 52, y: 25 },
  }
  return map[id] ?? { x: FIELD.CENTER_X, y: FIELD.CENTER_Y }
}

function makeInitialState(): GameState {
  return {
    players: [],
    ball: { pos: { x: FIELD.CENTER_X, y: FIELD.CENTER_Y }, vel: { x: 0, y: 0 }, ownerId: null },
    score: { home: 0, away: 0 },
    timeLeft: 3 * 60,
    half: 1,
    phase: 'lobby',
    stats: { possession: { home: 0, away: 0 }, shots: { home: 0, away: 0 } },
  }
}

// ─── Utils ────────────────────────────────────────────────────────────────────

function dist2d(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x, dy = a.y - b.y
  return Math.sqrt(dx * dx + dy * dy)
}

function norm2d(v: Vec2): Vec2 {
  const d = Math.sqrt(v.x * v.x + v.y * v.y)
  if (d < 0.0001) return { x: 0, y: 0 }
  return { x: v.x / d, y: v.y / d }
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

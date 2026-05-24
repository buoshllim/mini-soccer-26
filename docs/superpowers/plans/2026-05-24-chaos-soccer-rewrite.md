# Chaos Soccer Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the game as a chaotic, comedic arcade soccer game — ditching FC-clone complexity in favor of bouncy unpredictable physics, one-button controls, and player stumble collisions.

**Architecture:** The server (`party/server.ts`) is reduced from 1190 lines to ~350 by removing offside, setpieces, stamina, tackle types, formations, and jersey selection. Ball is 2D (no z-axis), slow balls auto-attach for dribbling, fast balls deflect chaotically off players. One kick button replaces all five action keys. 4v4 (3 field + 1 auto-GK per team); human auto-switches to the field player who just picked up the ball.

**Tech Stack:** TypeScript, Partykit (Cloudflare Workers), Three.js, nipplejs (mobile joystick)

---

## File Map

| File | Change |
|---|---|
| `src/types.ts` | Full rewrite — new Player/Ball/Input types, simpler FIELD constants |
| `party/server.ts` | Full rewrite — ~350 lines, new physics/AI |
| `src/game/input.ts` | Full rewrite — move + one kick button only |
| `src/screens/lobby.ts` | Full rewrite — color + ready only |
| `src/game/renderer.ts` | Modify — adapt to new types, remove indicator/setpiece visuals, add stumble tilt |
| `src/game/ui.ts` | Modify — remove key hints, keep score/timer/minimap/confetti |
| `src/main.ts` | Modify — remove setpiece phase handling |
| `src/game/camera.ts` | No change |

---

## Task 1: Rewrite `src/types.ts`

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Replace the entire file**

```typescript
export type Vec2 = { x: number; y: number }
export type TeamColor = 'blue' | 'red' | 'green' | 'yellow'
export type PlayerRole = 'gk' | 'fwd' | 'def'

export type Player = {
  id: string
  team: 'home' | 'away'
  role: PlayerRole
  pos: Vec2
  vel: Vec2           // current velocity (units/sec), used for collision
  facing: Vec2        // normalized direction
  isControlled: boolean
  stunTimer: number   // seconds remaining; >0 = stumbled, ignores input
}

export type Ball = {
  pos: Vec2           // 2D only — ball stays on ground
  vel: Vec2
  ownerId: string | null
}

export type LobbyState = {
  home: { color: TeamColor | null; ready: boolean } | null
  away: { color: TeamColor | null; ready: boolean } | null
}

export type GamePhase = 'lobby' | 'countdown' | 'playing' | 'halftime' | 'ended'

export type GameState = {
  players: Player[]
  ball: Ball
  score: { home: number; away: number }
  timeLeft: number
  half: 1 | 2
  phase: GamePhase
  lobby?: LobbyState
  stats: { possession: { home: number; away: number }; shots: { home: number; away: number } }
  countdown?: number
}

export type PlayerInput = {
  dx: number          // -1 to 1
  dy: number          // -1 to 1
  kickPower: number   // 0 = not kicking; 0.01-1 = released with this power
}

export type ServerMsg =
  | { type: 'state'; state: GameState }
  | { type: 'assigned'; team: 'home' | 'away' }
  | { type: 'error'; msg: string }

export type ClientMsg =
  | { type: 'input'; input: PlayerInput }
  | { type: 'lobby'; color?: TeamColor; ready?: boolean }

export const FIELD = {
  W: 100, H: 60,
  GOAL_WIDTH: 12,
  CENTER_X: 50, CENTER_Y: 30,
  PLAYER_RADIUS: 1.2,
  BALL_RADIUS: 0.7,
  BALL_SLOW_SPEED: 4,        // below this → dribble-attach
  KICK_MIN_SPEED: 14,
  KICK_MAX_SPEED: 42,
  STUN_DURATION: 0.55,       // seconds after hard collision
  STUN_SPEED_THRESHOLD: 6,   // relative speed (units/sec) to cause stun
  GK_HOME_X: 4,
  GK_AWAY_X: 96,
} as const
```

- [ ] **Step 2: Verify TypeScript compiles (it will fail — that's expected until other files are updated)**

```bash
cd /path/to/soccer-game && npx tsc --noEmit 2>&1 | head -30
```

Expected: errors referencing old types in server.ts, input.ts, etc. That's fine — we fix them task by task.

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "refactor: simplify types for chaos-soccer rewrite"
```

---

## Task 2: Rewrite `party/server.ts`

**Files:**
- Modify: `party/server.ts`

This is the largest task. Replace the entire file with the new logic below.

**Key mechanics implemented:**
- Ball 2D physics with friction + wall bounce + high restitution
- Slow ball (speed < BALL_SLOW_SPEED) auto-attaches to nearest field player → dribble
- Owner releases ball on kick (kickPower > 0) with randomised spread (±15°)
- Fast ball hits non-owner player → chaotic deflection (±25° random spread)
- Player-player collision → push apart; if relative speed > STUN_SPEED_THRESHOLD → both stun
- Auto-switch: when dribble attaches, that player becomes `isControlled`
- Field AI: FWD chases ball aggressively; DEF tracks ball toward own half
- GK AI: slides along goal line tracking ball Y; rushes when ball enters PA zone; kicks with ±20° random

- [ ] **Step 1: Replace the entire file**

```typescript
import type * as Party from 'partykit/server'
import type { GameState, PlayerInput, ClientMsg, ServerMsg, LobbyState, Player, Ball, Vec2 } from '../src/types'
import { FIELD } from '../src/types'

const TICK_MS = 50
const DT = TICK_MS / 1000
const FRICTION = 0.86          // ball speed multiplier per tick (ground)
const PLAYER_SPEED = 9         // units/sec
const PLAYER_ACCEL = 0.25      // lerp factor toward target velocity per tick
const GK_SPEED = 8
const GK_RUSH_DIST = 14        // distance at which GK rushes ball
const BALL_PLAYER_RESTITUTION = 0.72

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
    this.state.timeLeft = 3 * 60
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
        movePlayer(controlled, input.dx, input.dy)
        // Kick: if this player owns the ball and kickPower > 0
        if (controlled.id === state.ball.ownerId && input.kickPower > 0) {
          releaseBallKick(state.ball, controlled, input.kickPower)
        }
      }
    }

    // 2. Stun timers
    for (const p of state.players) {
      if (p.stunTimer > 0) {
        p.stunTimer = Math.max(0, p.stunTimer - DT)
        // Slide to stop while stunned
        p.vel.x *= 0.8; p.vel.y *= 0.8
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
      // Ground friction
      ball.vel.x *= FRICTION; ball.vel.y *= FRICTION
      if (Math.abs(ball.vel.x) < 0.05) ball.vel.x = 0
      if (Math.abs(ball.vel.y) < 0.05) ball.vel.y = 0
      // Wall bounces
      bounceBall(state)
    } else {
      // Move ball with owner
      const owner = state.players.find(p => p.id === ball.ownerId)
      if (owner) {
        ball.pos.x = owner.pos.x + owner.facing.x * 1.0
        ball.pos.y = owner.pos.y + owner.facing.y * 1.0
      } else {
        ball.ownerId = null
      }
    }

    // 6. Dribble attach: slow free ball → nearest field player picks it up
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
        // Auto-switch: new dribbler becomes controlled
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
        this.state.timeLeft = 3 * 60
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

function movePlayer(p: Player, dx: number, dy: number): void {
  const len = Math.sqrt(dx * dx + dy * dy)
  if (len < 0.01) {
    p.vel.x *= 0.7; p.vel.y *= 0.7
    p.pos.x += p.vel.x * DT; p.pos.y += p.vel.y * DT
    clampToField(p)
    return
  }
  const nx = dx / len, ny = dy / len
  const targetVx = nx * PLAYER_SPEED, targetVy = ny * PLAYER_SPEED
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
  const spread = (Math.random() - 0.5) * 0.52  // ±~15° in radians
  const angle = Math.atan2(player.facing.y, player.facing.x) + spread
  ball.vel = { x: Math.cos(angle) * spd, y: Math.sin(angle) * spd }
  ball.ownerId = null
}

function deflectBall(ball: Ball, player: Player): void {
  // Reflect ball off player, add player velocity contribution and random spread
  const nx = (ball.pos.x - player.pos.x), ny = (ball.pos.y - player.pos.y)
  const len = Math.sqrt(nx * nx + ny * ny) || 1
  const rnx = nx / len, rny = ny / len
  const dot = ball.vel.x * rnx + ball.vel.y * rny
  ball.vel.x = (ball.vel.x - 2 * dot * rnx + player.vel.x * 0.5) * BALL_PLAYER_RESTITUTION
  ball.vel.y = (ball.vel.y - 2 * dot * rny + player.vel.y * 0.5) * BALL_PLAYER_RESTITUTION
  // Random spread ±25°
  const spread = (Math.random() - 0.5) * 0.87
  const angle = Math.atan2(ball.vel.y, ball.vel.x) + spread
  const spd = Math.min(ballSpeed(ball), FIELD.KICK_MAX_SPEED)
  ball.vel = { x: Math.cos(angle) * spd, y: Math.sin(angle) * spd }
  // Push ball out of player radius
  ball.pos.x = player.pos.x + rnx * (FIELD.PLAYER_RADIUS + FIELD.BALL_RADIUS + 0.1)
  ball.pos.y = player.pos.y + rny * (FIELD.PLAYER_RADIUS + FIELD.BALL_RADIUS + 0.1)
}

function bounceBall(state: GameState): void {
  const { ball } = state
  const br = FIELD.BALL_RADIUS

  // Top/bottom walls — full bounce
  if (ball.pos.y < br) { ball.pos.y = br; ball.vel.y = Math.abs(ball.vel.y) * 0.82 }
  if (ball.pos.y > FIELD.H - br) { ball.pos.y = FIELD.H - br; ball.vel.y = -Math.abs(ball.vel.y) * 0.82 }

  // Left goal zone check (home goal)
  const goalTop = FIELD.CENTER_Y - FIELD.GOAL_WIDTH / 2
  const goalBot = FIELD.CENTER_Y + FIELD.GOAL_WIDTH / 2
  if (ball.pos.x < br) {
    if (ball.pos.y >= goalTop && ball.pos.y <= goalBot) {
      // Ball in goal — handled by checkGoal; let it pass
    } else {
      ball.pos.x = br; ball.vel.x = Math.abs(ball.vel.x) * 0.82
    }
  }
  // Right goal zone check (away goal)
  if (ball.pos.x > FIELD.W - br) {
    if (ball.pos.y >= goalTop && ball.pos.y <= goalBot) {
      // Ball in goal — handled by checkGoal
    } else {
      ball.pos.x = FIELD.W - br; ball.vel.x = -Math.abs(ball.vel.x) * 0.82
    }
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
    // Reset positions & ball to center
    for (const p of state.players) {
      const init = getInitialPos(p.id, p.team, p.role)
      p.pos = { ...init }; p.vel = { x: 0, y: 0 }; p.stunTimer = 0
    }
    ball.pos = { x: FIELD.CENTER_X, y: FIELD.CENTER_Y }
    ball.vel = { x: 0, y: 0 }
    ball.ownerId = null
    // Reset controlled
    for (const p of state.players) p.isControlled = false
    const hFirst = state.players.find(p => p.team === 'home' && p.role === 'fwd')
    const aFirst = state.players.find(p => p.team === 'away' && p.role === 'fwd')
    if (hFirst) hFirst.isControlled = true
    if (aFirst) aFirst.isControlled = true
  }
  return scored
}

// ─── Collision ────────────────────────────────────────────────────────────────

function resolvePlayerCollision(state: GameState, a: Player, b: Player): void {
  const dx = b.pos.x - a.pos.x, dy = b.pos.y - a.pos.y
  const d = Math.sqrt(dx * dx + dy * dy)
  const minDist = FIELD.PLAYER_RADIUS * 2
  if (d >= minDist || d < 0.001) return

  // Relative speed
  const rvx = b.vel.x - a.vel.x, rvy = b.vel.y - a.vel.y
  const relSpeed = Math.sqrt(rvx * rvx + rvy * rvy)

  // Push apart
  const overlap = (minDist - d) / 2
  const nx = dx / d, ny = dy / d
  a.pos.x -= nx * overlap; a.pos.y -= ny * overlap
  b.pos.x += nx * overlap; b.pos.y += ny * overlap
  clampToField(a); clampToField(b)

  // Velocity exchange
  const dot = rvx * nx + rvy * ny
  if (dot > 0) {
    a.vel.x += dot * nx * 0.5; a.vel.y += dot * ny * 0.5
    b.vel.x -= dot * nx * 0.5; b.vel.y -= dot * ny * 0.5
  }

  // Stun if hard enough
  if (relSpeed > FIELD.STUN_SPEED_THRESHOLD && a.stunTimer <= 0 && b.stunTimer <= 0) {
    a.stunTimer = FIELD.STUN_DURATION
    b.stunTimer = FIELD.STUN_DURATION
    // Release ball if stunned owner was dribbling
    if (state.ball.ownerId === a.id || state.ball.ownerId === b.id) {
      state.ball.ownerId = null
      state.ball.vel = { x: (Math.random() - 0.5) * 8, y: (Math.random() - 0.5) * 8 }
    }
  }
}

// ─── AI ───────────────────────────────────────────────────────────────────────

function tickFieldAI(state: GameState, p: Player): void {
  const { ball } = state
  const myGoalX = p.team === 'home' ? FIELD.GK_HOME_X : FIELD.GK_AWAY_X
  const oppGoalX = p.team === 'home' ? FIELD.W : 0

  let tx: number, ty: number

  if (p.role === 'fwd') {
    // Chase ball aggressively
    tx = ball.pos.x; ty = ball.pos.y
  } else {
    // DEF: track ball but stay in own half
    tx = clamp(ball.pos.x, myGoalX + 8, FIELD.CENTER_X + (p.team === 'home' ? -5 : 5))
    ty = clamp(ball.pos.y, 8, 52)
  }

  const dx = tx - p.pos.x, dy = ty - p.pos.y
  const d = Math.sqrt(dx * dx + dy * dy)
  if (d > 1) {
    const speed = PLAYER_SPEED * 0.88
    const nx = dx / d, ny = dy / d
    p.vel.x += (nx * speed - p.vel.x) * PLAYER_ACCEL
    p.vel.y += (ny * speed - p.vel.y) * PLAYER_ACCEL
    p.pos.x += p.vel.x * DT; p.pos.y += p.vel.y * DT
    p.facing = { x: nx, y: ny }
    clampToField(p)
  }

  // Kick if near ball and AI has dribble
  if (p.id === state.ball.ownerId) {
    const dir = norm2d({ x: oppGoalX - p.pos.x, y: FIELD.CENTER_Y - p.pos.y })
    const spread = (Math.random() - 0.5) * 0.6
    const angle = Math.atan2(dir.y, dir.x) + spread
    const spd = FIELD.KICK_MIN_SPEED + Math.random() * (FIELD.KICK_MAX_SPEED - FIELD.KICK_MIN_SPEED) * 0.6
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
    // Rush toward ball
    const dir = norm2d({ x: ball.pos.x - gk.pos.x, y: ball.pos.y - gk.pos.y })
    gk.vel.x += (dir.x * GK_SPEED - gk.vel.x) * 0.3
    gk.vel.y += (dir.y * GK_SPEED - gk.vel.y) * 0.3
    gk.pos.x += gk.vel.x * DT; gk.pos.y += gk.vel.y * DT
    gk.facing = dir
    clampToField(gk)

    if (d < FIELD.PLAYER_RADIUS * 2) {
      // Kick ball toward opponent half
      const spread = (Math.random() - 0.5) * 0.7
      const angle = Math.atan2(FIELD.CENTER_Y - gk.pos.y, oppGoalX - gk.pos.x) + spread
      const spd = 22 + Math.random() * 10
      state.ball.vel = { x: Math.cos(angle) * spd, y: Math.sin(angle) * spd }
      state.ball.ownerId = null
    }
  } else {
    // Track ball laterally along goal line
    const ty = clamp(ball.pos.y, FIELD.CENTER_Y - FIELD.GOAL_WIDTH / 2 - 1, FIELD.CENTER_Y + FIELD.GOAL_WIDTH / 2 + 1)
    const dy = ty - gk.pos.y
    if (Math.abs(dy) > 0.3) {
      const sign = Math.sign(dy)
      gk.vel.x = 0; gk.vel.y = sign * GK_SPEED * 0.7
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
  const players: Player[] = []
  const make = (id: string, team: 'home' | 'away', role: 'gk' | 'fwd' | 'def', pos: Vec2, controlled: boolean): Player => ({
    id, team, role, pos, vel: { x: 0, y: 0 },
    facing: { x: team === 'home' ? 1 : -1, y: 0 },
    isControlled: controlled, stunTimer: 0,
  })

  // Home: GK + 2 FWD + 1 DEF
  players.push(make('home-gk',  'home', 'gk',  { x: FIELD.GK_HOME_X, y: FIELD.CENTER_Y }, false))
  players.push(make('home-fwd1','home', 'fwd', { x: 38, y: 22 }, true))
  players.push(make('home-fwd2','home', 'fwd', { x: 38, y: 38 }, false))
  players.push(make('home-def', 'home', 'def', { x: 20, y: FIELD.CENTER_Y }, false))

  // Away: GK + 2 FWD + 1 DEF
  players.push(make('away-gk',  'away', 'gk',  { x: FIELD.GK_AWAY_X, y: FIELD.CENTER_Y }, false))
  players.push(make('away-fwd1','away', 'fwd', { x: 62, y: 22 }, true))
  players.push(make('away-fwd2','away', 'fwd', { x: 62, y: 38 }, false))
  players.push(make('away-def', 'away', 'def', { x: 80, y: FIELD.CENTER_Y }, false))

  return players
}

function getInitialPos(id: string, team: 'home' | 'away', role: 'gk' | 'fwd' | 'def'): Vec2 {
  const map: Record<string, Vec2> = {
    'home-gk':   { x: FIELD.GK_HOME_X, y: FIELD.CENTER_Y },
    'home-fwd1': { x: 38, y: 22 },
    'home-fwd2': { x: 38, y: 38 },
    'home-def':  { x: 20, y: FIELD.CENTER_Y },
    'away-gk':   { x: FIELD.GK_AWAY_X, y: FIELD.CENTER_Y },
    'away-fwd1': { x: 62, y: 22 },
    'away-fwd2': { x: 62, y: 38 },
    'away-def':  { x: 80, y: FIELD.CENTER_Y },
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
```

- [ ] **Step 2: Verify TypeScript compiles with no errors**

```bash
cd /path/to/soccer-game && npx tsc --noEmit 2>&1
```

Expected: errors only in client files (input.ts, renderer.ts, etc.) — not in server.ts or types.ts.

- [ ] **Step 3: Commit**

```bash
git add party/server.ts
git commit -m "refactor: rewrite server as chaos-soccer (350 lines, no setpieces)"
```

---

## Task 3: Rewrite `src/game/input.ts`

**Files:**
- Modify: `src/game/input.ts`

Single kick button (Space / mobile tap). Direction = WASD/arrows/joystick. kickPower is computed from hold duration and sent on release.

- [ ] **Step 1: Replace the entire file**

```typescript
import nipplejs from 'nipplejs'
import type { PlayerInput } from '../types'
import { sendInput } from '../main'

let joyDx = 0, joyDy = 0
let kickStart: number | null = null
let pendingKickPower: number | null = null
const keysDown = new Set<string>()
let inputLoopId: ReturnType<typeof setInterval> | null = null
let joystickManager: ReturnType<typeof nipplejs.create> | null = null
let mobileContainer: HTMLElement | null = null

export function initInput(): void {
  if (inputLoopId !== null) return
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  if (isMobile()) setupMobileControls()
  inputLoopId = setInterval(flushInput, 50)
}

export function destroyInput(): void {
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
  keysDown.clear()
  if (inputLoopId !== null) { clearInterval(inputLoopId); inputLoopId = null }
  if (joystickManager) { joystickManager.destroy(); joystickManager = null }
  if (mobileContainer) { mobileContainer.remove(); mobileContainer = null }
  joyDx = 0; joyDy = 0
  kickStart = null; pendingKickPower = null
}

function isMobile(): boolean {
  return window.innerWidth < 768 || 'ontouchstart' in window
}

function onKeyDown(e: KeyboardEvent): void {
  const k = e.key.toLowerCase()
  keysDown.add(k)
  if (['arrowup','arrowdown','arrowleft','arrowright',' '].includes(k)) e.preventDefault()
  if (k === ' ' && kickStart === null) kickStart = Date.now()
}

function onKeyUp(e: KeyboardEvent): void {
  const k = e.key.toLowerCase()
  keysDown.delete(k)
  if (k === ' ' && kickStart !== null) {
    pendingKickPower = Math.min((Date.now() - kickStart) / 1200, 1)
    kickStart = null
  }
}

function getDxDy(): { dx: number; dy: number } {
  if (joyDx !== 0 || joyDy !== 0) return { dx: joyDx, dy: joyDy }
  let dx = 0, dy = 0
  if (keysDown.has('arrowleft') || keysDown.has('a')) dx -= 1
  if (keysDown.has('arrowright') || keysDown.has('d')) dx += 1
  if (keysDown.has('arrowup') || keysDown.has('w')) dy += 1
  if (keysDown.has('arrowdown') || keysDown.has('s')) dy -= 1
  if (dx !== 0 && dy !== 0) {
    const len = Math.sqrt(dx * dx + dy * dy); dx /= len; dy /= len
  }
  return { dx: Math.round(dx * 100) / 100, dy: Math.round(dy * 100) / 100 }
}

function flushInput(): void {
  const { dx, dy } = getDxDy()
  let kickPower = 0
  if (pendingKickPower !== null) {
    kickPower = pendingKickPower
    pendingKickPower = null
  }
  sendInput({ dx, dy, kickPower })
}

function setupMobileControls(): void {
  mobileContainer = document.createElement('div')
  mobileContainer.id = 'mobile-controls'
  mobileContainer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:50;user-select:none;-webkit-user-select:none;'
  document.body.appendChild(mobileContainer)

  const joyZone = document.createElement('div')
  joyZone.style.cssText = 'position:absolute;left:0;bottom:0;width:160px;height:160px;pointer-events:all;'
  mobileContainer.appendChild(joyZone)

  joystickManager = nipplejs.create({
    zone: joyZone, mode: 'static',
    position: { left: '80px', bottom: '80px' },
    color: 'rgba(255,255,255,0.3)', size: 100,
  })
  joystickManager.on('move', (_evt, data) => {
    const v = data?.vector
    if (v) { joyDx = v.x; joyDy = v.y }
  })
  joystickManager.on('end', () => { joyDx = 0; joyDy = 0 })

  // Single kick button — right side, big
  const kickBtn = document.createElement('button')
  kickBtn.textContent = '⚽'
  kickBtn.style.cssText = `
    position:absolute;right:24px;bottom:24px;
    width:88px;height:88px;border-radius:50%;
    border:3px solid rgba(255,255,255,0.5);
    background:rgba(255,140,0,0.7);color:#fff;font-size:36px;
    pointer-events:all;touch-action:none;
  `
  kickBtn.addEventListener('touchstart', () => { kickStart = Date.now() }, { passive: true })
  kickBtn.addEventListener('touchend', () => {
    if (kickStart !== null) {
      pendingKickPower = Math.min((Date.now() - kickStart) / 1200, 1)
      kickStart = null
    }
  }, { passive: true })
  mobileContainer.appendChild(kickBtn)
}
```

- [ ] **Step 2: Verify TypeScript in this file**

```bash
cd /path/to/soccer-game && npx tsc --noEmit 2>&1 | grep "input.ts"
```

Expected: no errors for input.ts.

- [ ] **Step 3: Commit**

```bash
git add src/game/input.ts
git commit -m "refactor: simplify input to move + single kick button"
```

---

## Task 4: Rewrite `src/screens/lobby.ts`

**Files:**
- Modify: `src/screens/lobby.ts`

Remove jersey number and formation UI. Just color picker + ready button.

- [ ] **Step 1: Replace the entire file**

```typescript
import type { GameState, TeamColor } from '../types'
import { sendLobby } from '../main'

let _color: TeamColor | null = null

export function resetLobbyLocalState(): void {
  _color = null
}

export function mountLobby(el: HTMLElement, state?: GameState): void {
  const myTeam = (window as any).__myTeam as 'home' | 'away' | null ?? null
  const lobby = state?.lobby
  const mySlot = myTeam && lobby ? lobby[myTeam] : null
  const oppTeam = myTeam === 'home' ? 'away' : 'home'
  const oppSlot = myTeam && lobby ? lobby[oppTeam] : null

  const colors: TeamColor[] = ['blue', 'red', 'green', 'yellow']
  const colorHex: Record<TeamColor, string> = {
    blue: '#3b82f6', red: '#ef4444', green: '#16a34a', yellow: '#eab308',
  }

  if (!_color && mySlot?.color) _color = mySlot.color

  const phase = state?.phase ?? 'lobby'
  const countdown = state?.countdown

  el.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;gap:24px;padding:32px;max-width:380px;margin:auto">
      <h1 style="font-size:28px;font-weight:900;letter-spacing:3px;color:#fff;margin:0">⚽ CHAOS SOCCER</h1>

      ${phase === 'countdown' ? `
        <div style="font-size:80px;font-weight:900;color:#ffd700;text-shadow:0 0 30px #ff8800">${countdown}</div>
      ` : ''}

      ${phase === 'lobby' && myTeam ? `
        <div style="background:rgba(255,255,255,0.08);border-radius:12px;padding:20px;width:100%;box-sizing:border-box">
          <p style="margin:0 0 12px;font-size:13px;color:#aaa;text-align:center">팀 색상 선택</p>
          <div style="display:flex;gap:10px;justify-content:center" id="color-btns">
            ${colors.map(c => `
              <button data-color="${c}" style="
                width:48px;height:48px;border-radius:50%;background:${colorHex[c]};
                border:${_color === c ? '3px solid #fff' : '3px solid transparent'};
                cursor:pointer;transition:border 0.1s;
              "></button>
            `).join('')}
          </div>
        </div>

        <div style="width:100%;display:flex;align-items:center;justify-content:space-between">
          <div style="font-size:13px;color:${oppSlot?.ready ? '#4ade80' : '#888'}">
            상대방: ${oppSlot?.ready ? '✅ 준비됨' : '⏳ 대기중'}
          </div>
          <button id="ready-btn" style="
            padding:12px 28px;border-radius:8px;font-size:16px;font-weight:bold;cursor:pointer;
            background:${mySlot?.ready ? '#4ade80' : '#3b82f6'};color:#fff;border:none;
          ">${mySlot?.ready ? '취소' : '준비!'}</button>
        </div>
      ` : ''}

      ${!myTeam && phase === 'lobby' ? `
        <p style="color:#888;font-size:14px">대기 중... (방이 가득 찼습니다)</p>
      ` : ''}

      ${!lobby && phase === 'lobby' ? `
        <p style="color:#666;font-size:14px">상대 플레이어 기다리는 중...</p>
      ` : ''}
    </div>
  `

  el.querySelectorAll('[data-color]').forEach(btn => {
    btn.addEventListener('click', () => {
      _color = (btn as HTMLElement).dataset.color as TeamColor
      sendLobby({ color: _color })
      mountLobby(el, state)
    })
  })

  el.querySelector('#ready-btn')?.addEventListener('click', () => {
    if (!_color) return
    const isReady = !(mySlot?.ready ?? false)
    sendLobby({ color: _color, ready: isReady })
  })
}
```

- [ ] **Step 2: Update `src/main.ts` — add `sendLobby` that matches new ClientMsg signature**

In `src/main.ts`, find:
```typescript
export function sendLobby(payload: { color?: TeamColor; jerseyNumbers?: ...; formation?: ...; ready?: boolean }) {
```

Replace with:
```typescript
export function sendLobby(payload: { color?: TeamColor; ready?: boolean }) {
  if (!socket) return
  const msg: ClientMsg = { type: 'lobby', ...payload }
  socket.send(JSON.stringify(msg))
}
```

Also in `onStateUpdate` in `main.ts`, remove any phase references to `'kickoff'`, `'freekick'`, `'penalty'`, `'corner'`, `'throwin'`, `'goalkick'`. The playing phases block becomes:

```typescript
} else if (state.phase === 'playing') {
  screenEl.classList.add('hidden')
  if (!gameActive) {
    startGame(state)
    if (myTeam) initHUD(myTeam)
    initInput()
    gameActive = true
  }
}
```

Remove the `showKickoffOverlay()` call and the `prevPhase` kickoff check. Keep goal ceremony and halftime.

Also: remove the `setResultRoomId` import if result screen no longer needs it (check usage).

Also: store myTeam on window for lobby.ts: in the `assigned` message handler add `(window as any).__myTeam = msg.team`.

- [ ] **Step 3: Check types compile**

```bash
cd /path/to/soccer-game && npx tsc --noEmit 2>&1 | grep -E "(lobby|main)\.ts"
```

- [ ] **Step 4: Commit**

```bash
git add src/screens/lobby.ts src/main.ts
git commit -m "refactor: simplify lobby (color + ready only) and main.ts phase handling"
```

---

## Task 5: Update `src/game/renderer.ts`

**Files:**
- Modify: `src/game/renderer.ts`

Adapt to new types (Ball is Vec2 not Vec3, Player has `vel` not `hasBall`/`animState`). Remove indicator mesh. Add stumble tilt (rotate player group when stunTimer > 0). Remove `setRendererTeam` export (no longer needed for indicator logic, but keep for score color if used).

- [ ] **Step 1: Update `syncBall` — ball.pos is now Vec2**

Find:
```typescript
function syncBall(state: GameState): void {
  if (!ballMesh) return
  const [wx, wy] = gameToWorld(state.ball.pos.x, state.ball.pos.y)
  // Ball z: game z maps to world z (ball can be airborne)
  ballMesh.position.set(wx, wy, state.ball.pos.z * 0.7 + 0.5)
}
```

Replace with:
```typescript
function syncBall(state: GameState): void {
  if (!ballMesh) return
  const [wx, wy] = gameToWorld(state.ball.pos.x, state.ball.pos.y)
  ballMesh.position.set(wx, wy, 0.7)  // fixed height, no z-axis
}
```

- [ ] **Step 2: Remove `buildIndicator` and `indicatorMesh`**

Remove: the `let indicatorMesh` variable, `buildIndicator()` call in `startGame`, the indicatorMesh cleanup in `stopGame`, and the entire indicator section in `syncPlayers`.

- [ ] **Step 3: Update `syncPlayers` for new Player type**

The `syncPlayers` function currently uses `player.hasBall` and `player.animState` — remove those references. Add stumble tilt:

```typescript
// After setting mesh.position:
// Stumble tilt: rotate mesh if player.stunTimer > 0
const stuntFraction = Math.min(player.stunTimer / FIELD.STUN_DURATION, 1)
mesh.rotation.x = stuntFraction * 0.7   // tilt forward
mesh.rotation.y = stuntFraction * (Math.sin(Date.now() * 0.015) * 0.5)  // wobble
```

(Import FIELD from types: `import { FIELD } from '../types'` — already imported.)

- [ ] **Step 4: Remove the `rendererMyTeam` indicator logic from `syncPlayers`**

The block starting with `// Indicator above controlled player` can be fully deleted (we removed indicatorMesh).

Instead, add a simple white ring highlight under the controlled player:
```typescript
// Controlled player highlight: slightly brighter emissive
// (skip complex indicator — just tint the mesh)
```

Actually: just skip any highlight for now. The simplicity is the point.

- [ ] **Step 5: Verify no TypeScript errors in renderer.ts**

```bash
cd /path/to/soccer-game && npx tsc --noEmit 2>&1 | grep "renderer.ts"
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/game/renderer.ts
git commit -m "refactor: update renderer for new types, remove indicator, add stumble tilt"
```

---

## Task 6: Simplify `src/game/ui.ts`

**Files:**
- Modify: `src/game/ui.ts`

Remove complex key hints. Add a single small "[Space] 킥" hint bottom-left. Keep score/timer/minimap/confetti.

- [ ] **Step 1: Replace `drawKeyHints` function**

Find the entire `drawKeyHints` function and replace with:

```typescript
function drawKeyHints() {
  if (!ctx || !canvas) return
  ctx.save()
  ctx.fillStyle = 'rgba(0,0,0,0.55)'
  ctx.fillRect(10, canvas.height - 34, 120, 26)
  ctx.font = 'bold 11px monospace'
  ctx.fillStyle = '#ffd700'
  ctx.textAlign = 'left'
  ctx.fillText('[Space] 킥 (꾹 = 강슛)', 18, canvas.height - 17)
  ctx.restore()
}
```

- [ ] **Step 2: Update `drawScoreTimer` to use simpler styling (optional cosmetic)**

No functional changes needed — it already works with the new GameState structure.

- [ ] **Step 3: Verify no TypeScript errors in ui.ts**

```bash
cd /path/to/soccer-game && npx tsc --noEmit 2>&1 | grep "ui.ts"
```

- [ ] **Step 4: Commit**

```bash
git add src/game/ui.ts
git commit -m "refactor: simplify ui key hints to single kick hint"
```

---

## Task 7: Full compile check + build + deploy

- [ ] **Step 1: Full TypeScript check**

```bash
cd /path/to/soccer-game && npx tsc --noEmit 2>&1
```

Expected: 0 errors. Fix any remaining type mismatches (common: `Ball.pos.z` refs, old `PlayerInput` action fields, old LobbyState fields).

- [ ] **Step 2: Build**

```bash
cd /path/to/soccer-game && npm run build 2>&1
```

Expected: `✓ built` with no errors.

- [ ] **Step 3: Deploy server**

```bash
cd /path/to/soccer-game && npx partykit deploy 2>&1
```

Expected: `Deployed ./party/server.ts to https://soccer-game.buoshllim.partykit.dev`

- [ ] **Step 4: Final commit + push**

```bash
git add -A
git commit -m "feat: chaos-soccer rewrite complete — bouncy 4v4, one kick button"
git push origin main
```

---

## Self-Review Checklist

**Spec coverage:**
- ✅ 4v4 (GK + 2 FWD + 1 DEF per team) — Task 2 `buildPlayers`
- ✅ Auto GK AI, never player-controlled — Task 2 `tickGKAI`, `isControlled` never set for GK
- ✅ Slow ball → dribble attach — Task 2 step 6
- ✅ Dribble owner can kick (button hold = power) — Task 2 step 1, Task 3
- ✅ Fast ball → chaotic deflection off players — Task 2 step 7
- ✅ Player-player collision → push + stun — Task 2 `resolvePlayerCollision`
- ✅ One kick button only (Space / mobile ⚽) — Task 3
- ✅ Lobby: color + ready only — Task 4
- ✅ 3-minute halves — Task 2 `startGame` (`timeLeft = 3 * 60`)
- ✅ Ball bounces off all walls — Task 2 `bounceBall`
- ✅ No offside, no setpieces — not present in new server.ts
- ✅ Auto-switch to dribbler — Task 2 step 6

**Type consistency check:**
- `Ball.pos` is `Vec2` throughout (no `.z` references in new code) ✅
- `PlayerInput` uses `kickPower: number` (no action/sprint/switchPlayer) ✅
- `LobbyState` uses `color + ready` only (no jerseyNumbers/formation) ✅
- `Player` has `stunTimer: number` and `vel: Vec2` (no hasBall/stamina/animState) ✅

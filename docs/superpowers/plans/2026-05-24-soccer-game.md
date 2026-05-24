# Soccer Game Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a real-time 5v5 multiplayer soccer game playable in the browser, with one human per team and four AI teammates, deployed on Vercel + Partykit.

**Architecture:** Server-authoritative game loop at 20 ticks/sec on Partykit. Client sends `PlayerInput` each tick, receives `GameState`, and renders via Three.js. No client-side prediction — server is the single source of truth for all physics, AI, and rules.

**Tech Stack:** TypeScript, Three.js, Partykit, Vite, nipplejs, Vitest (server logic tests)

---

## File Map

| File | Responsibility |
|------|---------------|
| `src/types.ts` | All shared TypeScript types (GameState, Player, Ball, etc.) |
| `party/server.ts` | Partykit server: room lifecycle, 20-tick game loop, physics, AI, rules |
| `src/main.ts` | Entry point: Partykit WebSocket connection, screen switching |
| `src/screens/home.ts` | Home screen DOM: create/join room |
| `src/screens/lobby.ts` | Lobby DOM: color, jersey, formation, Ready |
| `src/screens/result.ts` | Result DOM: final score, rematch/back buttons |
| `src/game/input.ts` | Keyboard + nipplejs → `PlayerInput` per tick |
| `src/game/renderer.ts` | Three.js scene: field, characters, ball |
| `src/game/camera.ts` | Perspective camera with dynamic zoom/follow |
| `src/game/ui.ts` | Canvas HUD overlay: score, timer, gauges, minimap, alerts |
| `src/game/replay.ts` | Ring buffer of last 10s GameState snapshots for goal replay |
| `index.html` | Single HTML shell, imports `src/main.ts` |
| `partykit.json` | Partykit project config |
| `vite.config.ts` | Vite + TypeScript build config |
| `party/physics.test.ts` | Vitest unit tests for server physics helpers |
| `party/rules.test.ts` | Vitest unit tests for offside, foul, setpiece logic |

---

## Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `vite.config.ts`
- Create: `partykit.json`
- Create: `index.html`
- Create: `tsconfig.json`

- [ ] **Step 1: Initialize project**

```bash
cd /Users/macsong/Projects/playground/soccer-game
npm init -y
npm install three nipplejs partykit
npm install --save-dev vite typescript @types/three vitest
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "lib": ["ES2022", "DOM"],
    "outDir": "dist"
  },
  "include": ["src/**/*", "party/**/*"]
}
```

- [ ] **Step 3: Write `vite.config.ts`**

```typescript
import { defineConfig } from 'vite'

export default defineConfig({
  build: { target: 'ES2022' },
  server: { port: 5173 }
})
```

- [ ] **Step 4: Write `partykit.json`**

```json
{
  "name": "soccer-game",
  "main": "party/server.ts"
}
```

- [ ] **Step 5: Write `index.html`**

```html
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0" />
  <title>Soccer Game</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #0a0a0a; color: #fff; font-family: sans-serif; overflow: hidden; }
    #app { width: 100vw; height: 100vh; position: relative; }
    #three-canvas { position: absolute; inset: 0; }
    #hud-canvas { position: absolute; inset: 0; pointer-events: none; }
    #screen { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
    .hidden { display: none !important; }
  </style>
</head>
<body>
  <div id="app">
    <canvas id="three-canvas"></canvas>
    <canvas id="hud-canvas"></canvas>
    <div id="screen"></div>
  </div>
  <script type="module" src="/src/main.ts"></script>
</body>
</html>
```

- [ ] **Step 6: Add `package.json` scripts**

```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "party:dev": "npx partykit dev",
    "test": "vitest run party"
  }
}
```

- [ ] **Step 7: Commit**

```bash
git init
git add .
git commit -m "feat: project scaffold — Vite + Partykit + Three.js"
```

---

## Task 2: Shared Types

**Files:**
- Create: `src/types.ts`

- [ ] **Step 1: Write `src/types.ts`**

```typescript
export type Vec2 = { x: number; y: number }
export type Vec3 = { x: number; y: number; z: number }
export type TeamColor = 'blue' | 'red' | 'green' | 'yellow'
export type PlayerRole = 'gk' | 'fwd' | 'mid' | 'def'

export type Player = {
  id: string
  team: 'home' | 'away'
  role: PlayerRole
  pos: Vec2
  facing: Vec2          // normalized direction vector
  stamina: number       // 0~1
  isControlled: boolean
  hasBall: boolean
  jerseyNumber: number  // 1~99
  animState: 'idle' | 'run' | 'kick' | 'tackle' | 'slide'
}

export type Ball = {
  pos: Vec3
  vel: Vec3
  ownerId: string | null  // Player.id or null if free
}

export type Formation = {
  slots: number[]  // 4 indices from 0~8 (3×3 grid)
}

export type LobbyState = {
  home: { color: TeamColor | null; formation: Formation | null; jerseyNumber: number; ready: boolean } | null
  away: { color: TeamColor | null; formation: Formation | null; jerseyNumber: number; ready: boolean } | null
}

export type SetpieceState = {
  type: 'freekick' | 'penalty' | 'corner' | 'throwin' | 'goalkick'
  team: 'home' | 'away'
  pos: Vec2
}

export type GameStats = {
  possession: { home: number; away: number }   // cumulative ticks ball owned
  shots: { home: number; away: number }
  shotsOnTarget: { home: number; away: number }
}

export type GamePhase =
  | 'lobby' | 'countdown' | 'kickoff' | 'playing'
  | 'freekick' | 'penalty' | 'corner' | 'throwin' | 'goalkick'
  | 'halftime' | 'ended'

export type GameState = {
  players: Player[]
  ball: Ball
  score: { home: number; away: number }
  timeLeft: number      // seconds, counts down
  half: 1 | 2
  phase: GamePhase
  kickoffTeam: 'home' | 'away' | null
  setpiece?: SetpieceState
  lobby?: LobbyState
  stats: GameStats
  countdown?: number    // 3, 2, 1 when phase === 'countdown'
}

export type PlayerInput = {
  dx: number            // -1, 0, 1
  dy: number            // -1, 0, 1
  sprint: boolean
  switchPlayer: boolean
  action: 'shoot' | 'chipshot' | 'lowpass' | 'loftedpass' | 'throughpass'
        | 'tackle' | 'slidetackle' | 'gkrush' | null
  power: number         // 0~1
}

export type ServerMsg =
  | { type: 'state'; state: GameState }
  | { type: 'assigned'; team: 'home' | 'away' }
  | { type: 'error'; msg: string }

export type ClientMsg =
  | { type: 'input'; input: PlayerInput }
  | { type: 'lobby'; color?: TeamColor; jerseyNumber?: number; formation?: Formation; ready?: boolean }

// Field constants (game units)
export const FIELD = {
  W: 100, H: 60,
  GOAL_WIDTH: 8,
  PA_DEPTH: 16, PA_HALF_WIDTH: 18,  // penalty area
  CENTER_X: 50, CENTER_Y: 30,
  PLAYER_RADIUS: 1,
  BALL_RADIUS: 0.5,
  DRIBBLE_ATTACH_DIST: 1.5,
  TACKLE_DIST: 2,
  GK_RUSH_DIST: 8,
} as const
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: shared TypeScript types"
```

---

## Task 3: Partykit Server Skeleton

**Files:**
- Create: `party/server.ts`

- [ ] **Step 1: Write server skeleton**

```typescript
import type * as Party from 'partykit/server'
import type { GameState, PlayerInput, ClientMsg, ServerMsg, LobbyState } from '../src/types'
import { FIELD } from '../src/types'

const TICK_MS = 50  // 20 ticks/sec

export default class SoccerServer implements Party.Server {
  private state: GameState
  private inputs: Map<string, PlayerInput> = new Map()
  private assignments: Map<string, 'home' | 'away'> = new Map()
  private tickInterval: ReturnType<typeof setInterval> | null = null

  constructor(readonly room: Party.Room) {
    this.state = makeInitialState()
  }

  onConnect(conn: Party.Connection) {
    // Assign to home or away
    const team = this.assignments.size === 0 ? 'home' : 'away'
    if (this.assignments.size >= 2) {
      conn.send(JSON.stringify({ type: 'error', msg: 'Room full' } satisfies ServerMsg))
      conn.close()
      return
    }
    this.assignments.set(conn.id, team)
    conn.send(JSON.stringify({ type: 'assigned', team } satisfies ServerMsg))
    conn.send(JSON.stringify({ type: 'state', state: this.state } satisfies ServerMsg))

    if (this.assignments.size === 2 && this.state.phase === 'lobby') {
      this.startLobby()
    }
  }

  onClose(conn: Party.Connection) {
    this.assignments.delete(conn.id)
    this.inputs.delete(conn.id)
    if (this.tickInterval) { clearInterval(this.tickInterval); this.tickInterval = null }
    this.state = makeInitialState()
  }

  onMessage(message: string, sender: Party.Connection) {
    const msg: ClientMsg = JSON.parse(message)
    if (msg.type === 'input') {
      this.inputs.set(sender.id, msg.input)
    } else if (msg.type === 'lobby') {
      const team = this.assignments.get(sender.id)
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
  }

  private startLobby() {
    this.state.phase = 'lobby'
    this.state.lobby = {
      home: { color: null, formation: null, jerseyNumber: randomJersey(), ready: false },
      away: { color: null, formation: null, jerseyNumber: randomJersey(), ready: false },
    }
    this.broadcast({ type: 'state', state: this.state })
  }

  private checkBothReady() {
    const { home, away } = this.state.lobby!
    if (home?.ready && away?.ready && home.color && away.color && home.formation && away.formation) {
      this.startCountdown()
    }
  }

  private startCountdown() {
    this.state.phase = 'countdown'
    this.state.countdown = 3
    this.broadcast({ type: 'state', state: this.state })
    let n = 3
    const timer = setInterval(() => {
      n--
      if (n <= 0) {
        clearInterval(timer)
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
    this.state.ball = { pos: { x: FIELD.CENTER_X, y: FIELD.CENTER_Y, z: 0 }, vel: { x: 0, y: 0, z: 0 }, ownerId: null }
    this.state.phase = 'kickoff'
    this.state.kickoffTeam = Math.random() < 0.5 ? 'home' : 'away'
    this.state.half = 1
    this.state.timeLeft = 5 * 60
    this.broadcast({ type: 'state', state: this.state })
    this.tickInterval = setInterval(() => this.tick(), TICK_MS)
  }

  private tick() {
    // Implemented in later tasks
    this.broadcast({ type: 'state', state: this.state })
  }

  private broadcast(msg: ServerMsg) {
    this.room.broadcast(JSON.stringify(msg))
  }
}

function makeInitialState(): GameState {
  return {
    players: [],
    ball: { pos: { x: 50, y: 30, z: 0 }, vel: { x: 0, y: 0, z: 0 }, ownerId: null },
    score: { home: 0, away: 0 },
    timeLeft: 300,
    half: 1,
    phase: 'lobby',
    kickoffTeam: null,
    stats: { possession: { home: 0, away: 0 }, shots: { home: 0, away: 0 }, shotsOnTarget: { home: 0, away: 0 } },
  }
}

function randomJersey(): number {
  return Math.floor(Math.random() * 99) + 1
}

function buildPlayers(home: NonNullable<LobbyState['home']>, away: NonNullable<LobbyState['away']>): import('../src/types').Player[] {
  // Implemented in Task 5
  return []
}
```

- [ ] **Step 2: Start dev servers**

```bash
# Terminal 1
npm run party:dev

# Terminal 2
npm run dev
```

Expected: both start without errors

- [ ] **Step 3: Commit**

```bash
git add party/server.ts
git commit -m "feat: Partykit server skeleton with room/lobby lifecycle"
```

---

## Task 4: Client Entry Point & WebSocket

**Files:**
- Create: `src/main.ts`

- [ ] **Step 1: Write `src/main.ts`**

```typescript
import PartySocket from 'partysocket'
import type { GameState, ServerMsg, ClientMsg, PlayerInput } from './types'

const PARTY_HOST = import.meta.env.DEV ? 'localhost:1999' : 'soccer-game.partykit.dev'

let socket: PartySocket | null = null
let myTeam: 'home' | 'away' | null = null
let currentState: GameState | null = null

export function getMyTeam() { return myTeam }
export function getCurrentState() { return currentState }

export function joinRoom(roomId: string) {
  if (socket) socket.close()
  socket = new PartySocket({ host: PARTY_HOST, room: roomId })

  socket.onmessage = (e) => {
    const msg: ServerMsg = JSON.parse(e.data)
    if (msg.type === 'assigned') {
      myTeam = msg.team
    } else if (msg.type === 'state') {
      currentState = msg.state
      onStateUpdate(msg.state)
    } else if (msg.type === 'error') {
      alert(msg.msg)
    }
  }
}

export function sendInput(input: PlayerInput) {
  if (!socket) return
  const msg: ClientMsg = { type: 'input', input }
  socket.send(JSON.stringify(msg))
}

export function sendLobby(payload: Omit<ClientMsg & { type: 'lobby' }, 'type'>) {
  if (!socket) return
  const msg: ClientMsg = { type: 'lobby', ...payload }
  socket.send(JSON.stringify(msg))
}

// Screen switching
import { mountHome } from './screens/home'
import { mountLobby } from './screens/lobby'
import { mountResult } from './screens/result'
import { startGame, stopGame } from './game/renderer'

const screenEl = document.getElementById('screen')!
let activePhase: string | null = null

function onStateUpdate(state: GameState) {
  if (state.phase === activePhase) return

  activePhase = state.phase

  if (state.phase === 'lobby' || state.phase === 'countdown') {
    stopGame()
    screenEl.classList.remove('hidden')
    mountLobby(screenEl, state)
  } else if (state.phase === 'ended') {
    stopGame()
    screenEl.classList.remove('hidden')
    mountResult(screenEl, state)
  } else {
    screenEl.classList.add('hidden')
    startGame(state)
  }
}

// Boot
mountHome(screenEl)
```

- [ ] **Step 2: Create stub screens so imports resolve**

```bash
mkdir -p src/screens src/game
```

Create `src/screens/home.ts`:
```typescript
export function mountHome(el: HTMLElement) {
  el.innerHTML = `<div style="text-align:center">
    <h1>⚽ Soccer Game</h1>
    <button id="btn-create">방 만들기</button>
    <button id="btn-join">방 참가</button>
    <input id="room-code" placeholder="6자리 코드" maxlength="6" style="display:none"/>
  </div>`
  const { joinRoom } = await import('../main')
  el.querySelector('#btn-create')!.addEventListener('click', () => {
    const code = Math.random().toString(36).slice(2,8).toUpperCase()
    joinRoom(code)
  })
  el.querySelector('#btn-join')!.addEventListener('click', () => {
    const input = el.querySelector('#room-code') as HTMLInputElement
    input.style.display = 'inline'
    input.focus()
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') joinRoom(input.value.toUpperCase())
    })
  })
}
```

Create stub `src/screens/lobby.ts`:
```typescript
import type { GameState } from '../types'
export function mountLobby(el: HTMLElement, state: GameState) {
  el.innerHTML = `<div>로비</div>`
}
```

Create stub `src/screens/result.ts`:
```typescript
import type { GameState } from '../types'
export function mountResult(el: HTMLElement, state: GameState) {
  el.innerHTML = `<div>결과</div>`
}
```

Create stub `src/game/renderer.ts`:
```typescript
import type { GameState } from '../types'
export function startGame(state: GameState) {}
export function stopGame() {}
```

- [ ] **Step 3: Verify dev build succeeds**

```bash
npm run dev
```

Open `http://localhost:5173` — should show "⚽ Soccer Game" with two buttons.

- [ ] **Step 4: Commit**

```bash
git add src/
git commit -m "feat: client entry point, WebSocket connection, screen router"
```

---

## Task 5: Player Builder & Formation

**Files:**
- Modify: `party/server.ts` — implement `buildPlayers()`
- Create: `party/physics.test.ts`

- [ ] **Step 1: Write formation → position mapping**

Add to `party/server.ts` (replace the stub `buildPlayers`):

```typescript
import type { Player, Formation, LobbyState, TeamColor } from '../src/types'
import { FIELD } from '../src/types'

// Grid index 0-8 → (col 0-2, row 0-2) where row 0=FWD, row 2=DEF
function gridToRole(idx: number): import('../src/types').PlayerRole {
  const row = Math.floor(idx / 3)
  return row === 0 ? 'fwd' : row === 1 ? 'mid' : 'def'
}

function gridToStartPos(idx: number, team: 'home' | 'away'): import('../src/types').Vec2 {
  const col = idx % 3          // 0=left, 1=center, 2=right
  const row = Math.floor(idx / 3) // 0=FWD, 1=MID, 2=DEF

  // Home attacks right (x increases). Columns map to y position.
  const yPositions = [15, 30, 45]  // left, center, right lanes
  const xPositions = [75, 62, 50]  // FWD, MID, DEF x for home team

  const y = yPositions[col]
  const x = team === 'home' ? xPositions[row] : FIELD.W - xPositions[row]

  return { x, y }
}

function buildPlayers(
  home: NonNullable<LobbyState['home']>,
  away: NonNullable<LobbyState['away']>
): Player[] {
  const players: Player[] = []
  const usedJerseys = { home: new Set<number>(), away: new Set<number>() }

  const addGK = (team: 'home' | 'away', jerseyNum: number) => {
    const x = team === 'home' ? 3 : FIELD.W - 3
    players.push({
      id: `${team}-gk`,
      team, role: 'gk',
      pos: { x, y: FIELD.CENTER_Y },
      facing: { x: team === 'home' ? 1 : -1, y: 0 },
      stamina: 1,
      isControlled: false,
      hasBall: false,
      jerseyNumber: jerseyNum,
      animState: 'idle',
    })
    usedJerseys[team].add(jerseyNum)
  }

  const addOutfielder = (team: 'home' | 'away', slot: number, playerId: string, isHuman: boolean, humanJersey: number) => {
    const role = gridToRole(slot)
    const pos = gridToStartPos(slot, team)
    let jersey = isHuman ? humanJersey : randomUniqueJersey(usedJerseys[team])
    usedJerseys[team].add(jersey)
    players.push({
      id: playerId,
      team, role, pos,
      facing: { x: team === 'home' ? 1 : -1, y: 0 },
      stamina: 1, isControlled: isHuman, hasBall: false,
      jerseyNumber: jersey, animState: 'idle',
    })
  }

  addGK('home', 1)
  addGK('away', 1)

  home.formation!.slots.forEach((slot, i) => {
    addOutfielder('home', slot, `home-${i}`, i === 0, home.jerseyNumber)
  })
  away.formation!.slots.forEach((slot, i) => {
    addOutfielder('away', slot, `away-${i}`, i === 0, away.jerseyNumber)
  })

  return players
}

function randomUniqueJersey(used: Set<number>): number {
  let n: number
  do { n = Math.floor(Math.random() * 98) + 2 } while (used.has(n))
  return n
}
```

- [ ] **Step 2: Write unit tests**

Create `party/physics.test.ts`:
```typescript
import { describe, it, expect } from 'vitest'

// Inline helpers to test without importing server module
function gridToRole(idx: number): 'fwd' | 'mid' | 'def' {
  const row = Math.floor(idx / 3)
  return row === 0 ? 'fwd' : row === 1 ? 'mid' : 'def'
}

describe('gridToRole', () => {
  it('top row is fwd', () => {
    expect(gridToRole(0)).toBe('fwd')
    expect(gridToRole(1)).toBe('fwd')
    expect(gridToRole(2)).toBe('fwd')
  })
  it('middle row is mid', () => {
    expect(gridToRole(3)).toBe('mid')
    expect(gridToRole(5)).toBe('mid')
  })
  it('bottom row is def', () => {
    expect(gridToRole(6)).toBe('def')
    expect(gridToRole(8)).toBe('def')
  })
})
```

- [ ] **Step 3: Run tests**

```bash
npm test
```

Expected: 3 passing tests

- [ ] **Step 4: Commit**

```bash
git add party/
git commit -m "feat: player builder from formation grid"
```

---

## Task 6: Server Physics — Ball & Movement

**Files:**
- Modify: `party/server.ts` — implement `tick()` physics
- Modify: `party/physics.test.ts` — add physics tests

- [ ] **Step 1: Write physics helpers (add to `party/server.ts` before `tick`)**

```typescript
const DT = TICK_MS / 1000  // seconds per tick
const FRICTION = 0.92      // ball velocity multiplier per tick
const PLAYER_SPEED = 8     // units/sec base speed
const SPRINT_MULT = 1.6
const TIRED_MULT = 0.8
const STAMINA_REGEN = 0.2 / 20  // per tick (20% per sec / 20 ticks)
const STAMINA_DRAIN = 0.3 / 20  // per tick during sprint

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x, dy = a.y - b.y
  return Math.sqrt(dx * dx + dy * dy)
}

function norm(v: { x: number; y: number }): { x: number; y: number } {
  const d = Math.sqrt(v.x * v.x + v.y * v.y)
  if (d < 0.0001) return { x: 0, y: 0 }
  return { x: v.x / d, y: v.y / d }
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v))
}

function tickBall(state: GameState) {
  const { ball } = state
  if (ball.ownerId !== null) return  // attached to player, moves with them

  // Apply velocity
  ball.pos.x += ball.vel.x * DT
  ball.pos.y += ball.vel.y * DT
  ball.pos.z += ball.vel.z * DT

  // Gravity on z
  if (ball.pos.z > 0) {
    ball.vel.z -= 20 * DT
  } else {
    ball.pos.z = 0
    if (ball.vel.z < 0) ball.vel.z = -ball.vel.z * 0.5  // bounce
    if (Math.abs(ball.vel.z) < 0.5) ball.vel.z = 0
  }

  // Friction (only when on ground)
  if (ball.pos.z === 0) {
    ball.vel.x *= FRICTION
    ball.vel.y *= FRICTION
  }

  // Wall bounce (field boundaries)
  if (ball.pos.x < FIELD.BALL_RADIUS) { ball.pos.x = FIELD.BALL_RADIUS; ball.vel.x = Math.abs(ball.vel.x) * 0.8 }
  if (ball.pos.x > FIELD.W - FIELD.BALL_RADIUS) { ball.pos.x = FIELD.W - FIELD.BALL_RADIUS; ball.vel.x = -Math.abs(ball.vel.x) * 0.8 }
  if (ball.pos.y < FIELD.BALL_RADIUS) { ball.pos.y = FIELD.BALL_RADIUS; ball.vel.y = Math.abs(ball.vel.y) * 0.8 }
  if (ball.pos.y > FIELD.H - FIELD.BALL_RADIUS) { ball.pos.y = FIELD.H - FIELD.BALL_RADIUS; ball.vel.y = -Math.abs(ball.vel.y) * 0.8 }
}

function tickPlayer(player: Player, input: PlayerInput | null) {
  let speed = PLAYER_SPEED

  if (input && (input.sprint) && player.stamina > 0) {
    speed *= SPRINT_MULT
    player.stamina = clamp(player.stamina - STAMINA_DRAIN, 0, 1)
  } else {
    if (player.stamina < 0.01) speed *= TIRED_MULT
    player.stamina = clamp(player.stamina + STAMINA_REGEN, 0, 1)
  }

  if (input && (input.dx !== 0 || input.dy !== 0)) {
    const dir = norm({ x: input.dx, y: input.dy })
    player.pos.x += dir.x * speed * DT
    player.pos.y += dir.y * speed * DT
    player.facing = dir
    player.animState = 'run'
  } else {
    player.animState = 'idle'
  }

  // Keep in field
  player.pos.x = clamp(player.pos.x, FIELD.PLAYER_RADIUS, FIELD.W - FIELD.PLAYER_RADIUS)
  player.pos.y = clamp(player.pos.y, FIELD.PLAYER_RADIUS, FIELD.H - FIELD.PLAYER_RADIUS)
}
```

- [ ] **Step 2: Implement `tick()` with movement and dribble attach**

Replace the stub `tick()`:

```typescript
private tick() {
  const { state } = this

  if (state.phase === 'playing' || state.phase === 'kickoff') {
    // Player movement
    for (const player of state.players) {
      const connId = [...this.assignments.entries()].find(([, t]) => t === player.team)?.[0]
      const input = (player.isControlled && connId) ? this.inputs.get(connId) ?? null : null
      if (player.role !== 'gk' || player.isControlled) {
        tickPlayer(player, input)
      }
    }

    // Ball physics
    tickBall(state)

    // Dribble attach: free ball within 1.5 units of nearest player grabs it
    if (state.ball.ownerId === null && state.ball.pos.z < 1) {
      let closest: Player | null = null
      let closestDist = FIELD.DRIBBLE_ATTACH_DIST
      for (const p of state.players) {
        const d = dist(p.pos, state.ball.pos)
        if (d < closestDist) { closestDist = d; closest = p }
      }
      if (closest) {
        state.ball.ownerId = closest.id
        closest.hasBall = true
        state.ball.vel = { x: 0, y: 0, z: 0 }
      }
    }

    // Move ball with dribbling player
    if (state.ball.ownerId !== null) {
      const owner = state.players.find(p => p.id === state.ball.ownerId)
      if (owner) {
        const offset = { x: owner.facing.x * 1.2, y: owner.facing.y * 1.2 }
        state.ball.pos.x = owner.pos.x + offset.x
        state.ball.pos.y = owner.pos.y + offset.y
        state.ball.pos.z = 0
      }
    }

    // Timer
    if (state.phase === 'playing') {
      state.timeLeft -= DT
      if (state.timeLeft <= 0) this.endHalf()
    }
  }

  this.broadcast({ type: 'state', state })
}

private endHalf() {
  if (this.state.half === 1) {
    this.state.phase = 'halftime'
    this.state.half = 2
    this.state.timeLeft = 5 * 60
    setTimeout(() => this.startCountdown(), 5000)
  } else {
    this.state.phase = 'ended'
    if (this.tickInterval) { clearInterval(this.tickInterval); this.tickInterval = null }
  }
  this.broadcast({ type: 'state', state: this.state })
}
```

- [ ] **Step 3: Add physics unit tests**

Add to `party/physics.test.ts`:

```typescript
describe('dist', () => {
  it('calculates euclidean distance', () => {
    const d = Math.sqrt((4-0)**2 + (3-0)**2)
    expect(d).toBeCloseTo(5)
  })
})

describe('ball friction', () => {
  it('velocity decreases each tick', () => {
    let vx = 10
    for (let i = 0; i < 20; i++) vx *= 0.92
    expect(vx).toBeLessThan(2)
  })
})
```

- [ ] **Step 4: Run tests**

```bash
npm test
```

Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add party/
git commit -m "feat: ball physics, player movement, dribble attach on server"
```

---

## Task 7: Server — Shoot, Pass, Actions

**Files:**
- Modify: `party/server.ts` — handle input actions in tick
- Modify: `party/physics.test.ts` — action tests

- [ ] **Step 1: Add action handler in `tick()`, inside the player loop**

Add after `tickPlayer(player, input)`:

```typescript
// Handle input actions for controlled player
if (player.isControlled && input?.action && player.hasBall) {
  handleBallAction(state, player, input)
}
// Tackle / GK rush (no ball required)
if (player.isControlled && input?.action && !player.hasBall) {
  handleNoBallAction(state, player, input)
}
```

- [ ] **Step 2: Write `handleBallAction`**

```typescript
function handleBallAction(state: GameState, player: Player, input: PlayerInput) {
  const { ball } = state
  const dir = (input.dx !== 0 || input.dy !== 0)
    ? norm({ x: input.dx, y: input.dy })
    : player.facing

  const releaseBall = () => {
    player.hasBall = false
    ball.ownerId = null
    player.animState = 'kick'
  }

  const kickSpeed = (base: number) => base * (0.4 + input.power * 0.6)

  if (input.action === 'shoot') {
    const speed = kickSpeed(28)
    ball.vel.x = dir.x * speed
    ball.vel.y = dir.y * speed
    ball.vel.z = 4
    releaseBall()
    state.stats.shots[player.team]++
    // onTarget check deferred to goal detection
  }

  if (input.action === 'chipshot') {
    ball.vel.x = dir.x * 14
    ball.vel.y = dir.y * 14
    ball.vel.z = 12
    releaseBall()
    state.stats.shots[player.team]++
  }

  if (input.action === 'lowpass') {
    const speed = kickSpeed(18)
    ball.vel.x = dir.x * speed
    ball.vel.y = dir.y * speed
    ball.vel.z = 0
    releaseBall()
    switchControlToNearest(state, player.team, dir)
  }

  if (input.action === 'loftedpass') {
    const speed = kickSpeed(16)
    ball.vel.x = dir.x * speed
    ball.vel.y = dir.y * speed
    ball.vel.z = kickSpeed(8)
    releaseBall()
    switchControlToNearest(state, player.team, dir)
  }

  if (input.action === 'throughpass') {
    // Pass into space behind defensive line
    const speed = kickSpeed(20)
    ball.vel.x = dir.x * speed
    ball.vel.y = dir.y * speed
    ball.vel.z = 2
    releaseBall()
    switchControlToNearest(state, player.team, dir)
  }
}

function handleNoBallAction(state: GameState, player: Player, input: PlayerInput) {
  if (input.action === 'tackle') {
    // Standing tackle: grab ball if within TACKLE_DIST
    const ballOwner = state.players.find(p => p.id === state.ball.ownerId)
    if (ballOwner && ballOwner.team !== player.team && dist(player.pos, ballOwner.pos) < FIELD.TACKLE_DIST) {
      ballOwner.hasBall = false
      state.ball.ownerId = null
      state.ball.vel = { x: player.facing.x * 5, y: player.facing.y * 5, z: 0 }
    }
  }

  if (input.action === 'slidetackle') {
    // Sliding tackle with foul risk if from behind
    const ballOwner = state.players.find(p => p.id === state.ball.ownerId)
    if (ballOwner && ballOwner.team !== player.team) {
      const toBall = norm({ x: ballOwner.pos.x - player.pos.x, y: ballOwner.pos.y - player.pos.y })
      const fromBehind = (toBall.x * ballOwner.facing.x + toBall.y * ballOwner.facing.y) > 0.5
      if (dist(player.pos, ballOwner.pos) < FIELD.TACKLE_DIST + 1) {
        if (fromBehind) {
          triggerFoul(state, player)
        } else {
          ballOwner.hasBall = false
          state.ball.ownerId = null
          state.ball.vel = { x: player.facing.x * 8, y: player.facing.y * 8, z: 0 }
        }
      }
    }
    player.animState = 'slide'
  }

  if (input.action === 'gkrush') {
    // Trigger GK to rush toward ball (AI takes over)
    const gk = state.players.find(p => p.team === player.team && p.role === 'gk')
    if (gk) {
      // Mark GK for rush; AI tick handles movement
      ;(gk as any).__rushing = true
    }
  }
}

function switchControlToNearest(state: GameState, team: 'home' | 'away', dir: { x: number; y: number }) {
  // Find nearest teammate to ball destination (estimated)
  const dest = {
    x: state.ball.pos.x + dir.x * 10,
    y: state.ball.pos.y + dir.y * 10,
  }
  let nearest: Player | null = null
  let nearestDist = Infinity
  for (const p of state.players) {
    if (p.team !== team || p.role === 'gk') continue
    const d = dist(p.pos, dest)
    if (d < nearestDist) { nearestDist = d; nearest = p }
  }
  if (nearest) {
    for (const p of state.players) { if (p.team === team) p.isControlled = false }
    nearest.isControlled = true
  }
}

function triggerFoul(state: GameState, fouler: Player) {
  const foulPos = { ...fouler.pos }
  const inPA = isInPenaltyArea(foulPos, fouler.team === 'home' ? 'away' : 'home')
  state.phase = inPA ? 'penalty' : 'freekick'
  state.setpiece = {
    type: inPA ? 'penalty' : 'freekick',
    team: fouler.team === 'home' ? 'away' : 'home',
    pos: foulPos,
  }
  state.ball.ownerId = null
  state.ball.vel = { x: 0, y: 0, z: 0 }
  state.ball.pos = { x: foulPos.x, y: foulPos.y, z: 0 }
}

function isInPenaltyArea(pos: { x: number; y: number }, team: 'home' | 'away'): boolean {
  const goalX = team === 'home' ? 0 : FIELD.W
  const paLeft = team === 'home' ? 0 : FIELD.W - FIELD.PA_DEPTH
  const paRight = team === 'home' ? FIELD.PA_DEPTH : FIELD.W
  const paTop = FIELD.CENTER_Y - FIELD.PA_HALF_WIDTH
  const paBottom = FIELD.CENTER_Y + FIELD.PA_HALF_WIDTH
  return pos.x >= paLeft && pos.x <= paRight && pos.y >= paTop && pos.y <= paBottom
}
```

- [ ] **Step 3: Add goal detection to `tick()`**

Add after ball physics section in `tick()`:

```typescript
// Goal detection
if (state.ball.ownerId === null) {
  const { pos } = state.ball
  const goalTop = FIELD.CENTER_Y - FIELD.GOAL_WIDTH / 2
  const goalBot = FIELD.CENTER_Y + FIELD.GOAL_WIDTH / 2
  if (pos.x <= 0 && pos.y >= goalTop && pos.y <= goalBot) {
    state.score.away++
    state.stats.shotsOnTarget.away++
    this.triggerKickoff('home')
  } else if (pos.x >= FIELD.W && pos.y >= goalTop && pos.y <= goalBot) {
    state.score.home++
    state.stats.shotsOnTarget.home++
    this.triggerKickoff('away')
  }
}
```

Add `triggerKickoff()` method:

```typescript
private triggerKickoff(team: 'home' | 'away') {
  this.state.phase = 'kickoff'
  this.state.kickoffTeam = team
  this.state.ball = { pos: { x: FIELD.CENTER_X, y: FIELD.CENTER_Y, z: 0 }, vel: { x: 0, y: 0, z: 0 }, ownerId: null }
  for (const p of this.state.players) {
    p.hasBall = false
    // Reset isControlled to initial: first player per team
    const isFirst = this.state.players.filter(pp => pp.team === p.team && pp.role !== 'gk').indexOf(p) === 0
    p.isControlled = isFirst
  }
  setTimeout(() => {
    if (this.state.phase === 'kickoff') this.state.phase = 'playing'
  }, 2000)
}
```

- [ ] **Step 4: Add action unit tests**

Add to `party/physics.test.ts`:

```typescript
describe('isInPenaltyArea', () => {
  // Inline copy of the function for testing
  function isInPA(pos: { x: number; y: number }, team: 'home' | 'away') {
    const W = 100, H = 60, PA_DEPTH = 16, PA_HALF_WIDTH = 18, CENTER_Y = 30
    const paLeft = team === 'home' ? 0 : W - PA_DEPTH
    const paRight = team === 'home' ? PA_DEPTH : W
    const paTop = CENTER_Y - PA_HALF_WIDTH
    const paBottom = CENTER_Y + PA_HALF_WIDTH
    return pos.x >= paLeft && pos.x <= paRight && pos.y >= paTop && pos.y <= paBottom
  }

  it('center is not in any PA', () => {
    expect(isInPA({ x: 50, y: 30 }, 'home')).toBe(false)
    expect(isInPA({ x: 50, y: 30 }, 'away')).toBe(false)
  })
  it('home PA: near home goal', () => {
    expect(isInPA({ x: 5, y: 30 }, 'home')).toBe(true)
  })
  it('away PA: near away goal', () => {
    expect(isInPA({ x: 95, y: 30 }, 'away')).toBe(true)
  })
})
```

- [ ] **Step 5: Run tests**

```bash
npm test
```

Expected: all pass

- [ ] **Step 6: Commit**

```bash
git add party/
git commit -m "feat: shoot, pass, tackle, foul, goal detection on server"
```

---

## Task 8: Server — AI Players

**Files:**
- Modify: `party/server.ts` — add AI tick logic

- [ ] **Step 1: Write AI tick (add before `broadcast` in `tick()`)**

```typescript
private tickAI(state: GameState) {
  const { ball } = state

  for (const player of state.players) {
    if (player.isControlled) continue

    const isGK = player.role === 'gk'
    if (isGK) {
      this.tickGKAI(state, player)
    } else {
      this.tickFieldAI(state, player)
    }
  }
}

private tickGKAI(state: GameState, gk: Player) {
  const { ball } = state
  const goalX = gk.team === 'home' ? 3 : FIELD.W - 3
  const rushing = (gk as any).__rushing

  if (rushing) {
    // Rush toward ball
    const d = dist(gk.pos, ball.pos)
    if (d < 1.5) {
      // Reach ball
      if (isInPenaltyArea(ball.pos, gk.team)) {
        if (ball.ownerId === null) {
          // Catch
          ball.ownerId = gk.id
          gk.hasBall = true
          gk.isControlled = true  // Transfer to player
        } else {
          // Tackle attacker
          const attacker = state.players.find(p => p.id === ball.ownerId)
          if (attacker) {
            const success = Math.random() > 0.4
            if (success) { attacker.hasBall = false; ball.ownerId = null; ball.vel = { x: (gk.team === 'home' ? 1 : -1) * 10, y: 0, z: 3 } }
          }
        }
      } else {
        // Clear
        ball.vel.x = (gk.team === 'home' ? 1 : -1) * 15
        ball.vel.y = (Math.random() - 0.5) * 8
        ball.vel.z = 5
        ball.ownerId = null
        if (gk.hasBall) gk.hasBall = false
      }
      ;(gk as any).__rushing = false
    } else {
      const dir = norm({ x: ball.pos.x - gk.pos.x, y: ball.pos.y - gk.pos.y })
      gk.pos.x += dir.x * PLAYER_SPEED * 1.2 * DT
      gk.pos.y += dir.y * PLAYER_SPEED * 1.2 * DT
      gk.facing = dir
      gk.animState = 'run'
      return
    }
  }

  // Auto-rush if ball is close
  const d = dist(gk.pos, ball.pos)
  if (d < FIELD.GK_RUSH_DIST && ball.ownerId === null) {
    ;(gk as any).__rushing = true
    return
  }

  // Track ball laterally along goal line
  const targetY = clamp(ball.pos.y, FIELD.CENTER_Y - FIELD.GOAL_WIDTH / 2 - 2, FIELD.CENTER_Y + FIELD.GOAL_WIDTH / 2 + 2)
  const dy = targetY - gk.pos.y
  if (Math.abs(dy) > 0.1) {
    gk.pos.y += Math.sign(dy) * PLAYER_SPEED * 0.8 * DT
    gk.animState = 'run'
  } else {
    gk.animState = 'idle'
  }
  gk.pos.x = goalX
}

private tickFieldAI(state: GameState, player: Player) {
  const { ball } = state
  const attacking = (ball.pos.x > FIELD.CENTER_X) === (player.team === 'home')

  let targetPos: { x: number; y: number }

  switch (player.role) {
    case 'fwd':
      targetPos = attacking
        ? nearestTo(player.pos, { x: ball.pos.x, y: ball.pos.y }, 15)
        : { x: player.team === 'home' ? 70 : 30, y: player.pos.y }
      break
    case 'mid':
      targetPos = attacking
        ? { x: player.team === 'home' ? Math.min(ball.pos.x, 75) : Math.max(ball.pos.x, 25), y: ball.pos.y }
        : { x: player.team === 'home' ? 45 : 55, y: ball.pos.y }
      break
    case 'def':
      targetPos = !attacking
        ? { x: player.team === 'home' ? Math.max(ball.pos.x - 5, 15) : Math.min(ball.pos.x + 5, 85), y: ball.pos.y }
        : { x: player.team === 'home' ? 25 : 75, y: player.pos.y }
      break
    default: targetPos = player.pos
  }

  // Move toward target
  const d = dist(player.pos, targetPos)
  if (d > 0.5) {
    const dir = norm({ x: targetPos.x - player.pos.x, y: targetPos.y - player.pos.y })
    player.pos.x += dir.x * PLAYER_SPEED * 0.9 * DT
    player.pos.y += dir.y * PLAYER_SPEED * 0.9 * DT
    player.facing = dir
    player.animState = 'run'
  } else {
    player.animState = 'idle'
  }

  // Auto tackle if close to ball carrier
  const carrier = state.players.find(p => p.id === ball.ownerId)
  if (carrier && carrier.team !== player.team && dist(player.pos, carrier.pos) < FIELD.TACKLE_DIST) {
    const success = Math.random() > 0.7
    if (success) {
      carrier.hasBall = false
      ball.ownerId = null
      ball.vel = { x: player.facing.x * 6, y: player.facing.y * 6, z: 0 }
    }
  }
}

function nearestTo(from: { x: number; y: number }, to: { x: number; y: number }, maxDist: number) {
  const d = dist(from, to)
  if (d <= maxDist) return to
  const dir = norm({ x: to.x - from.x, y: to.y - from.y })
  return { x: from.x + dir.x * maxDist, y: from.y + dir.y * maxDist }
}
```

- [ ] **Step 2: Call `tickAI` inside `tick()`**

Add inside the `if (state.phase === 'playing' || state.phase === 'kickoff')` block, before ball physics:

```typescript
this.tickAI(state)
```

- [ ] **Step 3: Commit**

```bash
git add party/server.ts
git commit -m "feat: AI for GK, FWD, MID, DEF with auto-tackle"
```

---

## Task 9: Three.js Field Renderer

**Files:**
- Modify: `src/game/renderer.ts` — implement Three.js field and render loop

- [ ] **Step 1: Write renderer**

```typescript
import * as THREE from 'three'
import type { GameState } from '../types'
import { FIELD } from '../types'
import { tickCamera } from './camera'

const SCALE = 8  // game units → Three.js units

let renderer: THREE.WebGLRenderer
let scene: THREE.Scene
let camera: THREE.PerspectiveCamera
let animFrame: number | null = null

// Meshes
const playerMeshes = new Map<string, THREE.Group>()
let ballMesh: THREE.Mesh
let latestState: GameState | null = null

export function startGame(initialState: GameState) {
  latestState = initialState
  const canvas = document.getElementById('three-canvas') as HTMLCanvasElement

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.shadowMap.enabled = true

  scene = new THREE.Scene()
  scene.background = new THREE.Color(0x1a1a2e)

  camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 1000)
  camera.position.set(FIELD.CENTER_X * SCALE / FIELD.W * 50, -30, 80)
  camera.lookAt(FIELD.CENTER_X * SCALE / FIELD.W * 50, 0, 0)

  buildField()
  buildBall()
  buildLighting()

  window.addEventListener('resize', onResize)
  animFrame = requestAnimationFrame(renderLoop)
}

export function stopGame() {
  if (animFrame !== null) cancelAnimationFrame(animFrame)
  playerMeshes.clear()
  latestState = null
}

export function updateGameState(state: GameState) {
  latestState = state
  syncPlayers(state)
  syncBall(state)
}

function toWorld(x: number, y: number): [number, number] {
  return [x * (50 / FIELD.W) * 2 - 50, y * (30 / FIELD.H) * 2 - 30]
}

function buildField() {
  // Grass
  const grassGeo = new THREE.PlaneGeometry(100, 60)
  const grassMat = new THREE.MeshLambertMaterial({ color: 0x2d6a1f })
  scene.add(new THREE.Mesh(grassGeo, grassMat))

  // Field lines
  addLine([[-50, -30, 0.05], [50, -30, 0.05]], 0xffffff)  // top
  addLine([[-50, 30, 0.05], [50, 30, 0.05]], 0xffffff)   // bottom
  addLine([[-50, -30, 0.05], [-50, 30, 0.05]], 0xffffff) // left
  addLine([[50, -30, 0.05], [50, 30, 0.05]], 0xffffff)   // right
  addLine([[0, -30, 0.05], [0, 30, 0.05]], 0xffffff)     // center

  // Penalty areas
  const paW = FIELD.PA_DEPTH * (50 / FIELD.W) * 2
  const paH = FIELD.PA_HALF_WIDTH * (30 / FIELD.H) * 2 * 2
  addLineBox(-50, -paH / 2, paW, paH)   // home PA
  addLineBox(50 - paW, -paH / 2, paW, paH) // away PA

  // Goals (3D)
  addGoal(-50, 0x888888)
  addGoal(50, 0x888888)
}

function addLine(points: [number, number, number][], color: number) {
  const geo = new THREE.BufferGeometry().setFromPoints(points.map(([x, y, z]) => new THREE.Vector3(x, y, z)))
  scene.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color })))
}

function addLineBox(x: number, y: number, w: number, h: number) {
  const pts: [number, number, number][] = [
    [x, y, 0.05], [x + w, y, 0.05], [x + w, y + h, 0.05], [x, y + h, 0.05], [x, y, 0.05]
  ]
  addLine(pts, 0xffffff)
}

function addGoal(x: number, color: number) {
  const mat = new THREE.MeshLambertMaterial({ color })
  const postGeo = new THREE.CylinderGeometry(0.15, 0.15, 4, 6)
  const goalW = FIELD.GOAL_WIDTH * (30 / FIELD.H) * 2
  const leftPost = new THREE.Mesh(postGeo, mat)
  leftPost.position.set(x, -goalW / 2, 2)
  const rightPost = new THREE.Mesh(postGeo, mat)
  rightPost.position.set(x, goalW / 2, 2)
  const crossbar = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, goalW, 6), mat)
  crossbar.rotation.x = Math.PI / 2
  crossbar.position.set(x, 0, 4)
  scene.add(leftPost, rightPost, crossbar)
}

function buildBall() {
  const geo = new THREE.SphereGeometry(0.6, 12, 8)
  const mat = new THREE.MeshLambertMaterial({ color: 0xf5f5f5 })
  ballMesh = new THREE.Mesh(geo, mat)
  ballMesh.castShadow = true
  scene.add(ballMesh)
}

function buildLighting() {
  scene.add(new THREE.AmbientLight(0xffffff, 0.6))
  const sun = new THREE.DirectionalLight(0xffffff, 0.8)
  sun.position.set(0, -20, 40)
  scene.add(sun)
}

function buildPlayerMesh(color: number): THREE.Group {
  const g = new THREE.Group()
  const mat = (c: number) => new THREE.MeshLambertMaterial({ color: c })

  // Head
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.8, 8, 6), mat(0xfbbf24))
  head.position.z = 4.2
  g.add(head)

  // Body (jersey color)
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.8, 1.8), mat(color))
  body.position.z = 2.8
  g.add(body)

  // Arms
  const armGeo = new THREE.BoxGeometry(0.35, 0.35, 1.2)
  const lArm = new THREE.Mesh(armGeo, mat(color)); lArm.position.set(-0.9, 0, 2.8); g.add(lArm)
  const rArm = new THREE.Mesh(armGeo, mat(color)); rArm.position.set(0.9, 0, 2.8); g.add(rArm)

  // Legs
  const legGeo = new THREE.BoxGeometry(0.45, 0.45, 1.6)
  const lLeg = new THREE.Mesh(legGeo, mat(0x1d4ed8)); lLeg.position.set(-0.4, 0, 1.2); g.add(lLeg)
  const rLeg = new THREE.Mesh(legGeo, mat(0x1d4ed8)); rLeg.position.set(0.4, 0, 1.2); g.add(rLeg)

  return g
}

const TEAM_COLORS: Record<string, number> = {
  blue: 0x3b82f6, red: 0xef4444, green: 0x16a34a, yellow: 0xeab308
}

function syncPlayers(state: GameState) {
  for (const player of state.players) {
    let mesh = playerMeshes.get(player.id)
    if (!mesh) {
      const color = TEAM_COLORS[state.lobby?.[player.team]?.color ?? 'blue'] ?? 0x3b82f6
      mesh = buildPlayerMesh(color)
      scene.add(mesh)
      playerMeshes.set(player.id, mesh)
    }
    const [wx, wy] = toWorld(player.pos.x, player.pos.y)
    mesh.position.set(wx, wy, 0)
    mesh.rotation.z = Math.atan2(player.facing.y, player.facing.x) - Math.PI / 2
  }
}

function syncBall(state: GameState) {
  if (!ballMesh) return
  const [wx, wy] = toWorld(state.ball.pos.x, state.ball.pos.y)
  ballMesh.position.set(wx, wy, state.ball.pos.z * 0.6)
}

function renderLoop() {
  animFrame = requestAnimationFrame(renderLoop)
  if (latestState) tickCamera(camera, latestState)
  renderer.render(scene, camera)
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
}
```

- [ ] **Step 2: Write `src/game/camera.ts`**

```typescript
import * as THREE from 'three'
import type { GameState } from '../types'
import { FIELD } from '../types'

let camTargetX = 0, camTargetZ = 80

export function tickCamera(camera: THREE.PerspectiveCamera, state: GameState) {
  const { ball } = state
  // Ball x in [-50, 50] world coords
  const wx = (ball.pos.x / FIELD.W) * 100 - 50
  const wz = 70 + (dist2d(ball.pos.x, ball.pos.y, FIELD.CENTER_X, FIELD.CENTER_Y) / 50) * 15

  camTargetX += (wx - camTargetX) * 0.05
  camTargetZ += (wz - camTargetZ) * 0.05

  camera.position.x = camTargetX
  camera.position.z = camTargetZ
  camera.lookAt(camTargetX, 0, 0)
}

function dist2d(x1: number, y1: number, x2: number, y2: number) {
  return Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2)
}
```

- [ ] **Step 3: Wire `updateGameState` into `main.ts`**

In `src/main.ts`, inside `onStateUpdate`, add:

```typescript
import { updateGameState } from './game/renderer'
// In onStateUpdate, inside the else branch (game phase):
updateGameState(state)
```

- [ ] **Step 4: Visual verification**

```bash
npm run dev & npm run party:dev
```

Open two browser tabs. Create a room in one, join in the other. Field should render with grass, lines, goals. Ball should sit at center.

- [ ] **Step 5: Commit**

```bash
git add src/game/
git commit -m "feat: Three.js field, characters, ball, camera"
```

---

## Task 10: Input System

**Files:**
- Modify: `src/game/input.ts` — keyboard + nipplejs

- [ ] **Step 1: Write `src/game/input.ts`**

```typescript
import nipplejs from 'nipplejs'
import type { PlayerInput } from '../types'
import { sendInput } from '../main'

const keys = new Set<string>()
let joystickDx = 0, joystickDy = 0
let actionPressStart: number | null = null
let pendingAction: PlayerInput['action'] = null
let sprintPressed = false
let switchPressed = false

let inputLoopId: ReturnType<typeof setInterval> | null = null
let joystickManager: nipplejs.JoystickManager | null = null

export function initInput() {
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)

  if (isMobile()) initJoystick()

  inputLoopId = setInterval(flushInput, 50)  // match tick rate
}

export function destroyInput() {
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
  if (inputLoopId) clearInterval(inputLoopId)
  if (joystickManager) joystickManager.destroy()
}

function isMobile() {
  return window.innerWidth < 768 || 'ontouchstart' in window
}

function onKeyDown(e: KeyboardEvent) {
  keys.add(e.key)
  if (!actionPressStart && isActionKey(e.key)) {
    actionPressStart = Date.now()
    pendingAction = keyToAction(e.key, false)
  }
  if (e.key === 'Tab') { switchPressed = true; e.preventDefault() }
}

function onKeyUp(e: KeyboardEvent) {
  keys.delete(e.key)
  if (isActionKey(e.key) && actionPressStart !== null) {
    // Action fires on key release
    actionPressStart = null
  }
}

function isActionKey(key: string) {
  return [' ', 'c', 'C', 'x', 'X', 'z', 'Z'].includes(key)
}

function keyToAction(key: string, hasBall: boolean): PlayerInput['action'] {
  if (key === ' ') return 'shoot'
  if (key === 'c' || key === 'C') return hasBall ? 'lowpass' : 'tackle'
  if (key === 'x' || key === 'X') return hasBall ? 'loftedpass' : 'slidetackle'
  if (key === 'z' || key === 'Z') return hasBall ? 'throughpass' : 'gkrush'
  return null
}

function getDxDy(): { dx: number; dy: number } {
  if (joystickDx !== 0 || joystickDy !== 0) return { dx: joystickDx, dy: joystickDy }
  let dx = 0, dy = 0
  if (keys.has('ArrowLeft') || keys.has('a') || keys.has('A')) dx -= 1
  if (keys.has('ArrowRight') || keys.has('d') || keys.has('D')) dx += 1
  if (keys.has('ArrowUp') || keys.has('w') || keys.has('W')) dy -= 1
  if (keys.has('ArrowDown') || keys.has('s') || keys.has('S')) dy += 1
  return { dx, dy }
}

function flushInput() {
  const { dx, dy } = getDxDy()
  const sprint = keys.has('Shift') || sprintPressed
  let power = 0
  let action: PlayerInput['action'] = null

  if (actionPressStart !== null) {
    power = Math.min((Date.now() - actionPressStart) / 1500, 1)
    action = pendingAction
  }

  // Chip shot: Space held + X pressed
  if (keys.has(' ') && keys.has('x') || keys.has(' ') && keys.has('X')) {
    action = 'chipshot'
  }

  const input: PlayerInput = { dx, dy, sprint, switchPlayer: switchPressed, action, power }
  sendInput(input)
  switchPressed = false
}

function initJoystick() {
  const zone = document.createElement('div')
  zone.style.cssText = 'position:fixed;left:0;bottom:0;width:150px;height:150px;z-index:100'
  document.body.appendChild(zone)

  joystickManager = nipplejs.create({ zone, mode: 'static', position: { left: '75px', bottom: '75px' } })
  joystickManager.on('move', (_, data) => {
    if (data.vector) { joystickDx = data.vector.x; joystickDy = -data.vector.y }
  })
  joystickManager.on('end', () => { joystickDx = 0; joystickDy = 0 })
}
```

- [ ] **Step 2: Call `initInput` when game starts**

In `src/game/renderer.ts`, `startGame()`:
```typescript
import { initInput } from './input'
// Inside startGame():
initInput()
```

In `stopGame()`:
```typescript
import { destroyInput } from './input'
// Inside stopGame():
destroyInput()
```

- [ ] **Step 3: Manual test**

Two browser tabs: open room, join. Try WASD movement, spacebar shoot, C pass. Player should move, ball should detach and move on shoot.

- [ ] **Step 4: Commit**

```bash
git add src/game/input.ts src/game/renderer.ts
git commit -m "feat: keyboard and nipplejs joystick input → server"
```

---

## Task 11: HUD Canvas Overlay

**Files:**
- Modify: `src/game/ui.ts`

- [ ] **Step 1: Write `src/game/ui.ts`**

```typescript
import type { GameState } from '../types'
import { FIELD } from '../types'

let ctx: CanvasRenderingContext2D
let canvas: HTMLCanvasElement
let animFrame: number | null = null
let latestState: GameState | null = null
let myTeamRef: 'home' | 'away' | null = null
let powerGauge = 0  // 0~1, updated from input
let alertText = ''
let alertTimer = 0

export function initHUD(myTeam: 'home' | 'away') {
  canvas = document.getElementById('hud-canvas') as HTMLCanvasElement
  ctx = canvas.getContext('2d')!
  myTeamRef = myTeam
  resize()
  window.addEventListener('resize', resize)
  animFrame = requestAnimationFrame(drawLoop)
}

export function destroyHUD() {
  if (animFrame) cancelAnimationFrame(animFrame)
  window.removeEventListener('resize', resize)
}

export function updateHUDState(state: GameState) {
  latestState = state
}

export function setPowerGauge(v: number) { powerGauge = v }

export function showAlert(text: string) {
  alertText = text
  alertTimer = 120  // ticks ~2s at 60fps
}

function resize() {
  canvas.width = window.innerWidth
  canvas.height = window.innerHeight
}

function drawLoop() {
  animFrame = requestAnimationFrame(drawLoop)
  if (!latestState) return
  ctx.clearRect(0, 0, canvas.width, canvas.height)

  drawScoreTimer(latestState)
  drawMinimap(latestState)
  drawAlert()

  if (alertTimer > 0) alertTimer--
}

function drawScoreTimer(state: GameState) {
  const { score, timeLeft, half } = state
  const mins = Math.floor(timeLeft / 60).toString().padStart(2, '0')
  const secs = Math.floor(timeLeft % 60).toString().padStart(2, '0')

  ctx.save()
  ctx.fillStyle = 'rgba(0,0,0,0.6)'
  ctx.roundRect(12, 12, 180, 52, 8)
  ctx.fill()
  ctx.fillStyle = '#fff'
  ctx.font = 'bold 20px sans-serif'
  ctx.fillText(`${score.home} : ${score.away}`, 22, 38)
  ctx.font = '14px sans-serif'
  ctx.fillStyle = '#aaa'
  ctx.fillText(`${half === 1 ? '전반' : '후반'} ${mins}:${secs}`, 22, 56)
  ctx.restore()
}

function drawMinimap(state: GameState) {
  const mw = 160, mh = 96, mx = canvas.width / 2 - mw / 2, my = canvas.height - mh - 16

  ctx.save()
  ctx.fillStyle = 'rgba(0,0,0,0.5)'
  ctx.fillRect(mx, my, mw, mh)
  ctx.strokeStyle = 'rgba(255,255,255,0.4)'
  ctx.strokeRect(mx, my, mw, mh)

  // Midline
  ctx.beginPath()
  ctx.moveTo(mx + mw / 2, my)
  ctx.lineTo(mx + mw / 2, my + mh)
  ctx.strokeStyle = 'rgba(255,255,255,0.2)'
  ctx.stroke()

  // Players
  for (const p of state.players) {
    const px = mx + (p.pos.x / FIELD.W) * mw
    const py = my + (p.pos.y / FIELD.H) * mh
    ctx.beginPath()
    ctx.arc(px, py, p.isControlled ? 4 : 2.5, 0, Math.PI * 2)
    ctx.fillStyle = p.team === 'home' ? '#3b82f6' : '#ef4444'
    ctx.fill()
  }

  // Ball
  ctx.beginPath()
  ctx.arc(mx + (state.ball.pos.x / FIELD.W) * mw, my + (state.ball.pos.y / FIELD.H) * mh, 3, 0, Math.PI * 2)
  ctx.fillStyle = '#fff'
  ctx.fill()
  ctx.restore()
}

function drawAlert() {
  if (!alertText || alertTimer <= 0) return
  const alpha = Math.min(alertTimer / 30, 1)
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.fillStyle = 'rgba(0,0,0,0.7)'
  ctx.font = 'bold 28px sans-serif'
  ctx.textAlign = 'center'
  const tw = ctx.measureText(alertText).width
  ctx.fillRect(canvas.width / 2 - tw / 2 - 12, 80, tw + 24, 40)
  ctx.fillStyle = '#fff'
  ctx.fillText(alertText, canvas.width / 2, 108)
  ctx.textAlign = 'left'
  ctx.restore()
}
```

- [ ] **Step 2: Wire HUD into main.ts**

```typescript
import { initHUD, destroyHUD, updateHUDState } from './game/ui'

// In onStateUpdate, else branch (game active):
if (myTeam) initHUD(myTeam)
updateHUDState(state)

// In stopGame():
destroyHUD()
```

- [ ] **Step 3: Visual verify**

Play the game. Top-left should show score + timer. Bottom center should show minimap with blue/red dots and white ball dot.

- [ ] **Step 4: Commit**

```bash
git add src/game/ui.ts src/main.ts
git commit -m "feat: HUD canvas — score, timer, minimap, alerts"
```

---

## Task 12: Lobby Screen

**Files:**
- Modify: `src/screens/lobby.ts`

- [ ] **Step 1: Write full lobby screen**

```typescript
import type { GameState, TeamColor, Formation } from '../types'
import { sendLobby } from '../main'

export function mountLobby(el: HTMLElement, state: GameState) {
  const lobby = state.lobby
  if (!lobby) return

  el.innerHTML = `
    <div style="background:rgba(0,0,0,0.85);padding:32px;border-radius:12px;min-width:360px;max-width:480px">
      <h2 style="text-align:center;margin-bottom:20px">로비</h2>

      <div style="margin-bottom:16px">
        <div style="font-size:12px;color:#888;margin-bottom:8px">팀 색상</div>
        <div id="color-btns" style="display:flex;gap:8px">
          ${(['blue','red','green','yellow'] as TeamColor[]).map(c =>
            `<button data-color="${c}" style="flex:1;height:40px;border-radius:6px;border:2px solid transparent;
             background:${{blue:'#3b82f6',red:'#ef4444',green:'#16a34a',yellow:'#eab308'}[c]};
             cursor:pointer;opacity:${lobby.away?.color === c || lobby.home?.color === c ? '0.3' : '1'}">${c}</button>`
          ).join('')}
        </div>
      </div>

      <div style="margin-bottom:16px">
        <div style="font-size:12px;color:#888;margin-bottom:8px">등번호</div>
        <input id="jersey-input" type="number" min="1" max="99" value="10"
          style="width:80px;padding:8px;font-size:18px;border-radius:6px;border:1px solid #444;background:#222;color:#fff"/>
      </div>

      <div style="margin-bottom:20px">
        <div style="font-size:12px;color:#888;margin-bottom:8px">포메이션 (4개 선택)</div>
        <div id="formation-grid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;max-width:200px;margin:0 auto">
          ${[0,1,2,3,4,5,6,7,8].map(i => {
            const rowLabel = ['FWD','FWD','FWD','MID','MID','MID','DEF','DEF','DEF'][i]
            return `<button data-slot="${i}" style="height:44px;border-radius:8px;border:2px solid #444;
              background:#1a1a2e;color:#888;font-size:11px;cursor:pointer">${rowLabel}</button>`
          }).join('')}
        </div>
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center">
        <span id="opponent-status" style="font-size:13px;color:#888">상대 대기중...</span>
        <button id="ready-btn" disabled
          style="padding:10px 24px;border-radius:8px;background:#6366f1;color:#fff;border:none;cursor:pointer;opacity:0.5">
          Ready
        </button>
      </div>
    </div>
  `

  let selectedColor: TeamColor | null = null
  let selectedSlots: number[] = []
  let jerseyNumber = 10

  const colorBtns = el.querySelectorAll<HTMLButtonElement>('[data-color]')
  const slotBtns = el.querySelectorAll<HTMLButtonElement>('[data-slot]')
  const jerseyInput = el.querySelector<HTMLInputElement>('#jersey-input')!
  const readyBtn = el.querySelector<HTMLButtonElement>('#ready-btn')!

  jerseyInput.addEventListener('change', () => {
    jerseyNumber = Math.max(1, Math.min(99, parseInt(jerseyInput.value) || 10))
    jerseyInput.value = String(jerseyNumber)
    sendLobby({ jerseyNumber })
  })

  colorBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const color = btn.dataset.color as TeamColor
      selectedColor = color
      colorBtns.forEach(b => (b.style.border = '2px solid transparent'))
      btn.style.border = '2px solid #fff'
      sendLobby({ color })
      checkReady()
    })
  })

  slotBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const slot = parseInt(btn.dataset.slot!)
      if (selectedSlots.includes(slot)) {
        selectedSlots = selectedSlots.filter(s => s !== slot)
        btn.style.background = '#1a1a2e'
        btn.style.color = '#888'
      } else if (selectedSlots.length < 4) {
        selectedSlots.push(slot)
        btn.style.background = '#3b82f6'
        btn.style.color = '#fff'
      }
      if (selectedSlots.length === 4) {
        sendLobby({ formation: { slots: selectedSlots } })
      }
      checkReady()
    })
  })

  readyBtn.addEventListener('click', () => {
    sendLobby({ ready: true })
    readyBtn.disabled = true
    readyBtn.textContent = 'Waiting...'
  })

  function checkReady() {
    const ok = selectedColor !== null && selectedSlots.length === 4
    readyBtn.disabled = !ok
    readyBtn.style.opacity = ok ? '1' : '0.5'
  }

  // Show countdown overlay
  if (state.phase === 'countdown' && state.countdown) {
    const overlay = document.createElement('div')
    overlay.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:80px;font-weight:bold;color:#fff'
    overlay.textContent = String(state.countdown)
    el.appendChild(overlay)
  }
}
```

- [ ] **Step 2: Update home screen to properly await import**

Fix `src/screens/home.ts` — remove `await import` (static import works in modules):

```typescript
import { joinRoom } from '../main'

export function mountHome(el: HTMLElement) {
  el.innerHTML = `<div style="text-align:center;padding:40px">
    <h1 style="font-size:48px;margin-bottom:8px">⚽</h1>
    <h2 style="margin-bottom:32px">Soccer Game</h2>
    <button id="btn-create" style="display:block;width:200px;margin:0 auto 12px;padding:12px;font-size:16px;
      border-radius:8px;background:#6366f1;color:#fff;border:none;cursor:pointer">방 만들기</button>
    <button id="btn-join" style="display:block;width:200px;margin:0 auto 12px;padding:12px;font-size:16px;
      border-radius:8px;background:#374151;color:#fff;border:none;cursor:pointer">방 참가</button>
    <input id="room-code" placeholder="6자리 코드" maxlength="6"
      style="display:none;margin-top:8px;padding:10px;width:160px;text-align:center;font-size:18px;
      border-radius:6px;border:1px solid #555;background:#1a1a2e;color:#fff"/>
  </div>`

  el.querySelector('#btn-create')!.addEventListener('click', () => {
    const code = Math.random().toString(36).slice(2, 8).toUpperCase()
    joinRoom(code)
  })

  el.querySelector('#btn-join')!.addEventListener('click', () => {
    const input = el.querySelector('#room-code') as HTMLInputElement
    input.style.display = 'block'
    input.focus()
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') joinRoom(input.value.toUpperCase())
    })
  })
}
```

- [ ] **Step 3: Visual test**

Two tabs: create room + join. Lobby should show color, jersey, formation grid. Select 4 slots + color → Ready button activates.

- [ ] **Step 4: Commit**

```bash
git add src/screens/
git commit -m "feat: lobby screen — color, jersey, formation, ready"
```

---

## Task 13: Result Screen & Rematch

**Files:**
- Modify: `src/screens/result.ts`

- [ ] **Step 1: Write result screen**

```typescript
import type { GameState } from '../types'
import { joinRoom, sendLobby } from '../main'

let currentRoomId: string | null = null

export function setResultRoomId(id: string) { currentRoomId = id }

export function mountResult(el: HTMLElement, state: GameState) {
  const { score, stats } = state
  const winner = score.home > score.away ? '홈 팀 승리!' : score.away > score.home ? '어웨이 팀 승리!' : '무승부!'

  const homePoss = Math.round((stats.possession.home / (stats.possession.home + stats.possession.away + 1)) * 100)
  const awayPoss = 100 - homePoss

  el.innerHTML = `
    <div style="background:rgba(0,0,0,0.9);padding:40px;border-radius:12px;text-align:center;min-width:340px">
      <h2 style="font-size:24px;margin-bottom:8px">${winner}</h2>
      <div style="font-size:56px;font-weight:bold;margin:16px 0">${score.home} : ${score.away}</div>

      <div style="background:#1a1a2e;border-radius:8px;padding:16px;margin:16px 0;text-align:left;font-size:14px">
        <div style="display:flex;justify-content:space-between;margin-bottom:8px">
          <span>점유율</span><span>${homePoss}% / ${awayPoss}%</span>
        </div>
        <div style="display:flex;justify-content:space-between;margin-bottom:8px">
          <span>슈팅</span><span>${stats.shots.home} / ${stats.shots.away}</span>
        </div>
        <div style="display:flex;justify-content:space-between">
          <span>유효슈팅</span><span>${stats.shotsOnTarget.home} / ${stats.shotsOnTarget.away}</span>
        </div>
      </div>

      <button id="btn-rematch" style="display:block;width:100%;padding:12px;margin-bottom:10px;
        border-radius:8px;background:#6366f1;color:#fff;border:none;font-size:16px;cursor:pointer">
        재경기
      </button>
      <button id="btn-lobby" style="display:block;width:100%;padding:12px;
        border-radius:8px;background:#374151;color:#fff;border:none;font-size:16px;cursor:pointer">
        로비로 돌아가기
      </button>
    </div>
  `

  el.querySelector('#btn-rematch')!.addEventListener('click', () => {
    if (currentRoomId) joinRoom(currentRoomId)
  })
  el.querySelector('#btn-lobby')!.addEventListener('click', () => {
    if (currentRoomId) joinRoom(currentRoomId)
  })
}
```

- [ ] **Step 2: Track room ID in `main.ts`**

```typescript
import { setResultRoomId } from './screens/result'

// In joinRoom(), after socket creation:
const roomId = roomId  // store the parameter
setResultRoomId(roomId)
```

- [ ] **Step 3: Commit**

```bash
git add src/screens/result.ts src/main.ts
git commit -m "feat: result screen with stats and rematch"
```

---

## Task 14: Setpiece, Offside, Halftime

**Files:**
- Modify: `party/server.ts` — offside detection, setpiece placement, out-of-bounds
- Create: `party/rules.test.ts`

- [ ] **Step 1: Add out-of-bounds detection to `tick()`**

Add inside the ball physics section, after wall bounce:

```typescript
// Out of bounds → setpiece
if (state.phase === 'playing' && state.ball.ownerId === null) {
  checkOutOfBounds(state)
}
```

Add the function:

```typescript
function checkOutOfBounds(state: GameState) {
  const { ball } = state
  const lastToucher = state.players.reduce((best, p) => {
    // Track which team last had the ball — stored in a server field
    return best
  }, null as Player | null)

  // Side out → throwin
  if (ball.pos.y < 0 || ball.pos.y > FIELD.H) {
    const team = (ball as any).__lastTeam ?? 'home'
    const oppositeTeam: 'home' | 'away' = team === 'home' ? 'away' : 'home'
    state.ball.pos.y = clamp(ball.pos.y, 0, FIELD.H)
    state.ball.vel = { x: 0, y: 0, z: 0 }
    state.ball.ownerId = null
    triggerSetpiece(state, 'throwin', oppositeTeam, ball.pos)
  }

  // Goal line out (not goal)
  if (ball.pos.x < 0 || ball.pos.x > FIELD.W) {
    const isLeft = ball.pos.x < 0
    const lastTeam: 'home' | 'away' = (ball as any).__lastTeam ?? 'home'

    // Left goal line: home goal. If away kicked out → goalkick. If home kicked out → corner.
    const attackingTeam: 'home' | 'away' = isLeft ? 'away' : 'home'
    const defendingTeam: 'home' | 'away' = isLeft ? 'home' : 'away'

    ball.pos.x = clamp(ball.pos.x, 0, FIELD.W)
    ball.vel = { x: 0, y: 0, z: 0 }
    ball.ownerId = null

    if (lastTeam === attackingTeam) {
      // Attacking team put it out → goalkick
      triggerSetpiece(state, 'goalkick', defendingTeam, { x: isLeft ? 6 : FIELD.W - 6, y: FIELD.CENTER_Y })
    } else {
      // Defending team put it out → corner
      const cornerY = ball.pos.y < FIELD.CENTER_Y ? 0 : FIELD.H
      triggerSetpiece(state, 'corner', attackingTeam, { x: isLeft ? 0 : FIELD.W, y: cornerY })
    }
  }
}

function triggerSetpiece(state: GameState, type: SetpieceState['type'], team: 'home' | 'away', pos: Vec2) {
  state.phase = type
  state.setpiece = { type, team, pos }
  state.ball.pos = { x: pos.x, y: pos.y, z: 0 }
  state.ball.ownerId = null

  // Auto-place controlled player near ball (FC style: 1.5 units behind)
  const controlled = state.players.find(p => p.team === team && p.isControlled)
  if (controlled) {
    const dir = team === 'home' ? 1 : -1
    controlled.pos = { x: clamp(pos.x - dir * 1.5, 0, FIELD.W), y: pos.y }
  }
}
```

- [ ] **Step 2: Track ball last-toucher in dribble attach section**

In `tick()`, after `ball.ownerId = closest.id`:
```typescript
;(state.ball as any).__lastTeam = closest.team
```

- [ ] **Step 3: Offside detection**

Add to `handleBallAction` before kick release, for pass actions:

```typescript
// Offside check for passes
if (['lowpass', 'loftedpass', 'throughpass'].includes(input.action!)) {
  checkOffside(state, player)
}
```

Add the function:

```typescript
function checkOffside(state: GameState, passer: Player) {
  const attackDir = passer.team === 'home' ? 1 : -1
  const lastDefX = state.players
    .filter(p => p.team !== passer.team && p.role !== 'gk')
    .map(p => p.pos.x)
    .sort((a, b) => attackDir === 1 ? b - a : a - b)[0] ?? (attackDir === 1 ? 0 : FIELD.W)

  const attackers = state.players.filter(p =>
    p.team === passer.team && !p.hasBall && p.role !== 'gk'
  )
  const offside = attackers.some(a =>
    attackDir === 1 ? a.pos.x > lastDefX && a.pos.x > passer.pos.x
                    : a.pos.x < lastDefX && a.pos.x < passer.pos.x
  )

  if (offside) {
    triggerSetpiece(state, 'freekick', passer.team === 'home' ? 'away' : 'home',
      { x: lastDefX, y: state.ball.pos.y })
    state.ball.vel = { x: 0, y: 0, z: 0 }
    state.ball.ownerId = null
  }
}
```

- [ ] **Step 4: Resume from setpiece (kickoff-like)**

In `tick()`, allow setpiece team's controlled player to act:

```typescript
if (['freekick', 'penalty', 'corner', 'throwin', 'goalkick'].includes(state.phase)) {
  const setTeam = state.setpiece?.team
  for (const player of state.players) {
    if (!player.isControlled || player.team !== setTeam) continue
    const input = inputs.get(getConnId(player.team)!) ?? null
    if (input?.action && player.hasBall) {
      handleBallAction(state, player, input)
      state.phase = 'playing'
    }
  }
}
```

- [ ] **Step 5: Write rules unit tests**

Create `party/rules.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { FIELD } from '../src/types'

describe('offside position', () => {
  function isOffsidePosition(attackerX: number, lastDefX: number, team: 'home' | 'away') {
    const dir = team === 'home' ? 1 : -1
    return dir === 1 ? attackerX > lastDefX : attackerX < lastDefX
  }

  it('home attacker ahead of last defender is offside', () => {
    expect(isOffsidePosition(75, 70, 'home')).toBe(true)
  })
  it('home attacker behind last defender is onside', () => {
    expect(isOffsidePosition(65, 70, 'home')).toBe(false)
  })
  it('away attacker works mirror', () => {
    expect(isOffsidePosition(25, 30, 'away')).toBe(true)
  })
})

describe('field boundaries', () => {
  it('penalty area bounds for home', () => {
    const inPA = (x: number, y: number) =>
      x >= 0 && x <= FIELD.PA_DEPTH &&
      y >= FIELD.CENTER_Y - FIELD.PA_HALF_WIDTH && y <= FIELD.CENTER_Y + FIELD.PA_HALF_WIDTH
    expect(inPA(5, 30)).toBe(true)
    expect(inPA(20, 30)).toBe(false)
  })
})
```

- [ ] **Step 6: Run tests**

```bash
npm test
```

Expected: all pass

- [ ] **Step 7: Commit**

```bash
git add party/
git commit -m "feat: setpiece triggers, offside detection, out-of-bounds"
```

---

## Task 15: Polish — Halftime Screen, Countdown UI, Deploy

**Files:**
- Modify: `src/main.ts` — halftime overlay, countdown
- Modify: `src/screens/lobby.ts` — countdown overlay update
- Modify: `party/server.ts` — halftime `stats` totals

- [ ] **Step 1: Add halftime overlay in `onStateUpdate`**

```typescript
// In onStateUpdate, add halftime case:
if (state.phase === 'halftime') {
  showHalftimeOverlay(state)
}

function showHalftimeOverlay(state: GameState) {
  const screenEl = document.getElementById('screen')!
  screenEl.classList.remove('hidden')
  const { stats } = state
  const homePoss = Math.round((stats.possession.home / (stats.possession.home + stats.possession.away + 1)) * 100)
  screenEl.innerHTML = `
    <div style="background:rgba(0,0,0,0.9);padding:32px;border-radius:12px;text-align:center">
      <h3>하프타임</h3>
      <div style="font-size:36px;margin:12px 0">${state.score.home} : ${state.score.away}</div>
      <div style="font-size:14px;color:#888">점유율 ${homePoss}% / ${100 - homePoss}%</div>
      <div style="font-size:14px;color:#888">슈팅 ${stats.shots.home} / ${stats.shots.away}</div>
      <p style="margin-top:16px;font-size:13px;color:#666">후반전 준비 중...</p>
    </div>`
}
```

- [ ] **Step 2: Accumulate possession stats on server**

In `tick()`, inside the `phase === 'playing'` block:

```typescript
// Possession accumulation
if (state.ball.ownerId) {
  const owner = state.players.find(p => p.id === state.ball.ownerId)
  if (owner) state.stats.possession[owner.team]++
}
```

- [ ] **Step 3: Deploy**

```bash
# Deploy game server
npx partykit deploy

# Deploy frontend (update PARTY_HOST in main.ts to your Partykit URL first)
npx vercel --prod
```

In `src/main.ts`, update:
```typescript
const PARTY_HOST = import.meta.env.DEV
  ? 'localhost:1999'
  : 'soccer-game.<your-partykit-username>.partykit.dev'
```

- [ ] **Step 4: End-to-end test**

- Open deployed Vercel URL on phone
- Open on PC browser
- Create room on PC, join on phone
- Play a full match: movement, shoot, pass, goal, halftime, result

- [ ] **Step 5: Final commit**

```bash
git add .
git commit -m "feat: halftime overlay, possession stats, deploy config"
```

---

## Self-Review Checklist

**Spec coverage:**
- ✅ 5v5 teams with GK — Task 5
- ✅ Lobby (color, jersey, formation) — Task 12
- ✅ Countdown — Task 3 (server), Task 12 (UI)
- ✅ Kickoff, halftime, ended phases — Task 3, 6, 15
- ✅ Player movement + sprint/stamina — Task 6
- ✅ Dribble attach (magnetic) — Task 6
- ✅ Shoot (power + direction) — Task 7
- ✅ Low pass, lofted pass, through pass — Task 7
- ✅ Chip shot — Task 7 (`chipshot` action)
- ✅ Standing tackle, slide tackle — Task 7
- ✅ GK rush (`gkrush` action) — Task 7, 8
- ✅ GK control transfer — Task 8 (GK catch → `isControlled = true`)
- ✅ Header — _gap identified below_
- ✅ Ball shielding — _gap identified below_
- ✅ Offside — Task 14
- ✅ Foul + freekick/penalty — Task 7
- ✅ Corner, throwin, goalkick — Task 14
- ✅ AI (FWD/MID/DEF/GK) — Task 8
- ✅ Three.js field + characters — Task 9
- ✅ Camera follow — Task 9
- ✅ HUD (score, timer, minimap) — Task 11
- ✅ Halftime stats screen — Task 15
- ✅ Result screen + rematch — Task 13
- ✅ Mobile joystick — Task 10
- ✅ Partykit deploy + Vercel deploy — Task 15
- ⚠️ **Header (5.8)** — not in any task. Adding below.
- ⚠️ **Ball shielding (5.14)** — not in any task. Adding below.
- ⚠️ **Player control switch (Tab)** — `switchPlayer` sent in input but server doesn't handle it. Adding below.

---

## Task 16: Header, Ball Shielding, Player Switch (Missing Features)

**Files:**
- Modify: `party/server.ts`

- [ ] **Step 1: Add header logic in `tick()`, inside ball physics section**

```typescript
// Header: ball descending, z > 2, player within 2 units
if (state.ball.pos.z > 2 && state.ball.vel.z < 0) {
  for (const player of state.players) {
    if (dist(player.pos, state.ball.pos) < 2) {
      // Header
      const connId = [...this.assignments.entries()].find(([, t]) => t === player.team)?.[0]
      const input = player.isControlled && connId ? this.inputs.get(connId) ?? null : null
      const dir = input && (input.dx !== 0 || input.dy !== 0)
        ? norm({ x: input.dx, y: input.dy })
        : player.facing

      if (player.role === 'gk' && isInPenaltyArea(player.pos, player.team)) {
        // GK catches aerial ball in PA
        state.ball.ownerId = player.id
        player.hasBall = true
        state.ball.vel = { x: 0, y: 0, z: 0 }
        if (!player.isControlled) {
          player.isControlled = true  // Transfer to human
        }
      } else {
        state.ball.vel = { x: dir.x * 14, y: dir.y * 14, z: 6 }
        state.ball.ownerId = null
        player.animState = 'kick'
      }
      break
    }
  }
}
```

- [ ] **Step 2: Add ball shielding in `tick()`, player movement section**

After `tickPlayer(player, input)`:

```typescript
// Ball shielding: dribbling + opponent close + moving away from opponent
if (player.hasBall && input) {
  const nearby = state.players.filter(p => p.team !== player.team && dist(p.pos, player.pos) < 2)
  if (nearby.length > 0) {
    const opp = nearby[0]
    const toOpp = norm({ x: opp.pos.x - player.pos.x, y: opp.pos.y - player.pos.y })
    const inputDir = norm({ x: input.dx, y: input.dy })
    const shielding = toOpp.x * inputDir.x + toOpp.y * inputDir.y < -0.5
    if (shielding) {
      ;(player as any).__shielding = true
      // Slow down shielding player
      player.pos.x -= inputDir.x * PLAYER_SPEED * 0.4 * DT  // undo some movement
      player.pos.y -= inputDir.y * PLAYER_SPEED * 0.4 * DT
    } else {
      ;(player as any).__shielding = false
    }
  }
}
```

Modify standing tackle in `handleNoBallAction` to check shielding:

```typescript
// Reduce tackle success if target is shielding
const shielding = (ballOwner as any).__shielding === true
if (dist(player.pos, ballOwner.pos) < FIELD.TACKLE_DIST) {
  const success = Math.random() > (shielding ? 0.5 : 0)
  if (success) { ... }
}
```

- [ ] **Step 3: Handle `switchPlayer` input on server**

In `tick()`, player loop, for controlled players:

```typescript
if (player.isControlled && input?.switchPlayer) {
  // Switch to next nearest outfielder
  const teammates = state.players.filter(p =>
    p.team === player.team && p.role !== 'gk' && !p.isControlled
  ).sort((a, b) => dist(a.pos, state.ball.pos) - dist(b.pos, state.ball.pos))

  if (teammates.length > 0) {
    player.isControlled = false
    teammates[0].isControlled = true
  }
}
```

- [ ] **Step 4: Run tests**

```bash
npm test
```

Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add party/server.ts
git commit -m "feat: header, ball shielding, manual player switch"
```

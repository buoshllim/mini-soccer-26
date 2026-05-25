export type Vec2 = { x: number; y: number }
export type TeamColor = 'blue' | 'red' | 'green' | 'yellow'
export type PlayerRole = 'gk' | 'df' | 'mf' | 'fw'

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
  home: { color: TeamColor | null; ready: boolean; username?: string } | null
  away: { color: TeamColor | null; ready: boolean; username?: string } | null
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
  kickPower: number   // 0 = not kicking; 0.01–1 = released with this power
}

export type ServerMsg =
  | { type: 'state'; state: GameState }
  | { type: 'assigned'; team: 'home' | 'away' }
  | { type: 'error'; msg: string }

export type ClientMsg =
  | { type: 'input'; input: PlayerInput }
  | { type: 'lobby'; color?: TeamColor; ready?: boolean; username?: string }
  | { type: 'solo' }
  | { type: 'rematch' }

export const FIELD = {
  W: 100, H: 60,
  GOAL_WIDTH: 12,
  PA_DEPTH: 16, PA_HALF_WIDTH: 18,
  CENTER_X: 50, CENTER_Y: 30,
  PLAYER_RADIUS: 1.2,
  BALL_RADIUS: 0.7,
  BALL_SLOW_SPEED: 4,        // below this → dribble-attach
  KICK_MIN_SPEED: 22,
  KICK_MAX_SPEED: 65,
  STUN_DURATION: 0.55,       // used by renderer to normalize tilt animation
  STUN_SPEED_THRESHOLD: 6,   // relative speed (units/sec) to cause stun
  GK_HOME_X: 4,
  GK_AWAY_X: 96,
} as const

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
  slots: [number, number, number, number]  // exactly 4 grid indices, each 0~8
}

export type LobbyState = {
  home: { color: TeamColor | null; formation: Formation | null; jerseyNumbers: [number, number, number, number, number]; ready: boolean } | null
  away: { color: TeamColor | null; formation: Formation | null; jerseyNumbers: [number, number, number, number, number]; ready: boolean } | null
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
  power: number         // 0~1; server must clamp to [0, 1] before use
}

export type ServerMsg =
  | { type: 'state'; state: GameState }
  | { type: 'assigned'; team: 'home' | 'away' }
  | { type: 'error'; msg: string }

export type ClientMsg =
  | { type: 'input'; input: PlayerInput }
  | { type: 'lobby'; color?: TeamColor; jerseyNumbers?: [number, number, number, number, number]; formation?: Formation; ready?: boolean }

// Field constants (game units)
export const FIELD = {
  W: 100, H: 60,
  GOAL_WIDTH: 12,
  PA_DEPTH: 16, PA_HALF_WIDTH: 18,  // penalty area
  CENTER_X: 50, CENTER_Y: 30,
  PLAYER_RADIUS: 1,
  BALL_RADIUS: 0.5,
  DRIBBLE_ATTACH_DIST: 1.5,
  TACKLE_DIST: 2,
  GK_RUSH_DIST: 8,
} as const

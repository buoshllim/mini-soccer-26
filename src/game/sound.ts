import type { GameState } from '../types'
import { FIELD } from '../types'

const POST_POSITIONS = [
  { x: 0,        y: FIELD.CENTER_Y - FIELD.GOAL_WIDTH / 2 },
  { x: 0,        y: FIELD.CENTER_Y + FIELD.GOAL_WIDTH / 2 },
  { x: FIELD.W,  y: FIELD.CENTER_Y - FIELD.GOAL_WIDTH / 2 },
  { x: FIELD.W,  y: FIELD.CENTER_Y + FIELD.GOAL_WIDTH / 2 },
]

class SoundManager {
  private clips = new Map<string, HTMLAudioElement>()
  private ambient: HTMLAudioElement | null = null
  private lobbyAmbient: HTMLAudioElement | null = null
  private prevStunTimers = new Map<string, number>()
  private prevBallOwnerId: string | null | undefined = undefined
  private prevBallVel = { x: 0, y: 0 }
  private _bgmEnabled = true

  isBgmEnabled(): boolean { return this._bgmEnabled }

  toggleLobbyBgm(): boolean {
    this._bgmEnabled = !this._bgmEnabled
    if (this._bgmEnabled) {
      this.lobbyAmbient?.play().catch(() => {})
    } else {
      this.lobbyAmbient?.pause()
    }
    return this._bgmEnabled
  }

  preload(): void {
    const names = ['crowd-ambient', 'kick', 'goal-cheer', 'whistle', 'post-hit', 'fanfare',
                   'bump-light', 'bump-heavy', 'ball-pickup', 'victory', 'lobby-bgm', 'countdown-beep']
    for (const name of names) {
      if (this.clips.has(name)) continue
      const audio = new Audio(`/sounds/${name}.mp3`)
      audio.preload = 'auto'
      this.clips.set(name, audio)
    }
    const amb = this.clips.get('crowd-ambient')!
    amb.loop = true
    amb.volume = 0.28
    this.ambient = amb

    const lobby = this.clips.get('lobby-bgm')!
    lobby.loop = true
    lobby.volume = 0.3
    this.lobbyAmbient = lobby
  }

  play(name: string, volume = 1): void {
    const src = this.clips.get(name)
    if (!src) return
    const audio = new Audio(src.src)
    audio.volume = Math.min(1, Math.max(0, volume))
    audio.play().catch(() => {})
  }

  startAmbient(): void {
    this.ambient?.play().catch(() => {})
  }

  stopAmbient(): void {
    if (!this.ambient) return
    this.ambient.pause()
    this.ambient.currentTime = 0
  }

  startLobbyBgm(): void {
    if (!this._bgmEnabled || !this.lobbyAmbient || !this.lobbyAmbient.paused) return
    this.lobbyAmbient.play().catch(() => {})
  }

  stopLobbyBgm(): void {
    if (!this.lobbyAmbient) return
    this.lobbyAmbient.pause()
    this.lobbyAmbient.currentTime = 0
  }

  onStateUpdate(state: GameState): void {
    this._detectBallEvents(state)
    this._detectDeflect(state)
    this._detectBumps(state)
    this._detectPostHit(state)
    this.prevBallVel = { ...state.ball.vel }
  }

  private _detectBallEvents(state: GameState): void {
    if (this.prevBallOwnerId !== undefined) {
      const wasOwned = this.prevBallOwnerId !== null
      const isOwned = state.ball.ownerId !== null
      if (wasOwned && !isOwned) {
        const speed = Math.hypot(state.ball.vel.x, state.ball.vel.y)
        if (speed > 18) this.play('kick', Math.min(speed / 65, 1))
      } else if (!wasOwned && isOwned) {
        this.play('ball-pickup', 0.7)
      }
    }
    this.prevBallOwnerId = state.ball.ownerId
  }

  private _detectBumps(state: GameState): void {
    for (const player of state.players) {
      const prev = this.prevStunTimers.get(player.id) ?? 0
      if (prev === 0 && player.stunTimer > 0) {
        const speed = Math.hypot(player.vel.x, player.vel.y)
        if (speed > 12) this.play('bump-heavy', 0.8)
        else this.play('bump-light', 0.7)
      }
      this.prevStunTimers.set(player.id, player.stunTimer)
    }
  }

  private _detectDeflect(state: GameState): void {
    // Only when ball was free and stays free (GK shot, deflection off player)
    if (state.ball.ownerId !== null || this.prevBallOwnerId !== null) return

    const prevSpeed = Math.hypot(this.prevBallVel.x, this.prevBallVel.y)
    const newSpeed = Math.hypot(state.ball.vel.x, state.ball.vel.y)
    if (newSpeed < 18) return

    // Skip near walls (bounce) and posts (already handled)
    const { pos } = state.ball
    const br = FIELD.BALL_RADIUS
    const nearWall = pos.x < br + 2 || pos.x > FIELD.W - br - 2 ||
                     pos.y < br + 2 || pos.y > FIELD.H - br - 2
    if (nearWall) return
    const nearPost = POST_POSITIONS.some(p => Math.hypot(pos.x - p.x, pos.y - p.y) < 2.5)
    if (nearPost) return

    if (prevSpeed < 5) {
      // Was slow → now fast: GK shot
      this.play('kick', Math.min(newSpeed / 65, 1))
    } else {
      const dot = (this.prevBallVel.x * state.ball.vel.x + this.prevBallVel.y * state.ball.vel.y) / (prevSpeed * newSpeed)
      if (dot < 0.5) {
        // Direction changed sharply: deflection off player
        this.play('kick', Math.min(newSpeed / 65, 0.85))
      }
    }
  }

  private _detectPostHit(state: GameState): void {
    const ball = state.ball
    if (ball.ownerId !== null) return

    const speed = Math.hypot(ball.vel.x, ball.vel.y)
    const prevSpeed = Math.hypot(this.prevBallVel.x, this.prevBallVel.y)
    if (speed < 5 || prevSpeed < 5) return

    const nearPost = POST_POSITIONS.some(p =>
      Math.hypot(ball.pos.x - p.x, ball.pos.y - p.y) < 2.5
    )
    if (!nearPost) return

    const dot = (ball.vel.x * this.prevBallVel.x + ball.vel.y * this.prevBallVel.y) / (speed * prevSpeed)
    if (dot < 0.2) this.play('post-hit', 1.0)
  }

  reset(): void {
    this.prevStunTimers.clear()
    this.prevBallOwnerId = undefined
    this.prevBallVel = { x: 0, y: 0 }
  }

  dispose(): void {
    this.stopAmbient()
    this.stopLobbyBgm()
    this.clips.clear()
    this.ambient = null
    this.lobbyAmbient = null
    this.reset()
  }
}

export const sound = new SoundManager()

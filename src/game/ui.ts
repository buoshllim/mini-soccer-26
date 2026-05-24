import type { GameState, TeamColor } from '../types'
import { FIELD } from '../types'

const BADGE_COLORS: Record<TeamColor, string> = {
  blue: '#3b82f6', red: '#ef4444', green: '#16a34a', yellow: '#eab308',
}

let ctx: CanvasRenderingContext2D
let canvas: HTMLCanvasElement
let animFrame: number | null = null
let latestState: GameState | null = null
let powerGauge = 0  // 0~1, updated from input
let alertText = ''
let alertTimer = 0
let confetti: Array<{x:number;y:number;vx:number;vy:number;color:string;size:number;life:number}> = []

export function initHUD(myTeam: 'home' | 'away') {
  if (animFrame !== null) return  // guard against double-init
  canvas = document.getElementById('hud-canvas') as HTMLCanvasElement
  ctx = canvas.getContext('2d')!
  resize()
  window.addEventListener('resize', resize)
  animFrame = requestAnimationFrame(drawLoop)
}

export function destroyHUD() {
  if (animFrame !== null) { cancelAnimationFrame(animFrame); animFrame = null }
  window.removeEventListener('resize', resize)
  latestState = null
}

export function updateHUDState(state: GameState) {
  latestState = state
}

export function setPowerGauge(v: number) { powerGauge = v }

export function spawnConfetti() {
  for (let i = 0; i < 90; i++) {
    confetti.push({
      x: Math.random() * (canvas?.width ?? 800),
      y: -20,
      vx: (Math.random() - 0.5) * 7,
      vy: Math.random() * 4 + 2,
      color: `hsl(${Math.random() * 360},85%,60%)`,
      size: Math.random() * 8 + 4,
      life: 1,
    })
  }
}

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
  drawConfetti()
  drawAlert()
  drawKeyHints()

  if (alertTimer > 0) alertTimer--
}

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath()
  c.moveTo(x + r, y)
  c.lineTo(x + w - r, y)
  c.quadraticCurveTo(x + w, y, x + w, y + r)
  c.lineTo(x + w, y + h - r)
  c.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  c.lineTo(x + r, y + h)
  c.quadraticCurveTo(x, y + h, x, y + h - r)
  c.lineTo(x, y + r)
  c.quadraticCurveTo(x, y, x + r, y)
  c.closePath()
}

function drawScoreTimer(state: GameState) {
  const mob = canvas.width < 600
  const { score, timeLeft, half } = state
  const mins = Math.floor(timeLeft / 60).toString().padStart(2, '0')
  const secs = Math.floor(timeLeft % 60).toString().padStart(2, '0')

  const homeUsername = (state.lobby?.home as any)?.username || 'Home'
  const awayUsername = (state.lobby?.away as any)?.username || 'Away'
  const homeColorName = (state.lobby?.home?.color ?? 'blue') as TeamColor
  const awayColorName = (state.lobby?.away?.color ?? 'red') as TeamColor
  const homeColor = BADGE_COLORS[homeColorName]
  const awayColor = BADGE_COLORS[awayColorName]

  const boxW = mob ? 220 : 300
  const boxH = mob ? 36 : 58
  const boxX = 10, boxY = 10
  const midX = boxX + boxW / 2
  const dotR = mob ? 4 : 8
  // max pixel width available for each name (half the box minus score center minus dot area)
  const nameMaxW = mob ? 62 : 88

  ctx.save()

  ctx.fillStyle = 'rgba(0,0,0,0.45)'
  roundRect(ctx, boxX, boxY, boxW, boxH, 10)
  ctx.fill()

  // Score (center)
  ctx.fillStyle = '#fff'
  ctx.font = mob ? 'bold 13px sans-serif' : 'bold 22px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(`${score.home} : ${score.away}`, midX, boxY + (mob ? 12 : 20))

  // Timer below score
  ctx.fillStyle = '#aaa'
  ctx.font = mob ? '8px sans-serif' : '11px sans-serif'
  ctx.fillText(`${half === 1 ? '전반' : '후반'} ${mins}:${secs}`, midX, boxY + (mob ? 26 : 42))

  // Home: dot + username (left)
  ctx.fillStyle = homeColor
  ctx.beginPath()
  ctx.arc(boxX + dotR + 3, boxY + (mob ? 12 : 20), dotR, 0, Math.PI * 2)
  ctx.fill()

  ctx.fillStyle = '#fff'
  ctx.font = mob ? '8px sans-serif' : 'bold 11px sans-serif'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(homeUsername, boxX + dotR * 2 + 5, boxY + (mob ? 12 : 20), nameMaxW)

  // Away: username + dot (right)
  ctx.textAlign = 'right'
  ctx.fillText(awayUsername, boxX + boxW - dotR * 2 - 5, boxY + (mob ? 12 : 20), nameMaxW)

  ctx.fillStyle = awayColor
  ctx.beginPath()
  ctx.arc(boxX + boxW - dotR - 3, boxY + (mob ? 12 : 20), dotR, 0, Math.PI * 2)
  ctx.fill()

  ctx.restore()
}

function drawMinimap(state: GameState) {
  const mob = canvas.width < 600
  const mw = mob ? 96 : 150
  const mh = mob ? 58 : 90
  const mx = canvas.width / 2 - mw / 2
  const my = canvas.height - mh - (mob ? 8 : 14)

  ctx.save()
  ctx.fillStyle = 'rgba(0,0,0,0.3)'
  ctx.fillRect(mx, my, mw, mh)
  ctx.strokeStyle = 'rgba(255,255,255,0.25)'
  ctx.strokeRect(mx, my, mw, mh)

  // Midline
  ctx.beginPath()
  ctx.moveTo(mx + mw / 2, my)
  ctx.lineTo(mx + mw / 2, my + mh)
  ctx.strokeStyle = 'rgba(255,255,255,0.2)'
  ctx.stroke()

  // Players — Y flipped to match 3D camera (north = top of minimap)
  for (const p of state.players) {
    const px = mx + (p.pos.x / FIELD.W) * mw
    const py = my + ((FIELD.H - p.pos.y) / FIELD.H) * mh
    ctx.beginPath()
    ctx.arc(px, py, p.isControlled ? (mob ? 3 : 4) : (mob ? 1.8 : 2.5), 0, Math.PI * 2)
    ctx.fillStyle = p.team === 'home' ? '#3b82f6' : '#ef4444'
    ctx.fill()
  }

  // Ball — Y flipped
  const bx = mx + (state.ball.pos.x / FIELD.W) * mw
  const by = my + ((FIELD.H - state.ball.pos.y) / FIELD.H) * mh
  ctx.beginPath()
  ctx.arc(bx, by, mob ? 2 : 3, 0, Math.PI * 2)
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

function drawConfetti() {
  confetti.forEach(p => {
    if (!ctx) return
    ctx.save()
    ctx.globalAlpha = Math.max(0, p.life)
    ctx.fillStyle = p.color
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 3, p.size, p.size * 0.55)
    ctx.restore()
    p.x += p.vx; p.y += p.vy; p.vy += 0.12; p.life -= 0.012
  })
  confetti = confetti.filter(p => p.life > 0 && p.y < (canvas?.height ?? 1000) + 20)
}

function drawKeyHints() {
  if (!ctx || !canvas) return
  if (canvas.width < 600) return  // mobile: no keyboard, skip hint
  ctx.save()
  ctx.fillStyle = 'rgba(0,0,0,0.55)'
  ctx.fillRect(10, canvas.height - 34, 220, 26)
  ctx.font = 'bold 11px monospace'
  ctx.fillStyle = '#ffd700'
  ctx.textAlign = 'left'
  ctx.fillText('SPACE/슛 버튼 오래 눌렀다 떼면 강슛', 18, canvas.height - 17)
  ctx.restore()
}

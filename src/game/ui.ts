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
let confetti: Array<{x:number;y:number;vx:number;vy:number;color:string;size:number;life:number}> = []

export function initHUD(myTeam: 'home' | 'away') {
  if (animFrame !== null) return  // guard against double-init
  canvas = document.getElementById('hud-canvas') as HTMLCanvasElement
  ctx = canvas.getContext('2d')!
  myTeamRef = myTeam
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

function drawScoreTimer(state: GameState) {
  const { score, timeLeft, half } = state
  const mins = Math.floor(timeLeft / 60).toString().padStart(2, '0')
  const secs = Math.floor(timeLeft % 60).toString().padStart(2, '0')

  ctx.save()
  ctx.fillStyle = 'rgba(0,0,0,0.6)'
  ctx.fillRect(12, 12, 180, 52)
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
  ctx.save()
  ctx.fillStyle = 'rgba(0,0,0,0.55)'
  ctx.fillRect(10, canvas.height - 34, 190, 26)
  ctx.font = 'bold 11px monospace'
  ctx.fillStyle = '#ffd700'
  ctx.textAlign = 'left'
  ctx.fillText('[Space] 킥  꾹 누르면 강슛', 18, canvas.height - 17)
  ctx.restore()
}

/// <reference types="vite/client" />
import PartySocket from 'partysocket'
import type { GameState, ServerMsg, ClientMsg, PlayerInput, TeamColor } from './types'
import { mountHome } from './screens/home'
import { mountLobby, resetLobbyLocalState } from './screens/lobby'
import { mountResult, setResultRoomId } from './screens/result'
import { startGame, stopGame, updateGameState, setRendererTeam } from './game/renderer'
import { initHUD, destroyHUD, updateHUDState, spawnConfetti } from './game/ui'
import { initInput, destroyInput } from './game/input'
import { sound } from './game/sound'

const PARTY_HOST = import.meta.env.DEV
  ? 'localhost:1999'
  : 'soccer-game.buoshllim.partykit.dev'

let socket: PartySocket | null = null
let myTeam: 'home' | 'away' | null = null
let currentRoomId: string | null = null
let activePhase: string | null = null
let soloGame = false

export function getMyTeam() { return myTeam }
export function getCurrentRoomId() { return currentRoomId }

export function goHome() {
  // Set socket to null BEFORE closing so onclose handler can detect intentional disconnect
  const s = socket
  socket = null
  if (s) s.close()
  activePhase = null; myTeam = null; currentRoomId = null; soloGame = false; prevCountdown = undefined
  setRendererTeam(null)
  stopGame(); destroyInput(); destroyHUD()
  sound.dispose()
  gameActive = false
  prevScore = { home: 0, away: 0 }
  resetLobbyLocalState()
  hideReconnectOverlay()
  screenEl.classList.remove('hidden')
  mountHome(screenEl)
}

export function joinRoom(roomId: string, solo = false) {
  currentRoomId = roomId
  soloGame = solo
  setResultRoomId(roomId)
  sound.preload()
  if (socket) socket.close()

  socket = new PartySocket({ host: PARTY_HOST, room: roomId })

  socket.onmessage = (e: MessageEvent) => {
    hideReconnectOverlay()
    const msg: ServerMsg = JSON.parse(e.data)
    if (msg.type === 'assigned') {
      myTeam = msg.team
      ;(window as any).__myTeam = msg.team
      setRendererTeam(msg.team)
      if (soloGame) {
        socket?.send(JSON.stringify({ type: 'solo' } satisfies ClientMsg))
      }
    } else if (msg.type === 'state') {
      onStateUpdate(msg.state)
    } else if (msg.type === 'error') {
      alert(msg.msg)
    }
  }

  socket.onclose = () => {
    // socket === null means goHome() was called intentionally — already handled
    if (!socket) return
    // Temporary disconnect: show overlay and wait for PartySocket auto-reconnect
    showReconnectOverlay()
  }
}

export function sendInput(input: PlayerInput) {
  if (!socket) return
  const msg: ClientMsg = { type: 'input', input }
  socket.send(JSON.stringify(msg))
}

export function sendLobby(payload: { color?: TeamColor; ready?: boolean; username?: string }) {
  if (!socket) return
  const msg: ClientMsg = { type: 'lobby', ...payload }
  socket.send(JSON.stringify(msg))
}

export function sendRematch() {
  if (!socket) return
  socket.send(JSON.stringify({ type: 'rematch' } satisfies ClientMsg))
}

const screenEl = document.getElementById('screen')!
let gameActive = false
let prevScore = { home: 0, away: 0 }
let prevCountdown: number | undefined = undefined
let ceremonyTimer: ReturnType<typeof setTimeout> | null = null

// Web Audio whistle
function playWhistle() {
  try {
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = 'sine'
    osc.frequency.setValueAtTime(1200, ctx.currentTime)
    osc.frequency.exponentialRampToValueAtTime(900, ctx.currentTime + 0.3)
    gain.gain.setValueAtTime(0.4, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5)
    osc.start()
    osc.stop(ctx.currentTime + 0.5)
  } catch { /* ignore if AudioContext unavailable */ }
}

function playFanfare() {
  try {
    const ac = new AudioContext()
    const notes = [
      [523.25, 0, 0.18], [659.25, 0.18, 0.18], [783.99, 0.36, 0.18],
      [1046.5, 0.54, 0.35], [783.99, 0.65, 0.22], [1046.5, 0.85, 0.6],
    ] as const
    notes.forEach(([freq, start, dur]) => {
      const osc = ac.createOscillator()
      const gain = ac.createGain()
      osc.connect(gain); gain.connect(ac.destination)
      osc.type = 'square'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.22, ac.currentTime + start)
      gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + start + dur)
      osc.start(ac.currentTime + start)
      osc.stop(ac.currentTime + start + dur + 0.05)
    })
  } catch { /* ignore */ }
}

function ensureCeremonyStyles() {
  if (document.getElementById('ceremony-css')) return
  const s = document.createElement('style')
  s.id = 'ceremony-css'
  s.textContent = `
    @keyframes goalBounce {
      0%   { transform: scale(0.3) rotate(-8deg); opacity: 0; }
      60%  { transform: scale(1.15) rotate(3deg); opacity: 1; }
      100% { transform: scale(1) rotate(0deg); opacity: 1; }
    }
    @keyframes scoreSlide {
      0%   { transform: translateY(30px); opacity: 0; }
      100% { transform: translateY(0); opacity: 1; }
    }
  `
  document.head.appendChild(s)
}

function showGoalCeremony(score: { home: number; away: number }) {
  ensureCeremonyStyles()
  document.getElementById('goal-ceremony')?.remove()
  if (ceremonyTimer) { clearTimeout(ceremonyTimer); ceremonyTimer = null }

  const div = document.createElement('div')
  div.id = 'goal-ceremony'
  div.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:160',
    'display:flex', 'flex-direction:column',
    'align-items:center', 'justify-content:center',
    'background:radial-gradient(ellipse at center,rgba(255,120,0,0.35) 0%,rgba(0,0,0,0.72) 70%)',
    'pointer-events:none',
  ].join(';')
  div.innerHTML = `
    <div style="font-size:96px;font-weight:900;color:#ffd700;letter-spacing:6px;
      text-shadow:0 0 60px #ff8800,0 0 20px #ff4400,0 4px 0 #aa5500;
      animation:goalBounce 0.5s cubic-bezier(0.34,1.56,0.64,1) forwards">GOAL!</div>
    <div style="font-size:52px;font-weight:bold;color:#fff;margin-top:12px;
      text-shadow:0 2px 12px rgba(0,0,0,0.9);
      animation:scoreSlide 0.4s 0.3s ease-out both">${score.home} : ${score.away}</div>
  `
  document.body.appendChild(div)

  // Auto-dismiss after 2.5s — matches server GOAL_FREEZE so players unfreeze at the same time
  ceremonyTimer = setTimeout(() => {
    div.remove()
    ceremonyTimer = null
  }, 1500)

  spawnConfetti()
}

function showKickoffOverlay() {
  document.getElementById('kickoff-text')?.remove()
  const div = document.createElement('div')
  div.id = 'kickoff-text'
  div.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:155',
    'display:flex', 'align-items:center', 'justify-content:center',
    'pointer-events:none',
  ].join(';')
  div.innerHTML = `<div style="font-size:54px;font-weight:900;color:#fff;letter-spacing:4px;
    text-shadow:0 0 30px #00aaff,0 2px 0 #0055aa;opacity:1;transition:opacity 0.8s">KICK OFF!</div>`
  document.body.appendChild(div)
  // Fade out and remove
  setTimeout(() => {
    const inner = div.querySelector('div') as HTMLElement | null
    if (inner) inner.style.opacity = '0'
    setTimeout(() => div.remove(), 900)
  }, 1500)
}

function showReconnectOverlay() {
  if (document.getElementById('reconnect-overlay')) return
  const el = document.createElement('div')
  el.id = 'reconnect-overlay'
  el.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:200;color:#fff;font-size:20px;gap:12px'
  el.innerHTML = `<div style="font-size:32px">📡</div><div>Reconnecting...</div>`
  document.body.appendChild(el)
}

function hideReconnectOverlay() {
  document.getElementById('reconnect-overlay')?.remove()
}

function onStateUpdate(state: GameState) {
  // Countdown beep — checked first so countdown=3 (phase transition packet) isn't missed
  if (state.phase === 'countdown' && state.countdown !== prevCountdown) {
    sound.play('countdown-beep', 0.1)
    prevCountdown = state.countdown
  }

  if (gameActive) {
    // Detect goal
    if (state.score.home !== prevScore.home || state.score.away !== prevScore.away) {
      showGoalCeremony(state.score)
      sound.play('goal-cheer')
      sound.play('fanfare')
    }
    prevScore = { ...state.score }
    updateGameState(state)
    updateHUDState(state)
    sound.onStateUpdate(state)
  }

  // Same phase: only update lobby/countdown renders, skip transition logic
  if (state.phase === activePhase) {
    if (state.phase === 'lobby' || state.phase === 'countdown') mountLobby(screenEl, state)
    return
  }

  const prevPhase = activePhase
  activePhase = state.phase

  if (state.phase === 'lobby' || state.phase === 'countdown') {
    if (gameActive) {
      stopGame()
      destroyInput()
      destroyHUD()
      gameActive = false
    }
    sound.startLobbyBgm()
    prevCountdown = undefined
    screenEl.classList.remove('hidden')
    mountLobby(screenEl, state)
  } else if (state.phase === 'ended') {
    if (gameActive) {
      stopGame()
      destroyInput()
      destroyHUD()
      gameActive = false
    }
    sound.stopAmbient()
    sound.play('whistle')
    if (myTeam) {
      const oppTeam = myTeam === 'home' ? 'away' : 'home'
      if (state.score[myTeam] > state.score[oppTeam]) sound.play('victory')
    }
    screenEl.classList.remove('hidden')
    mountResult(screenEl, state)
  } else if (state.phase === 'halftime') {
    sound.stopAmbient()
    sound.play('whistle')
    showHalftimeOverlay(state)
  } else if (state.phase === 'playing') {
    screenEl.classList.add('hidden')
    if (!gameActive) {
      prevScore = { ...state.score }
      sound.stopLobbyBgm()
      sound.play('whistle')
      sound.startAmbient()
      sound.reset()
      if (myTeam) setRendererTeam(myTeam)  // restore after stopGame() cleared it
      startGame(state)
      if (myTeam) initHUD(myTeam)
      initInput()
      gameActive = true
    } else {
      // Second half kickoff
      sound.play('whistle')
      sound.startAmbient()
    }
  }
}

function showHalftimeOverlay(state: GameState) {
  const { score, stats } = state
  const homePoss = Math.round((stats.possession.home / (stats.possession.home + stats.possession.away + 1)) * 100)

  const colorHex: Record<string, string> = {
    blue: '#3b82f6', red: '#ef4444', green: '#16a34a', yellow: '#facc15',
  }
  const homeColor = colorHex[state.lobby?.home?.color ?? 'blue'] ?? '#3b82f6'
  const awayColor = colorHex[state.lobby?.away?.color ?? 'red'] ?? '#ef4444'
  const homeUsername = (state.lobby?.home as any)?.username || 'Home'
  const awayUsername = (state.lobby?.away as any)?.username || 'Away'

  screenEl.innerHTML = `
    <div style="background:rgba(0,0,0,0.92);padding:clamp(10px,3vw,20px) clamp(14px,5vw,36px);
      border-radius:16px;text-align:center;width:min(400px,94vw);box-sizing:border-box">
      <h2 style="margin:0 0 6px;font-size:clamp(16px,4vw,20px)">Half Time</h2>
      <div style="font-size:clamp(32px,8vw,44px);font-weight:bold;margin:4px 0">${score.home} : ${score.away}</div>
      <div style="margin-top:10px;font-size:clamp(11px,3vw,13px);color:#aaa">
        <div style="display:grid;grid-template-columns:1fr auto 1fr;gap:4px 8px;align-items:center">
          <div style="display:flex;align-items:center;gap:5px;justify-content:flex-end">
            <span>${homeUsername}</span>
            <div style="width:8px;height:8px;border-radius:50%;background:${homeColor};flex-shrink:0"></div>
          </div>
          <span style="color:#666;font-size:clamp(9px,2.2vw,11px)">Team</span>
          <div style="display:flex;align-items:center;gap:5px">
            <div style="width:8px;height:8px;border-radius:50%;background:${awayColor};flex-shrink:0"></div>
            <span>${awayUsername}</span>
          </div>

          <span style="text-align:right">${homePoss}%</span>
          <span style="color:#666">Possession</span>
          <span style="text-align:left">${100 - homePoss}%</span>

          <span style="text-align:right">${stats.shots.home}</span>
          <span style="color:#666">Shots</span>
          <span style="text-align:left">${stats.shots.away}</span>
        </div>
      </div>
      <p style="margin:8px 0 0;font-size:12px;color:#555">2nd half starting soon...</p>
    </div>`
  screenEl.classList.remove('hidden')
}

// Boot: show home screen
mountHome(screenEl)

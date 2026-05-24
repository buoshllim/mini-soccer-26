/// <reference types="vite/client" />
import PartySocket from 'partysocket'
import type { GameState, ServerMsg, ClientMsg, PlayerInput, TeamColor, Formation } from './types'
import { mountHome } from './screens/home'
import { mountLobby, resetLobbyLocalState } from './screens/lobby'
import { mountResult, setResultRoomId } from './screens/result'
import { startGame, stopGame, updateGameState } from './game/renderer'
import { initHUD, destroyHUD, updateHUDState } from './game/ui'
import { initInput, destroyInput } from './game/input'

const PARTY_HOST = import.meta.env.DEV
  ? 'localhost:1999'
  : 'soccer-game.buoshllim.partykit.dev'

let socket: PartySocket | null = null
let myTeam: 'home' | 'away' | null = null
let currentRoomId: string | null = null
let activePhase: string | null = null

export function getMyTeam() { return myTeam }
export function getCurrentRoomId() { return currentRoomId }

export function goHome() {
  if (socket) { socket.close(); socket = null }
  activePhase = null; myTeam = null; currentRoomId = null
  stopGame(); destroyInput(); destroyHUD()
  gameActive = false
  resetLobbyLocalState()
  screenEl.classList.remove('hidden')
  mountHome(screenEl)
}

export function joinRoom(roomId: string) {
  currentRoomId = roomId
  setResultRoomId(roomId)
  if (socket) socket.close()

  socket = new PartySocket({ host: PARTY_HOST, room: roomId })

  socket.onmessage = (e: MessageEvent) => {
    const msg: ServerMsg = JSON.parse(e.data)
    if (msg.type === 'assigned') {
      myTeam = msg.team
    } else if (msg.type === 'state') {
      onStateUpdate(msg.state)
    } else if (msg.type === 'error') {
      alert(msg.msg)
    }
  }

  socket.onclose = () => {
    activePhase = null
    stopGame()
    destroyInput()
    destroyHUD()
    resetLobbyLocalState()
    mountHome(screenEl)
    screenEl.classList.remove('hidden')
  }
}

export function sendInput(input: PlayerInput) {
  if (!socket) return
  const msg: ClientMsg = { type: 'input', input }
  socket.send(JSON.stringify(msg))
}

export function sendLobby(payload: { color?: TeamColor; jerseyNumbers?: [number, number, number, number, number]; formation?: Formation; ready?: boolean }) {
  if (!socket) return
  const msg: ClientMsg = { type: 'lobby', ...payload }
  socket.send(JSON.stringify(msg))
}

const screenEl = document.getElementById('screen')!
let gameActive = false

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

function onStateUpdate(state: GameState) {
  if (gameActive) {
    updateGameState(state)
    updateHUDState(state)
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
    screenEl.classList.remove('hidden')
    mountLobby(screenEl, state)
  } else if (state.phase === 'ended') {
    if (gameActive) {
      stopGame()
      destroyInput()
      destroyHUD()
      gameActive = false
    }
    screenEl.classList.remove('hidden')
    mountResult(screenEl, state)
  } else if (state.phase === 'halftime') {
    showHalftimeOverlay(state)
  } else {
    // Playing phases: kickoff, playing, freekick, penalty, corner, throwin, goalkick
    screenEl.classList.add('hidden')
    if (!gameActive) {
      startGame(state)
      if (myTeam) initHUD(myTeam)
      initInput()
      gameActive = true
    }
    // Whistle on every kickoff
    if (state.phase === 'kickoff' && prevPhase !== 'kickoff') {
      playWhistle()
    }
  }
}

function showHalftimeOverlay(state: GameState) {
  const { score, stats } = state
  const homePoss = Math.round((stats.possession.home / (stats.possession.home + stats.possession.away + 1)) * 100)

  screenEl.innerHTML = `
    <div style="background:rgba(0,0,0,0.92);padding:36px 48px;border-radius:16px;text-align:center;min-width:300px">
      <h2 style="margin-bottom:12px;font-size:22px">하프타임</h2>
      <div style="font-size:48px;font-weight:bold;margin:8px 0">${score.home} : ${score.away}</div>
      <div style="margin-top:16px;font-size:14px;color:#aaa;line-height:2">
        <div>점유율 ${homePoss}% / ${100 - homePoss}%</div>
        <div>슈팅 ${stats.shots.home} / ${stats.shots.away}</div>
        <div>유효슈팅 ${stats.shotsOnTarget.home} / ${stats.shotsOnTarget.away}</div>
      </div>
      <p style="margin-top:20px;font-size:13px;color:#666">후반전 자동 시작...</p>
    </div>`
  screenEl.classList.remove('hidden')
}

// Boot: show home screen
mountHome(screenEl)
